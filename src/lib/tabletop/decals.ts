// The decal layer (M74 #307), a lazy chunk of its own (`decals` in scripts/check-bundle.mjs) that
// the decor layer fetches and owns: grime, moss, damp, soot, scorch, cracks, leaf litter and blood
// on floors and wall faces, every one of them in one draw: a single InstancedMesh of a unit quad on
// the decal kind's `sheet` variant (an atlas is a sheet), whose graph is registered here
// (`lazyGraphs.decal`) before any material of it is made. docs/RENDERING.md, "Decals".
//
// Where they lie is the world chunk's (`decalsFor`, world/decal-rules.ts), from only what the
// viewer was sent; worked out again only when the shape (floors, levels, walls, what is explored),
// the props, the roofs or the environment changed (identity). Per instance: its matrix (a floor
// decal lies flat at its floor, a wall decal stands on the wall's face) and `aDecal` (the atlas
// cell, opacity, shade, and a spare for #313's wetness), so no instance needs a program of its own.
// Blended with straight alpha over a dilated atlas (decal-art.ts), depth tested and never written,
// pulled forward by a polygon offset, lit like the surface under it, no emissive, cast no shadow,
// take the sun's, and `worldModify` composed: nothing on a player's unexplored cell (exactly 0,
// as every kind), darkened in the dark. Capped per tier (`VEGETATION[tier].decalCap`, the lowest thinning keys kept)
// and off with `?off=decals`.
//
// Transient decals (#313, M75): `addTransient` lays one on a cell the caller saw, up to the tier's
// `TRANSIENT_CAPS` (the oldest recycled); expired ones go on the next drawn frame (`tick`), which
// never asks for a frame of its own.

import * as THREE from 'three/webgpu';
import { float as tslFloat } from 'three/tsl';
import { DECAL_ACROSS, DECAL_TEXTURES, type DecalKey, type DecalRule } from '$lib/assets/decals';
import { loadManifest, manifestNow } from '$lib/assets/load';
import type { GridPos } from '$lib/game/grid';
import type { Prop } from '$lib/game/props';
import type { CellMask } from '$lib/game/visibility';
import { loadTexture } from './environment';
import { createMaterial, setSlot, type KindMaterial } from './materials';
import { lazyGraphs, type Graph } from './materials/kinds';
import { slotDefault } from './materials/defaults';
import { mipBias } from './materials/texture-quality';
import { tsl, type N } from './materials/tsl';
import { worldModify } from './materials/world-modify';
import type { PerfRecorder } from './perf';
import type { QualitySettings, Tier } from './quality';
import type { WorldShape } from './world/shape';
import { VEGETATION } from './world/vegetation-tiers';
import type { WorldBuilders } from './world-layer';

/** The most transient decals at once, by tier. */
export const TRANSIENT_CAPS: Record<Tier, number> = { low: 16, medium: 32, high: 64, ultra: 64 };
const CAPACITY = VEGETATION.ultra.decalCap + TRANSIENT_CAPS.ultra;
/** Per instance: the atlas cell, opacity, shade, and a spare (#313's wetness). */
export const DECAL_ATTRIBUTE = 'aDecal';
/** How much the mask's cavity darkens the albedo. */
const CAVITY = 0.5;

const float = (x: number) => tslFloat(x) as unknown as N;

/**
 * A slot of the drawn material sampled at `at`, as hooks.ts's `slotSample` (kept here: importing it
 * would add an export to the renderer chunk, at its cap): its texture node at `at`, with the tier's
 * mip bias and never the texture's own matrix.
 */
function slot(name: 'albedo' | 'normal' | 'orm', at: N): N {
	const ref = tsl.materialReference(`${name}Slot`, 'texture') as N & { node: unknown };
	ref.node = tsl.texture(slotDefault(name), at, null, mipBias).setUpdateMatrix(false);
	return ref;
}

/**
 * The view normal bent by a tangent-space normal map sampled at `at`, in the frame the screen
 * derivatives of `at` make (as mapping.ts's `perturbNormal`, kept here for the same reason).
 */
function bumped(sampled: N, at: N): N {
	const [n, normal] = [sampled.mul(2).sub(1), tsl.normalView];
	const q1 = tsl.positionView.dFdy().cross(normal);
	const q0 = normal.cross(tsl.positionView.dFdx());
	const [st0, st1] = [at.dFdx(), at.dFdy()];
	const t = q1.mul(st0.x).add(q0.mul(st1.x));
	const b = q1.mul(st0.y).add(q0.mul(st1.y));
	const det = tsl.max(t.dot(t), b.dot(b));
	const scale = det.equal(0).select(0, det.inverseSqrt());
	return t.mul(scale).mul(n.x).add(b.mul(scale).mul(n.y)).add(normal.mul(n.z)).normalize();
}

/** The decal kind's `sheet` graph: the atlas cell's albedo, normal and mask, lit, then the world's. */
function decalGraph(): Graph {
	const param = (name: string, type: string) => tsl.materialReference(`params.${name}`, type);
	const each = tsl.attribute(DECAL_ATTRIBUTE, 'vec4');
	const corner = tsl.vec2(each.x.mod(DECAL_ACROSS), each.x.div(DECAL_ACROSS).floor());
	const at = corner.add(tsl.uv()).div(DECAL_ACROSS);
	const [albedo, mask] = [slot('albedo', at), slot('orm', at)];
	const shade = each.z.mul(mask.y.mul(-CAVITY).add(1));
	return {
		colorNode: tsl.vec4(albedo.xyz.mul(param('color', 'color')).mul(shade), 1),
		opacityNode: albedo.w.mul(each.y).mul(param('opacity', 'float')),
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, tsl.vec3(0), true),
		lit: {
			roughnessNode: mask.x,
			metalnessNode: float(0),
			aoNode: float(1),
			normalNode: bumped(slot('normal', at).xyz, at),
			emissiveNode: tsl.vec3(0),
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}
// Only the sheet variant is this chunk's; the kind's others fall through to kinds.ts (`??`).
lazyGraphs.decal = (variant) => (variant.sheet ? decalGraph() : (undefined as unknown as Graph));

/** A decal material: what the layer and the warm-up's stand-in draw with (the same flags). */
function decalMaterial(): KindMaterial {
	const material = createMaterial('decal', {
		instanced: true,
		sheet: true,
		params: { color: 0xffffff }
	});
	material.polygonOffset = true; // against the floor and the wall it lies on (#181)
	material.polygonOffsetFactor = -1;
	material.polygonOffsetUnits = -4;
	return material;
}

/** A unit quad, normal +z, uv up +y, with the per-instance data for `count`. */
function quad(count: number): THREE.PlaneGeometry {
	const geometry = new THREE.PlaneGeometry(1, 1);
	const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
	geometry.setAttribute(DECAL_ATTRIBUTE, data);
	return geometry;
}

/** One decal of the layer, ready to write. */
interface Decal {
	x: number;
	y: number;
	z: number;
	yaw: number;
	size: number;
	cell: number;
	shade: number;
	/** -1 on the floor, else the side of its cell its wall is on (0-3: north, east, south, west). */
	face: number;
}
interface Transient extends Decal {
	until: number;
}

/** What `addTransient` takes: a decal of the atlas, on a cell, turned, its look from the seed. */
export interface TransientDecal {
	atlasKey: DecalKey;
	cell: GridPos;
	/** Radians about the vertical. */
	rotation: number;
	seed: number;
	/** When it goes, on the layer's clock (`performance.now()` unless given another). */
	until: number;
}

/** A wall decal's turn: its quad's normal into the cell, away from its side's wall. */
const WALL_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export class DecalLayer {
	readonly mesh: THREE.InstancedMesh;
	private readonly material = decalMaterial();
	private readonly data: THREE.InstancedBufferAttribute;
	private inputs: unknown[] = [];
	private placed: Float32Array = new Float32Array(0);
	private transients: Transient[] = [];
	private shape: WorldShape | null = null;
	private tier: Tier = 'high';
	private on = true;
	private loading: Promise<void> | null = null;
	/** The atlas has loaded. */
	private shown = false;
	private readonly matrix = new THREE.Matrix4();
	private readonly turn = new THREE.Quaternion();
	private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
	private readonly at = new THREE.Vector3();
	private readonly scale = new THREE.Vector3();

	constructor(
		private readonly build: WorldBuilders,
		private readonly perf: PerfRecorder,
		/** Told when something new is to be drawn. */
		private readonly request: () => void,
		private readonly clock: () => number = () => performance.now()
	) {
		const geometry = quad(CAPACITY);
		this.data = geometry.getAttribute(DECAL_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		this.mesh = new THREE.InstancedMesh(geometry, this.material, CAPACITY);
		this.mesh.count = 0;
		this.mesh.frustumCulled = false; // one draw wherever the table is
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = true;
		this.mesh.raycast = () => {};
		this.mesh.userData.perfLayer = 'decals';
	}

	/**
	 * The decals for what the viewer was sent. Worked out again when the shape, props, roofs or
	 * environment changed (identity); the tier's cap and the `decals` layer only rewrite them.
	 */
	update(
		shape: WorldShape,
		props: readonly Prop[],
		environment: string | null,
		settings: Pick<QualitySettings, 'tier' | 'layers'>,
		interior: CellMask | null
	): void {
		const manifest = manifestNow();
		const rules = (environment && manifest?.environments[environment]?.decals) || NONE;
		const inputs = [shape, props, environment, interior, rules];
		const fresh = inputs.some((v, i) => v !== this.inputs[i]);
		if (!fresh && settings.tier === this.tier && settings.layers.decals === this.on) return;
		if (this.shape?.grid !== shape.grid) this.transients = []; // a new table
		[this.tier, this.on, this.shape] = [settings.tier, settings.layers.decals, shape];
		if (fresh) {
			this.inputs = inputs;
			if (rules.length) this.loadAtlas();
			const input = { shape, interior, props, environment: environment ?? '', rules };
			this.placed = rules.length
				? this.perf.time('decals', () => this.build.decalsFor(input))
				: new Float32Array(0);
		}
		this.write();
	}

	/** Lays a transient decal (#313); the oldest goes past the tier's cap. Asks for a frame. */
	addTransient(t: TransientDecal): void {
		const shape = this.shape;
		const { grid } = shape ?? {};
		if (!shape || !grid || t.cell.x < 0 || t.cell.y < 0) return;
		if (t.cell.x >= grid.width || t.cell.y >= grid.height) return;
		const rng = this.build.seededRandom(t.seed);
		const cs = grid.cellSize;
		const size = 0.45 + 0.2 * rng(); // inside its cell at any turn
		const room = Math.max(0, 0.48 - size / Math.SQRT2);
		this.transients.push({
			x: (t.cell.x + 0.5 - grid.width / 2 + (rng() * 2 - 1) * room) * cs,
			y: this.build.visualFloorY(shape, t.cell) + this.build.FLOOR_LIFT * cs,
			z: (t.cell.y + 0.5 - grid.height / 2 + (rng() * 2 - 1) * room) * cs,
			yaw: t.rotation,
			size: size * cs,
			cell: this.build.atlasCell(t.atlasKey, Math.floor(rng() * 2)),
			shade: 0.85 + 0.3 * rng(),
			face: this.build.FLOOR_FACE,
			until: t.until
		});
		const cap = TRANSIENT_CAPS[this.tier];
		if (this.transients.length > cap) this.transients.splice(0, this.transients.length - cap);
		this.loadAtlas();
		this.write();
		this.request();
	}

	/** On a drawn frame: expired transients go. Never asks for a frame. */
	tick(): void {
		if (!this.transients.length) return;
		const now = this.clock();
		const kept = this.transients.filter((t) => t.until > now);
		if (kept.length === this.transients.length) return;
		this.transients = kept;
		this.write();
	}

	/** A stand-in for the warm-up (#180): the layer's program, before any table has decals. */
	static gallery(): THREE.Object3D[] {
		const mesh = new THREE.InstancedMesh(quad(1), decalMaterial(), 1);
		mesh.setMatrixAt(0, new THREE.Matrix4());
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		return [mesh];
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.dispose();
		this.material.dispose();
	}

	/** The atlas's three maps into the material's slots, once. */
	private loadAtlas(): void {
		const slots = ['albedo', 'normal', 'orm'] as const;
		this.loading ??= loadManifest().then(async (manifest) => {
			const maps = await Promise.all(
				DECAL_TEXTURES.map((id) => manifest.textures[id] && loadTexture(id, manifest.textures[id]))
			);
			// Nothing shows until the whole atlas is in: the slots' blanks would draw white quads.
			if (!maps.every(Boolean)) return;
			maps.forEach((map, k) => setSlot(this.material, slots[k], map ?? null));
			this.shown = true;
			this.write();
			this.request();
		});
	}

	/** Writes the kept rule decals (the cap's lowest thinning keys), then the transients. */
	private write(): void {
		const stride = this.build.DECAL_STRIDE;
		const f = this.placed;
		let order = Array.from({ length: this.on ? f.length / stride : 0 }, (_, k) => k * stride);
		const cap = VEGETATION[this.tier].decalCap;
		if (order.length > cap) order = order.sort((a, b) => f[a + 8] - f[b + 8]).slice(0, cap);
		let n = 0;
		for (const k of order) {
			const [x, y, z, yaw, size, cell, shade, face] = f.subarray(k, k + stride);
			this.put(n++, { x, y, z, yaw, size, cell, shade, face });
		}
		if (this.on) for (const t of this.transients) this.put(n++, t);
		this.mesh.count = this.shown ? n : 0;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.data.needsUpdate = true;
	}

	private put(n: number, d: Decal): void {
		const floor = d.face < 0;
		this.euler.set(floor ? -Math.PI / 2 : 0, floor ? d.yaw : WALL_YAW[d.face], 0);
		this.turn.setFromEuler(this.euler);
		this.matrix.compose(this.at.set(d.x, d.y, d.z), this.turn, this.scale.setScalar(d.size));
		this.mesh.setMatrixAt(n, this.matrix);
		this.data.setXYZW(n, d.cell, 1, d.shade, 0);
	}
}

const NONE: readonly DecalRule[] = [];
