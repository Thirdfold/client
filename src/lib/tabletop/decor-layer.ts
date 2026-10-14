// The decor layer (M74 #305), a lazy chunk of its own (`decor` in scripts/check-bundle.mjs): the
// small ground decoration an environment's scatter rules lay (world/scatter.ts), drawn with one
// InstancedMesh per decor model the rules use. The renderer awaits `ready` with the water layer
// and the wind field; the CPU side (`scatterChunk` and its dirty rule) is the world chunk's,
// reached through `build`.
//
// Everything is the viewer's: the shape, the props and the roof mask they were sent, so the same
// knowledge draws the same instances (the specs compare the CPU side, which is all there is).
// Chunks are worked out again when their inputs changed (`scatterDirty`: painting ground touches
// only its chunks), and a decor model's instances are written again when one of its chunks gave
// different ones. Plants (a model with wind weights) wear the foliage kind and sway on the wind
// field; the rest wear the prop kind. Meshes are pool-sized (`PIECE_MIN`), so growing one compiles
// nothing, and the materials are the kinds' variants the lobby warms. Decor takes shadows and casts
// none, is never picked, and is thinned by the tier's `vegetation.scatter` density through the thinning key
// carried in each instance's tint.
//
// It also owns the decal layer (#307, decals.ts, a lazy chunk of its own fetched with this one),
// whose inputs are the same: so the renderer wires neither. `decals` is its API (#313's transients).

import * as THREE from 'three/webgpu';
import { loadManifest, manifestNow } from '$lib/assets/load';
import type { Manifest } from '$lib/assets/manifest';
import type { ScatterRule } from '$lib/assets/scatter';
import type { CellMask } from '$lib/game/visibility';
import type { Prop } from '$lib/game/props';
import { addInstanceTints, createMaterial, PIECE_MIN, PAINT_ATTRIBUTE } from './materials';
import { WIND_ATTRIBUTE } from './materials/kinds';
import { loadModel, modelNow, partsOf } from './models';
import type { PerfRecorder } from './perf';
import type { QualitySettings } from './quality';
import type { WorldShape } from './world/shape';
import type { WorldBuilders } from './world-layer';
import type { DecalLayer } from './decals';

/** The wind field's `windOn` (materials/wind.ts, a chunk of its own), set when `ready` resolves. */
let windOn = (): boolean => false;
/** The decal layer's class (decals.ts, a chunk of its own), set when `ready` resolves. */
let Decals: typeof DecalLayer;
const WIND_MARGIN = 0.4;
/** Prop and foliage materials both take the vertex colours the models bake (`MODEL` in prop-buckets.ts). */
const MODEL = { instanced: true, vertexColors: true } as const;
/** Instance buffers grow by this much, so growing is rare. */
const GROWTH = 1.5;

interface DecorMesh {
	/** One mesh per body part of the model, all written alike. */
	parts: { mesh: THREE.InstancedMesh; paint: THREE.InterleavedBufferAttribute }[];
	capacity: number;
	/** Wears the foliage kind and sways. */
	sways: boolean;
}

/** A decor model's size at scale 1 from its manifest bounds: its height and radius about its origin. */
function sizeOf(manifest: Manifest, id: string) {
	const b = manifest.models[id]?.bounds;
	if (!b) return undefined;
	const reach = (lo: number, hi: number) => Math.max(Math.abs(lo), Math.abs(hi));
	return {
		height: b.max[1],
		radius: Math.hypot(reach(b.min[0], b.max[0]), reach(b.min[2], b.max[2]))
	};
}

export class DecorLayer {
	readonly group = new THREE.Group();
	private readonly plain = createMaterial('prop', MODEL);
	private readonly plants = createMaterial('foliage', MODEL);
	private meshes = new Map<string, DecorMesh>();
	/** Each chunk's decor, and the box round the plants in it (null if it has none). */
	private chunks: (ReturnType<WorldBuilders['scatterChunk']> | undefined)[] = [];
	private boxes: (THREE.Box3 | null)[] = [];
	private input: Parameters<WorldBuilders['scatterChunk']>[0] | null = null;
	private rules: readonly ScatterRule[] = [];
	private sizes: Record<string, { height: number; radius: number }> = {};
	private interior: CellMask | null = null;
	private density = 1;
	private last: Parameters<DecorLayer['update']> | null = null;
	private readonly frustum = new THREE.Frustum();
	private readonly matrix = new THREE.Matrix4();
	private disposed = false;
	/** Grime, moss, soot and the rest (#307): one draw, in this layer's group. */
	readonly decals: DecalLayer;

	constructor(
		private readonly build: WorldBuilders,
		private readonly perf: PerfRecorder,
		/** Told when something new has been drawn. */
		private readonly request: () => void
	) {
		this.decals = new Decals(build, perf, request);
		this.group.add(this.decals.mesh);
	}

	/** The decals' stand-in for the warm-up (#180): the lobby's gallery. */
	static gallery(): THREE.Object3D[] {
		return Decals.gallery();
	}

	/** The roofed cells as sent: outdoor rules lay nothing under a roof. */
	setInterior(next: CellMask | null): void {
		this.interior = next;
	}

	/**
	 * The decor for what the viewer was sent. `settings`: the tier's `vegetation.scatter` density, and the
	 * `scatter` layer's switch. `interior`: the roofed cells as sent (`setInterior`'s). Cheap when
	 * nothing changed (identity); the manifest or a model arriving later draws it again.
	 */
	update(
		shape: WorldShape,
		props: readonly Prop[],
		environment: string | null,
		settings: Pick<QualitySettings, 'vegetation' | 'layers' | 'tier'>,
		interior: CellMask | null = this.interior
	): void {
		this.interior = interior;
		this.last = [shape, props, environment, settings];
		this.decals.update(shape, props, environment, settings, interior); // #307
		const manifest = manifestNow();
		if (!manifest) {
			void loadManifest().then(
				() => this.last && this.update(...this.last),
				() => {}
			);
			return;
		}
		const density = settings.layers.scatter ? settings.vegetation.scatter : 0;
		const rules = (environment && manifest.environments[environment]?.scatter) || NONE;
		if (rules !== this.rules) {
			this.rules = rules;
			this.sizes = {};
			for (const { decor } of rules) {
				this.sizes[decor] = sizeOf(manifest, decor)!;
				void loadModel(decor, undefined, 'low').then(() => this.draw());
			}
		}
		const input = {
			shape,
			interior: this.interior,
			props,
			environment: environment ?? '',
			rules,
			sizes: this.sizes
		};
		const dirty = this.build.scatterDirty(this.input, input);
		const thinned = density !== this.density;
		if (!dirty.length && !thinned && this.input) return;
		if (this.input?.shape.grid !== shape.grid) this.chunks = [];
		this.input = input;
		this.density = density;
		// The decor models whose instances differ now: those of a dirty chunk that changed, all if thinned.
		const changed = new Set<string>(thinned ? Object.keys(this.sizes) : []);
		const ctx = this.build.scatterContext(input);
		this.perf.time('scatter', () => {
			for (const c of dirty) {
				const next = this.build.scatterChunk(input, c, ctx);
				for (const id of new Set([...(this.chunks[c]?.keys() ?? []), ...next.keys()]))
					if (!sameArray(this.chunks[c]?.get(id), next.get(id))) changed.add(id);
				this.chunks[c] = next;
			}
		});
		this.boxes = [];
		for (const id of [...this.meshes.keys()]) if (!this.sizes[id]) this.drop(id);
		for (const id of changed) this.write(id);
		this.draw();
	}

	/** True for AMBIENT frames: plants sway while the wind blows and some are in view. */
	tick(camera: THREE.Camera): boolean {
		this.decals.tick(); // transients' expiry, on drawn frames (#307)
		if (!windOn()) return false;
		const swaying = [...this.meshes.values()].some(
			(m) => m.sways && (m.parts[0]?.mesh.count ?? 0) > 0
		);
		if (!swaying) return false;
		this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.frustum.setFromProjectionMatrix(this.matrix);
		return this.chunks.some((chunk, c) => {
			if (!chunk) return false;
			this.boxes[c] ??= this.plantBox(chunk);
			return !!this.boxes[c] && this.frustum.intersectsBox(this.boxes[c]!);
		});
	}

	dispose(): void {
		this.disposed = true;
		for (const id of [...this.meshes.keys()]) this.drop(id);
		this.plain.dispose();
		this.plants.dispose();
		this.decals.dispose();
	}

	/** A model has arrived: the decor that waited for it is written, and drawn. */
	private draw(): void {
		if (this.disposed) return;
		for (const id of Object.keys(this.sizes)) if (!this.meshes.has(id)) this.write(id);
		this.request();
	}

	/** Decor model `id`'s mesh, made or grown for `n` instances; null until its model has loaded. */
	private meshFor(id: string, n: number): DecorMesh | null {
		const model = modelNow(id);
		if (!model || model.preview) return null;
		const have = this.meshes.get(id);
		if (have && have.capacity >= n) return have;
		if (have) this.drop(id);
		const capacity = Math.max(PIECE_MIN, Math.ceil(n * GROWTH));
		const bodies = partsOf(model, 'body');
		// A plant is a model with wind weights; the foliage kind sways by them, the prop kind does not.
		const sways = bodies.some((p) => {
			const wind = p.geometry.getAttribute(WIND_ATTRIBUTE);
			return !!wind && Array.from(wind.array).some((w) => w > 0);
		});
		const decor: DecorMesh = { capacity, sways, parts: [] };
		for (const part of bodies) {
			const geometry = part.geometry.clone();
			addInstanceTints(geometry, capacity);
			const mesh = new THREE.InstancedMesh(geometry, sways ? this.plants : this.plain, capacity);
			mesh.count = 0;
			mesh.frustumCulled = false; // one draw wherever the table is; chunks are not culled
			mesh.castShadow = false; // the ambient occlusion grounds it
			mesh.receiveShadow = true;
			mesh.raycast = () => {};
			mesh.userData.perfLayer = 'scatter';
			this.group.add(mesh);
			decor.parts.push({
				mesh,
				paint: geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.InterleavedBufferAttribute
			});
		}
		this.meshes.set(id, decor);
		return decor;
	}

	/** Writes decor model `id`'s instances (thinned by the density) into its meshes. */
	private write(id: string): void {
		const stride = this.build.DECOR_STRIDE;
		const lists = this.chunks.flatMap((c) => c?.get(id) ?? []);
		const kept = lists.map((f) => {
			const keep: number[] = [];
			for (let k = 0; k < f.length; k += stride)
				if (this.build.thinKey(f[k + 5]) < this.density) keep.push(k);
			return keep;
		});
		const total = kept.reduce((n, keep) => n + keep.length, 0);
		const decor = total || this.meshes.has(id) ? this.meshFor(id, total) : null;
		if (!decor) return;
		let n = 0;
		lists.forEach((f, l) => {
			for (const k of kept[l]) {
				const [x, y, z, yaw, scale, tint] = f.subarray(k, k + stride);
				const [c, s] = [Math.cos(yaw) * scale, Math.sin(yaw) * scale];
				const shade = 0.8 + 0.4 * tint;
				for (const { mesh, paint } of decor.parts) {
					// Turned about y, scaled, then put at (x, y, z): a column-major matrix.
					const m = mesh.instanceMatrix.array as Float32Array;
					const at = n * 16;
					m[at] = c;
					m[at + 2] = -s;
					m[at + 5] = scale;
					m[at + 8] = s;
					m[at + 10] = c;
					m[at + 12] = x;
					m[at + 13] = y;
					m[at + 14] = z;
					m[at + 15] = 1;
					paint.setXYZ(n, shade, shade, shade);
				}
				n++;
			}
		});
		for (const { mesh, paint } of decor.parts) {
			mesh.count = n;
			mesh.instanceMatrix.needsUpdate = true;
			paint.data.needsUpdate = true;
		}
	}

	private drop(id: string): void {
		for (const { mesh } of this.meshes.get(id)?.parts ?? []) {
			mesh.removeFromParent();
			mesh.geometry.dispose(); // its own copy of the model's
			mesh.dispose();
		}
		this.meshes.delete(id);
	}

	/** The box round the swaying plants of one chunk, or null if it has none. */
	private plantBox(chunk: NonNullable<DecorLayer['chunks'][number]>): THREE.Box3 | null {
		const box = new THREE.Box3();
		for (const [id, f] of chunk) {
			if (!this.meshes.get(id)?.sways) continue;
			for (let k = 0; k < f.length; k += this.build.DECOR_STRIDE)
				box.expandByPoint(new THREE.Vector3(f[k], f[k + 1], f[k + 2]));
		}
		return box.isEmpty() ? null : box.expandByScalar(WIND_MARGIN);
	}
}

const NONE: readonly ScatterRule[] = [];
const sameArray = (a?: Float32Array, b?: Float32Array) =>
	a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * The layer, once the wind field is in (its foliage graph is registered, and `windOn` is read) and
 * the decals' chunk (#307, its graph registered too).
 */
export const ready = Promise.all([import('./materials/wind'), import('./decals')]).then(
	([wind, decals]) => {
		windOn = wind.windOn;
		Decals = decals.DecalLayer;
		return DecorLayer;
	}
);
