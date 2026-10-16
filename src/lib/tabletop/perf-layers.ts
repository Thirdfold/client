// What one frame draws, by layer and pass (#264): every draw three counts (`info.update`, one per
// BatchedMesh instance on WebGPU, one per multi-draw on WebGL2) put down to the layer it belongs
// to (the nearest `userData.perfLayer` up its parents, else its material's kind (`terrain` the
// ground's tops, `rock` its faces with the stairs and bridges, `surface` the void and beyond,
// `mini` tokens, `prop` props and fixtures), else `post` for an effect's quad) and the pass drawing it (the sun's or the moon's shadow, a hero light's cube,
// the prepass, the scene pass, the overlay). For each batch, `instanced` is what the same frame
// would draw with an InstancedMesh per piece geometry instead: the distinct pieces it drew in each
// pass. Read by `scripts/perf-gpu.mjs` (`LAYERS=1`) under `?perf`, loaded only then (its own
// chunk); layers are named with perf.ts `tagged`.

import type * as THREE from 'three/webgpu';
import { backendOf, gpuInfo, type Benchmark, type GpuTimer, type PerfRecorder } from './perf';
import { isSoftware } from './quality';

/** Draws and triangles. */
export interface Cost {
	draws: number;
	triangles: number;
}

/** What a layer holds on the table, drawn or not. */
export interface LayerHolds {
	meshes: number;
	instances: number;
	/** Triangles of every instance. */
	triangles: number;
	/** Bytes of its geometries' attributes and indices. */
	bytes: number;
}

export interface LayerReport {
	/** The frame: draws and triangles in all (three's own counters). */
	total: Cost;
	/** By pass, then layer. */
	passes: Record<string, Record<string, Cost>>;
	/** Each layer's batches drawn as an InstancedMesh per piece instead: draws, all passes. */
	instanced: Record<string, number>;
	holds: Record<string, LayerHolds>;
}

interface Drawn {
	parent: THREE.Object3D | null;
	userData: Record<string, unknown>;
	material?: THREE.Material | THREE.Material[];
}

/** The layer a drawn object belongs to. */
export function layerOf(object: Drawn): string {
	for (let o: Drawn | null = object; o; o = o.parent)
		if (typeof o.userData.perfLayer === 'string') return o.userData.perfLayer;
	if (!object.parent) return 'post';
	const m = Array.isArray(object.material) ? object.material[0] : object.material;
	return m?.name || `other (${(object as { type?: string }).type})`;
}

interface Context {
	camera: THREE.Camera | null;
	mrt?: { outputNodes: Record<string, unknown> } | null;
}

/** The pass a render context draws: a shadow map, a hero light's cube, or a pipeline pass. */
export function passOf(context: Context | null, main: THREE.Camera | null): string {
	const camera = context?.camera;
	if (camera !== main && (camera as THREE.OrthographicCamera | undefined)?.isOrthographicCamera)
		return 'shadow';
	// A hero light's cube faces: square, 90° (hero-light-node.ts).
	const lens = camera as THREE.PerspectiveCamera | undefined;
	if (lens && lens !== main && lens.fov === 90 && lens.aspect === 1) return 'hero';
	// The pipeline's passes share one target name; their outputs tell them apart (passes.ts).
	const outputs = Object.keys(context?.mrt?.outputNodes ?? {});
	if (outputs.includes('emissive')) return 'scene';
	if (outputs.length) return 'prepass';
	// The overlay's pass draws with an unjittered copy of the view's camera (overlay.ts).
	return camera && camera !== main ? 'overlay' : 'output';
}

interface Batched {
	isBatchedMesh?: boolean;
	_multiDrawStarts: Int32Array;
	_multiDrawCount: number;
}

type Info = THREE.WebGPURenderer['info'] & {
	update(object: THREE.Object3D, count: number, instances: number): void;
};

/** A steady frame, and the same frame with the key light's shadow map drawn again in it. */
export interface LayerReports {
	steady: LayerReport;
	/** What any change to the table costs (a token moving): the sun's or moon's map redrawn. */
	shadowed: LayerReport;
}

/**
 * Draws the view twice (`draw`, the tabletop's own frame), counting each draw by layer and pass:
 * once as it is, once with every casting directional light's map due again (as a change to the
 * table makes it, renderer.ts `shadowsDirty`).
 */
export function layerReports(renderer: THREE.WebGPURenderer, draw: () => void): LayerReports {
	const steady = layerReport(renderer, draw);
	for (const root of steady.roots)
		root.traverse((o) => {
			const light = o as THREE.DirectionalLight;
			if (light.isDirectionalLight && light.castShadow) light.shadow.needsUpdate = true;
		});
	return { steady: steady.report, shadowed: layerReport(renderer, draw).report };
}

/** Draws one frame counting each draw by layer and pass; also the scenes it drew. */
function layerReport(renderer: THREE.WebGPURenderer, draw: () => void) {
	const info = renderer.info as Info;
	const own = info.update;
	const contextOf = () =>
		(renderer as unknown as { _currentRenderContext: Context | null })._currentRenderContext;
	type Drew = { object: THREE.Object3D; context: Context | null; triangles: number };
	const records: Drew[] = [];
	const instanced = new Map<string, number>();
	/** Each batch's passes counted so far, by render context. */
	const seen = new Map<object, Set<unknown>>();
	const roots = new Set<THREE.Object3D>();
	info.update = function (object, count, instances) {
		const before = this.render.triangles;
		own.call(this, object, count, instances);
		const context = contextOf();
		records.push({ object, context, triangles: this.render.triangles - before });
		let root = object;
		while (root.parent) root = root.parent;
		if (root !== object) roots.add(root);
		const b = object as unknown as Batched;
		if (!b.isBatchedMesh) return;
		const passes = seen.get(object) ?? seen.set(object, new Set()).get(object)!;
		if (passes.has(context)) return;
		passes.add(context);
		const pieces = new Set(b._multiDrawStarts.subarray(0, b._multiDrawCount)).size;
		const layer = layerOf(object);
		instanced.set(layer, (instanced.get(layer) ?? 0) + pieces);
	};
	try {
		draw();
	} finally {
		info.update = own;
	}
	// The view's camera: the scene pass's, the one with an emissive output (passes.ts).
	const main = records.find((r) => r.context?.mrt?.outputNodes.emissive)?.context?.camera ?? null;
	const passes: LayerReport['passes'] = {};
	for (const r of records) {
		const layer = layerOf(r.object);
		// An effect's quad (no parent) is drawn by its own orthographic camera: not a shadow.
		const pass = (passes[layer === 'post' ? 'post' : passOf(r.context, main)] ??= {});
		const cost = (pass[layer] ??= { draws: 0, triangles: 0 });
		cost.draws++;
		cost.triangles += r.triangles;
	}
	const report: LayerReport = {
		total: { draws: info.render.drawCalls, triangles: info.render.triangles },
		passes,
		instanced: Object.fromEntries(instanced),
		holds: holdings(roots)
	};
	return { report, roots };
}

/** What each layer under `roots` holds: visible meshes, their instances, triangles and bytes. */
function holdings(roots: Iterable<THREE.Object3D>): Record<string, LayerHolds> {
	const out: Record<string, LayerHolds> = {};
	const counted = new Set<object>();
	const bytesOf = (g: THREE.BufferGeometry) => {
		if (counted.has(g)) return 0;
		counted.add(g);
		let n = g.index?.array.byteLength ?? 0;
		for (const a of Object.values(g.attributes))
			n += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
		return n;
	};
	for (const root of roots)
		root.traverseVisible((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			const h = (out[layerOf(mesh)] ??= { meshes: 0, instances: 0, triangles: 0, bytes: 0 });
			h.meshes++;
			h.bytes += bytesOf(mesh.geometry);
			const batch = o as THREE.BatchedMesh;
			const inst = o as THREE.InstancedMesh;
			const per = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3;
			if (batch.isBatchedMesh) {
				const all = (
					batch as unknown as {
						_instanceInfo: { active: boolean; visible: boolean; geometryIndex: number }[];
					}
				)._instanceInfo;
				for (const i of all) {
					if (!i.active || !i.visible) continue;
					h.instances++;
					h.triangles += (batch.getGeometryRangeAt(i.geometryIndex)?.count ?? 0) / 3;
				}
			} else if (inst.isInstancedMesh) {
				h.instances += inst.count;
				h.triangles += per * inst.count;
			} else {
				h.instances++;
				h.triangles += per;
			}
		});
	return out;
}

// GPU time (#166) and benchmarks, `?perf` only: perf.ts's `perfMethods` loads them with this.

/**
 * Whether frames are timed by timestamp queries: asked for (`?perf`), the GPU
 * has them, and it is a real GPU.
 */
function timestamps(renderer: THREE.WebGPURenderer): boolean {
	const b = backendOf(renderer);
	if (b.trackTimestamp !== true || (b.isWebGPUBackend !== true && b.disjoint == null)) return false;
	// A software GPU's timestamps mean nothing (SwiftShader reports 0, or its latency).
	return !isSoftware(gpuInfo(renderer).adapter);
}

/**
 * The passes a frame's GPU time is reported by, from the name three gives each render: our
 * passes' names (post.ts), and the quads of three's effects. `output` is the pipeline's last pass
 * (with FXAA, the render to its input too); `blur` is tilt-shift's, and depth of field's own CoC
 * blur when both run. Shadow maps draw inside the pass that draws the scene.
 */
const PASSES: readonly (readonly [RegExp, string])[] = [
	[/^prepass$/, 'prepass'],
	[/^scene$/, 'scene'],
	[/^overlay$/, 'overlay'],
	[/^haze$/, 'haze'], // heat haze's half-resolution pass (haze.ts, #326)
	// The sky's capture into the environment (sky.ts `envScene`) and PMREM's filter quads.
	[/^pmrem$|^PMREM_/, 'pmrem'],
	[/^SSAO\b|^AO$/, 'ao'],
	[/^TRAA$|^Sharpen\b/, 'traa'],
	[/^SMAANode\b/, 'smaa'],
	[/^DoF\b/, 'dof'],
	[/^Gaussian Blur\b/, 'blur'],
	[/^Bloom\b/, 'bloom'],
	[/^Render Pipeline$|\bRTT\b/, 'output']
];

/** The pass a render named `name` belongs to (GPU time, #166); `other` for anything else. */
export function passNamed(name: string): string {
	return PASSES.find(([re]) => re.test(name))?.[1] ?? 'other';
}

/**
 * GPU ms per frame, whole and by pass, from resolved durations by timestamp id (`…:f<frame>`)
 * and the names seen for those ids. Null when no frame was timed.
 */
export function byPass(
	durations: Iterable<[string, number]>,
	names: ReadonlyMap<string, string>
): { total: number; passes: Record<string, number> } | null {
	const frames = new Set<string>();
	const passes: Record<string, number> = {};
	let total = 0;
	for (const [uid, ms] of durations) {
		frames.add(uid.slice(uid.lastIndexOf(':f')));
		const pass = passNamed(names.get(uid) ?? '');
		passes[pass] = (passes[pass] ?? 0) + ms;
		total += ms;
	}
	if (!frames.size) return null;
	for (const pass in passes) passes[pass] /= frames.size;
	return { total: total / frames.size, passes };
}

/** The durations the last resolve read, by timestamp id; empty where there are none. */
function resolved(renderer: THREE.WebGPURenderer): Map<string, number> {
	const pools = (
		renderer.backend as unknown as {
			timestampQueryPool?: { render?: { timestamps: Map<string, number> } };
		}
	).timestampQueryPool;
	return pools?.render?.timestamps ?? new Map();
}

/** The names `PassNames` saw by timestamp id, when it is the renderer's inspector. */
function namesOf(renderer: THREE.WebGPURenderer): Map<string, string> | null {
	return (renderer.inspector as unknown as { passNames?: Map<string, string> }).passNames ?? null;
}

/**
 * Reads the last resolve by pass, then forgets it and those ids' names. On WebGL2 only the
 * frame's total is real: every pass draws inside the pipeline's last render, and WebGL's timer
 * queries do not nest, so that one render is all it times. Its passes are then null.
 */
function readPasses(renderer: THREE.WebGPURenderer) {
	const durations = resolved(renderer);
	const names = namesOf(renderer) ?? new Map<string, string>();
	const read = byPass(durations, names);
	const result = read && (backendOf(renderer).isWebGPUBackend ? read : { ...read, passes: null });
	// A resolve with nothing new leaves the last one's durations: read each only once.
	for (const uid of durations.keys()) names.delete(uid);
	durations.clear();
	return result;
}

/**
 * Reads the timestamps of the frames drawn since the last sample: `gpuMs` is
 * their GPU time per frame. Also keeps the query pool from filling up while
 * `?perf` records a timestamp for every frame. Nothing without timestamps.
 */
export async function sampleGpu(renderer: THREE.WebGPURenderer, perf: PerfRecorder): Promise<void> {
	if (!timestamps(renderer) || perf.benchmarking || perf.sampling) return;
	const frames = perf.frames - perf.sampledAt;
	perf.sampledAt = perf.frames;
	perf.sampling = true;
	try {
		// WebGL2's results arrive as frames are presented: on an idle table this can take a while.
		// (The resolve returns only the last frame's total: the durations give every frame's.)
		await renderer.resolveTimestampsAsync('render');
		const read = readPasses(renderer);
		if (frames > 0 && read) {
			perf.gpuMs = read.total;
			perf.gpu = read.passes;
		}
	} finally {
		perf.sampling = false;
	}
}

/**
 * Draws the current view `frames` times, timing each: the main thread's ms
 * (`cpu`) and the GPU's, by timestamp queries where the renderer has them,
 * else by waiting until the frame is drawn (reading a pixel back on WebGL2,
 * `onSubmittedWorkDone` on WebGPU). `draw` draws one frame as the tabletop does, once `warming`
 * (the warm-up under way, warmup.ts) has settled: a warm-up keeps the scene pass's target and
 * outputs set while it compiles, and a frame drawn then builds WebGPU pipelines for them (the
 * output stage's quad with the scene pass's three colour targets, #379).
 */
export async function benchmark(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	draw: () => void,
	frames: number,
	warming: () => Promise<void> = () => Promise.resolve()
): Promise<Benchmark> {
	const { gl, device } = backendOf(renderer);
	const timer: GpuTimer = timestamps(renderer) ? 'timestamp' : gl || device ? 'sync' : 'none';
	const pixel = new Uint8Array(4);
	let cpu = 0;
	let gpu = 0;
	const passes: Record<string, number> = {};
	perf.benchmarking = true;
	try {
		// Earlier frames' timestamps would count toward the first frame.
		if (timer === 'timestamp') {
			await renderer.resolveTimestampsAsync('render');
			readPasses(renderer);
		}
		for (let i = 0; i < frames; i++) {
			await warming().catch(() => {});
			const start = performance.now();
			draw();
			cpu += performance.now() - start;
			if (timer === 'timestamp') {
				gpu += (await renderer.resolveTimestampsAsync('render')) ?? 0;
				for (const [pass, ms] of Object.entries(readPasses(renderer)?.passes ?? {}))
					passes[pass] = (passes[pass] ?? 0) + ms / frames;
				continue;
			}
			if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			else if (device) await device.queue.onSubmittedWorkDone();
			gpu += performance.now() - start;
		}
	} finally {
		perf.benchmarking = false;
		perf.sampledAt = perf.frames;
	}
	return {
		cpu: cpu / frames,
		gpu: timer === 'none' ? NaN : gpu / frames,
		passes: timer === 'timestamp' && backendOf(renderer).isWebGPUBackend ? passes : null,
		gpuTimer: timer,
		drawCalls: renderer.info.render.drawCalls
	};
}
