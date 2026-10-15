// The water layer (#293), a lazy chunk of its own (`water` in scripts/check-bundle.mjs) with the
// water kind's graphs (materials/water.ts) and the shore map (#292): the renderer and the lobby
// load it before making a table or a gallery. Every body of water the viewer knows is drawn per
// 16x16 chunk as two meshes, wadeable and deep (world/shore.ts `waterClasses` from `obstaclesFor`
// and `canStep`; world/water.ts the quads), over the bed the ground's chunks carve (`WATER_BED`):
// at most three draws a chunk with the bed. A chunk is rebuilt when its water, levels or class
// changed. Rings lie round the minis standing in wadeable water, one InstancedMesh, following
// where `TokenLayer` has them (its tweens) while they move. The look is the environment's water
// preset (its material's `water`, its normal map the ripples), uniforms only. On high and up the
// water refracts, foams round what stands in it and throws caustics (#298, water-high.ts): other
// materials, swapped in by `setTier` when the pipeline is built, never in play.
//
// Water casts no shadow, never asks the sun's shadow to redraw and is never picked (cells are
// picked by maths, #246). `tick` moves the world's clock (`worldTime`) only while a water mesh is
// in the camera's frustum and motion is allowed: those are AMBIENT frames; otherwise none.
//
// Rivers drift down the flow map (#295, the shore map's twin), and a run of drop edges hangs a
// waterfall (`fall`, one mesh a chunk, `falls()` for #311's mist). Lava floors (#297) are the
// water cells' quads on the lava graph, a mesh a chunk; a molten chasm's floor is the world
// layer's on the same graph (`attach`), and the sea ring is the landscape's on deep water's,
// which swells beyond the grid (#296).

import * as THREE from 'three/webgpu';
import { FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { WorldLook } from '$lib/game/world';
import { loadManifest, manifestNow } from '$lib/assets/load';
import { loadTexture } from './environment';
import {
	addInstanceTints,
	createMaterial,
	PIECE_MIN,
	remake,
	twinOf,
	uploadInstances,
	worldTime,
	type KindMaterial
} from './materials';
import { setFlow, setRipples, setShore, setSwell, setWaterLook } from './materials/water';
import { daylight } from './materials/water-high';
import './materials/lava'; // the lava variant (#297), registered over the water's graphs
import type { WorldGround } from './landscape';
import type { PerfRecorder } from './perf';
import type { QualitySettings, Tier } from './quality';
import { ShoreMap } from './shore-map';
import type { WorldBuilders, WorldLayer } from './world-layer';
import type { Fall } from './world/water';
import type { WorldShape } from './world/shape';

/** `worldTime` wraps every hour (world-layer.ts): every flow comes round whole by then. */
const WRAP_S = 3600;
/** A wading ring: its radii in cells, a hair over the surface, and its foam. */
const RING = { inner: 0.36, outer: 0.47, lift: 0.004, color: 0xeaf6f2, opacity: 0.5 };
const WADE = 1;
const LAVA = FLOOR_IDS.indexOf('lava');
/** `WATER_CLASS.lava` (world/shore.ts). */
const LAVA_CLASS = 3;
/**
 * Whether an asset is a liquid sheet (#294), which this layer draws: no until the manifest is in.
 * (`isLiquid` in manifest.ts, read here so the pages' shared chunk needn't export it.)
 */
const liquidNow = (assetId: string): boolean =>
	manifestNow()?.models[assetId]?.liquid !== undefined;
/**
 * Whether water refracts (#298): high and ultra with the `refraction` layer on. Not with MSAA:
 * WebGPU can't copy a multisampled depth buffer into the single-sampled texture the water reads.
 */
export const refracts = (s: Pick<QualitySettings, 'tier' | 'msaa' | 'layers'>) =>
	(s.tier === 'high' || s.tier === 'ultra') && s.msaa === 0 && s.layers.refraction;
/** Each material with refraction on or off (#298), made once and kept both ways, as `twinOf`. */
const refraction = new WeakMap<KindMaterial, KindMaterial>();
/** The key light's intensity at the temperate sky's noon (assets/skies): caustics' full daylight. */
const NOON = 1.6;
/** Water's meshes under `?perf`'s `layers` (perf.ts `tagged`). */
const LAYER = { perfLayer: 'water' };

/** The geometry of a chunk without water of a class. Shared, never disposed. */
const EMPTY = new THREE.BufferGeometry();

interface Chunk {
	wade: THREE.Mesh;
	deep: THREE.Mesh;
	lava: THREE.Mesh;
	fall: THREE.Mesh;
	falls: Fall[];
}

/** A chunk's meshes, in the order of `WaterLayer.materials`. */
const KINDS = ['wade', 'deep', 'lava', 'fall'] as const;

export class WaterLayer {
	readonly group = new THREE.Group();
	readonly shore = new ShoreMap();
	/**
	 * Wadeable, deep, lava, falls (`KINDS`), then the molten chasm's lava (no bank, no rim) and the
	 * sea ring's deep water.
	 */
	private materials = [
		createMaterial('water', { antiTiled: true }),
		createMaterial('water', { deep: true, antiTiled: true }),
		createMaterial('water', { lava: true, deep: true, antiTiled: true }),
		createMaterial('water', { fall: true, antiTiled: true }),
		createMaterial('water', { lava: true, deep: true, antiTiled: true, params: { opacity: 0 } }),
		// The sea ring (#296): deep water's graph, never refracting (#298), so it copies no frame.
		createMaterial('water', { deep: true, antiTiled: true })
	];
	/** Where the sea ring and the molten chasm are drawn (`attach`). */
	private hosts: THREE.Object3D[] = [];
	private chunks: Chunk[] = [];
	/** What the chunks show: the shape, the classes, and the inputs they came from. */
	private drawn: { shape: WorldShape; classes: Uint8Array; inputs: unknown[] } | null = null;
	private readonly rings: THREE.InstancedMesh;
	private tokens: readonly Token[] = [];
	private ringsDue = true;
	/** Whether the minis moved on the last frame (`tick`). */
	private wasMoving = false;
	private standIns: THREE.Mesh[] | null = null;
	/** The tier and the sea's span: the swell's fourth wave and its haze (#296). */
	private tier: Tier = 'medium';
	private span: { fogNear: number; fogFar: number } | null = null;
	private environment: string | null | undefined = undefined;
	private readonly frustum = new THREE.Frustum();
	private readonly matrix = new THREE.Matrix4();
	private readonly at = new THREE.Vector3();
	/** The water cells (`cells`), kept while they are the same. */
	private wet: Uint8Array | null = null;
	/** The scene's key light (sky-light.ts `SkyLight`), found on the first tick. */
	private key: THREE.DirectionalLight | null = null;
	/** Every material the meshes have worn, for `dispose`. */
	private readonly worn = new Set<KindMaterial>(this.materials);

	constructor(
		private readonly build: WorldBuilders,
		private readonly perf: PerfRecorder,
		/** Where a mini is now (`TokenLayer.rootOf`), tweens and all. */
		private readonly rootOf: (id: string) => THREE.Object3D | null,
		/** Told when the environment's water has arrived, while any water is drawn. */
		private readonly onLook: () => void
	) {
		setShore(this.shore.texture);
		setFlow(this.shore.flow);
		const ring = new THREE.RingGeometry(RING.inner, RING.outer, 32).rotateX(-Math.PI / 2);
		addInstanceTints(ring, PIECE_MIN);
		const material = createMaterial('overlay', {
			instanced: true,
			params: { color: RING.color, opacity: RING.opacity }
		});
		this.rings = new THREE.InstancedMesh(ring, material, PIECE_MIN);
		this.rings.count = 0;
		this.rings.frustumCulled = false; // one draw, wherever the waders are
		this.rings.renderOrder = 1; // over the water it lies on
		this.rings.raycast = () => {};
		this.rings.userData = LAYER;
		this.group.add(this.rings);
	}

	/**
	 * The water for what the viewer was sent: the shore field, each cell's class and the chunks
	 * that changed; the waders; the environment's preset. Cheap when nothing changed (identity).
	 */
	update(
		grid: SquareGrid,
		shape: WorldShape,
		props: readonly Prop[],
		objects: readonly SceneObject[],
		tokens: readonly Token[],
		world: WorldLook | null,
		environment: string | null
	): void {
		this.shore.update(grid, shape, props, world, this.perf, this.build, liquidNow);
		this.setEnvironment(environment);
		if (tokens !== this.tokens) [this.tokens, this.ringsDue] = [tokens, true];
		const inputs = [shape, props, objects];
		if (this.drawn && inputs.every((v, i) => v === this.drawn!.inputs[i])) return;
		const walls = objects.filter((o) => o.kind === 'wall');
		const obstacles = obstaclesFor(grid, walls, props, shape.levels, shape.floor);
		// Lava (#297) lies among the water cells (`cells`), each its own class, never a body's.
		const molten = (i: number) => shape.water[i] === 1 && shape.floor[i] === LAVA;
		const water = shape.water.map((v, i) => (molten(i) ? 0 : v));
		const classes = this.build.waterClasses({ ...shape, water }, obstacles);
		for (let i = 0; i < classes.length; i++) if (molten(i)) classes[i] = LAVA_CLASS;
		const { levels, known, floor } = shape;
		const edges = this.build.dropEdges(grid, shape.water, levels, known, floor); // falls (#295)
		const was = this.drawn?.shape.grid === grid ? this.drawn : null;
		const dirty = new Set([
			...this.build.dirtyChunks(was?.shape ?? null, shape),
			...this.build.dirtyWaterChunks(shape, was?.classes ?? null, classes)
		]);
		const { x, y } = this.build.chunksAcross(grid);
		this.resize(x * y);
		for (const c of dirty) this.perf.time('water-chunk', () => this.fill(shape, classes, edges, c));
		this.drawn = { shape, classes, inputs };
		this.ringsDue = true;
	}

	/** `props` without the liquid sheets (#294): the prop layer draws no mesh for them. */
	dry(props: readonly Prop[]): readonly Prop[] {
		const wet = props.some((p) => liquidNow(p.assetId));
		return wet ? props.filter((p) => !liquidNow(p.assetId)) : props;
	}

	/**
	 * The water cells (#293): the water floor's and the liquid sheets' (#294), the same array while
	 * they are the same, so the world's shape is made again only when they change.
	 */
	cells(grid: SquareGrid, floor: Uint8Array | null, props: readonly Prop[]): Uint8Array {
		const fit = floor?.length === grid.width * grid.height ? floor : null;
		const wet = this.build.waterCells(grid, fit, props, liquidNow);
		fit?.forEach((f, i) => f === LAVA && (wet[i] = 1)); // lava's bed and surface (#297)
		return (this.wet = this.wet?.join() === wet.join() ? this.wet : wet);
	}

	/**
	 * Before a frame: the rings where the waders are (while minis move, or after a change), and the
	 * world's clock while water is in view and motion is allowed, and the caustics' daylight. True
	 * for AMBIENT frames.
	 */
	tick(now: number, reduced: boolean, camera: THREE.Camera, moving: boolean): boolean {
		// A move's last frame puts the mini home but reports it still (`TokenLayer.tick`), so a frame
		// after one that moved places the rings too, or they'd stay a step behind (in the water when
		// the mini has walked out).
		if (moving || this.wasMoving || this.ringsDue) this.placeRings();
		this.wasMoving = moving;
		// The caustics' daylight (#298): the key light while it is the sun (atmosphere.ts casts the
		// moon's shadow at `MOON_SHADOW`, the sun's at 1), none under an enclosed sky (no key light).
		this.key ??= (this.group.parent?.getObjectByProperty('isDirectionalLight', true) ??
			null) as THREE.DirectionalLight | null;
		const sun = this.key?.shadow.intensity === 1 ? this.key.intensity : 0;
		daylight.value = Math.min(1, sun / NOON);
		if (reduced || !this.inView(camera)) return false;
		worldTime.value = (now / 1000) % WRAP_S;
		return true;
	}

	/**
	 * The tier's water, as the pipeline is built (one path, from the renderer's `applyTier`): the
	 * sea's fourth wave on high and ultra (#296), the ripples (#181's anti-tiling variant: two
	 * samples on medium and up, one on low; the swell's waves, lava's octaves and the falls' churn
	 * with them), and refraction for wadeable and deep water (#298, `refracts`; never lava, falls or
	 * the sea ring, which copy no frame). True if the materials changed.
	 */
	setTier(s: QualitySettings): boolean {
		this.tier = s.tier;
		this.swell();
		const anti = this.setAntiTiled(s.antiTile);
		const on = refracts(s);
		if (!!this.materials[0].options.refract === on) return anti;
		const other = (m: KindMaterial) => {
			let r = refraction.get(m);
			if (!r) refraction.set(m, (r = remake(m, { refract: on }))).set(r, m);
			return r;
		};
		this.use(this.materials.map((m, k) => (k < 2 ? other(m) : m)));
		return true;
	}

	/** The tier's ripples (`setTier`); the sea ring and the molten chasm follow. */
	setAntiTiled(on: boolean): boolean {
		if (!!this.materials[0].options.antiTiled === on) return false;
		this.use(this.materials.map(twinOf));
		return true;
	}

	/**
	 * Draws the sea ring with deep water (the landscape's `sea`) and the molten chasm with lava
	 * (the world layer's `molten`), and keeps them in step with the tier.
	 */
	attach(land: WorldGround, world: WorldLayer): void {
		this.hosts = [land.group, world.group];
		land.sea = (span) => {
			this.span = span;
			this.swell();
			return this.materials[5];
		};
		world.molten = () => this.materials[4];
	}

	/** Every waterfall on the table (#295): its foot's middle, width and drop; #311's mist. */
	falls(): Fall[] {
		return this.chunks.flatMap((c) => c.falls);
	}

	/** Stand-ins for the warm-up (#180): water may come only later (a pond painted, a lake found). */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // uv for the falls
			// The four kinds, and the sea ring's deep water: its own graph where deep water refracts
			// (#298, high and up), so a backdrop turned to the sea compiles nothing. The molten
			// chasm's is lava's graph.
			const ours = [...this.materials.slice(0, 4), this.materials[5]];
			this.standIns = ours.map((m) => this.mesh(m));
			for (const s of this.standIns) [s.geometry, s.frustumCulled] = [quad, false]; // standIn
		}
		return this.standIns;
	}

	dispose(): void {
		this.resize(0);
		this.standIns?.[0].geometry.dispose();
		this.rings.geometry.dispose();
		(this.rings.material as THREE.Material).dispose();
		for (const m of this.worn) m.dispose();
		setShore(null, this.shore.texture);
		setFlow(null, this.shore.flow);
		this.shore.texture.dispose();
		this.shore.flow.dispose();
	}

	/** The environment's water preset and ripples (#293), or the default; the old one meanwhile. */
	private setEnvironment(id: string | null): void {
		if (id === this.environment) return;
		this.environment = id;
		void loadManifest()
			.then(async (manifest) => {
				const name = id ? manifest.environments[id]?.water : undefined;
				const def = name ? manifest.materials[name] : undefined;
				const normal = def?.normal ? manifest.textures[def.normal] : undefined;
				const ripples = normal ? await loadTexture(def!.normal!, normal) : null;
				if (id !== this.environment) return; // another environment since
				setWaterLook(
					def?.water ? { ...def.water, color: def.color, roughness: def.roughness } : null
				);
				setRipples(ripples);
				if (this.drawsWater()) this.onLook(); // a dry table draws nothing for it
			})
			.catch(() => {});
	}

	/** Puts `next` (in `materials`' order) on every mesh, the sea ring, the chasm and stand-ins too. */
	private use(next: KindMaterial[]): void {
		const was = this.materials;
		this.materials = next;
		for (const m of next) this.worn.add(m);
		const swap = (o: THREE.Object3D) => {
			const k = was.indexOf((o as THREE.Mesh).material as KindMaterial);
			if (k >= 0) (o as THREE.Mesh).material = next[k];
		};
		for (const root of [this.group, ...this.hosts]) root.traverse(swap);
		this.standIns?.forEach(swap);
	}

	/** The swell's haze and waves for the tier and the sea's span. */
	private swell(): void {
		const span = this.span ?? { fogNear: 1e6, fogFar: 2e6 };
		setSwell(span.fogNear, span.fogFar, this.tier !== 'low' && this.tier !== 'medium');
	}

	/** Whether any water is drawn: a chunk's, the sea ring or the molten chasm. */
	private drawsWater(): boolean {
		const ours = new Set<THREE.Material>(this.materials);
		let found = false;
		for (const root of this.hosts)
			root.traverseVisible((o) => {
				found ||= ours.has((o as THREE.Mesh).material as THREE.Material);
			});
		return found || this.chunks.some((c) => KINDS.some((k) => c[k].visible));
	}

	/** Whether any water mesh is in `camera`'s view. */
	private inView(camera: THREE.Camera): boolean {
		this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.frustum.setFromProjectionMatrix(this.matrix);
		const sees = (m: THREE.Mesh) =>
			m.visible && this.frustum.intersectsSphere(m.geometry.boundingSphere!);
		const sea = this.hosts[0]?.children.find(
			(m) => (m as THREE.Mesh).material === this.materials[5]
		);
		return (
			(!!sea && sees(sea as THREE.Mesh)) || // the ring swells (#296)
			this.chunks.some((c) => KINDS.some((k) => sees(c[k])))
		);
	}

	/** A ring under each mini standing in wadeable water, where it is now. */
	private placeRings(): void {
		this.ringsDue = false;
		const drawn = this.drawn;
		let n = 0;
		if (drawn) {
			const { grid } = drawn.shape;
			const cs = grid.cellSize;
			for (const t of this.tokens) {
				const root = this.rootOf(t.id);
				if (!root || n === PIECE_MIN) continue;
				const [x, z] = [root.position.x, root.position.z];
				const [cx, cy] = [
					Math.floor(x / cs + grid.width / 2),
					Math.floor(z / cs + grid.height / 2)
				];
				if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
				const i = cy * grid.width + cx;
				if (drawn.classes[i] !== WADE) continue;
				const y = this.build.surfaceY(drawn.shape, drawn.classes, i) + RING.lift * cs;
				const size = cs * (t.scale ?? 1);
				this.matrix.makeScale(size, 1, size).setPosition(this.at.set(x, y, z));
				this.rings.setMatrixAt(n++, this.matrix);
			}
		}
		this.rings.count = n;
		uploadInstances(this.rings.instanceMatrix, n); // not the whole pool (#334)
	}

	/** Chunk `c`'s wadeable, deep and lava surfaces, and its waterfalls. */
	private fill(
		shape: WorldShape,
		classes: Uint8Array,
		edges: ReturnType<WorldBuilders['dropEdges']>,
		c: number
	): void {
		const fall = this.build.chunkFalls(shape, classes, edges, c);
		const quads = { ...this.build.chunkWater(shape, classes, c), fall };
		this.chunks[c].falls = fall.falls;
		for (const kind of KINDS) {
			const mesh = this.chunks[c][kind];
			const { positions, indices } = quads[kind];
			if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
			mesh.visible = indices.length > 0;
			if (!mesh.visible) {
				mesh.geometry = EMPTY;
				continue;
			}
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			const up = new Float32Array(positions.length);
			for (let k = 1; k < up.length; k += 3) up[k] = 1;
			const normals = kind === 'fall' ? fall.normals : up;
			geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
			if (kind === 'fall') geometry.setAttribute('uv', new THREE.BufferAttribute(fall.uvs, 2));
			geometry.setIndex(new THREE.BufferAttribute(indices, 1));
			geometry.computeBoundingSphere();
			mesh.geometry = geometry;
		}
	}

	/** A water mesh: takes shadows, casts none, never picked. */
	private mesh(material: KindMaterial): THREE.Mesh {
		const mesh = new THREE.Mesh(EMPTY, material);
		mesh.receiveShadow = true;
		mesh.raycast = () => {};
		mesh.userData = LAYER;
		return mesh;
	}

	private resize(count: number): void {
		while (this.chunks.length > count) {
			const c = this.chunks.pop()!;
			for (const k of KINDS) {
				if (c[k].geometry !== EMPTY) c[k].geometry.dispose();
				c[k].removeFromParent();
			}
		}
		while (this.chunks.length < count) {
			const [wade, deep, lava, fall] = this.materials.slice(0, 4).map((m) => this.mesh(m));
			const c: Chunk = { wade, deep, lava, fall, falls: [] };
			for (const k of KINDS) c[k].visible = false;
			this.group.add(wade, deep, lava, fall);
			this.chunks.push(c);
		}
	}
}

/** The layer, once the manifest (the liquid flag) is in or failed: the renderer waits for it. */
export const ready = loadManifest()
	.catch(() => {})
	.then(() => WaterLayer);
