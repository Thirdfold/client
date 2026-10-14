// The grass's graph (#302, #303), in the lazy `grass` chunk: the foliage kind's `grass` variant,
// registered over the wind chunk's foliage graph when the chunk loads. One InstancedBufferGeometry
// holding a single blade strip (world/grass-blades.ts) is drawn `cells x blades` times; each
// instance finds its cell in the cell list (an RGBA8 texture, read with texel loads in the vertex
// stage, which WebGL2 and compat WebGPU allow) and everything else from a hash of its cell and
// blade number: its place in the cell (off the sides its inset bits name), height, facing, bend and
// hue. Instances run blade-major (instance = blade x cells + cell), so drawing fewer drops the
// highest blade numbers, the ones that fade nearest. The GM's paint (game/floor.ts) rides in the
// list: a cell keeps the blades below its share (A) of the blades a cell may grow, and fades them
// over its own count; its height's rank (G's top two bits) scales the blade and its cap. The root
// stands on its cell's level from the ground map; the height thins toward cells that grow none (a
// linear sample of the field map, so a border into dirt or a path fades), fades with distance, lies
// down to a quarter under the cell overlay's marks and the hovered cell (#285's texture, already
// bound for the grid), and parts round up to `MAX_PARTING` footprints (#303, a uniform array looped
// up to its count), never above `GRASS_HEIGHT` times the cell's height. The colour is the grass
// floor's painted surface at the root (a coarse mip, once per vertex), darker at the root and paler
// at the tip, under a slow macro hue; normals lean up. Wind sways it by t² (`applyWind` from the
// blade's placed position, which also writes the previous frame's for TRAA). `worldModify` comes
// last, so unexplored cells are exactly 0 and the dark dims it. Every value is a uniform or a
// texture: nothing here compiles at runtime.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLOOR_IDS } from '../../game/floor';
import { HEIGHT_SCALES } from '../world/grass-cells';
import { cellUniforms, groundTexel } from '../cell-maps';
import { MAP_SIDE } from '../cell-maps-kept';
import { STEP_HEIGHT } from '../ground';
import { FADE, GRASS_HEIGHT, INSET_MARGIN } from '../world/grass-blades';
import { MAX_PARTING, type Parting } from '../world/parting';
import { floorLayers, floorMaps, floorRepeat } from './floors';
import { gridUniforms, overlayMap } from './grid';
import { floorPalette } from './hooks';
import { lazyGraphs, type Graph } from './kinds';
import { pick, tsl, type N } from './tsl';
import { applyWind } from './wind';
import { worldModify } from './world-modify';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;
const loose = (node: unknown) => node as N;

/** The cell list's width in texels; its height holds the largest grid's cells. */
export const LIST_WIDTH = 256;
export const LIST_HEIGHT = Math.ceil((MAP_SIDE * MAP_SIDE) / LIST_WIDTH);
const GRASS = FLOOR_IDS.indexOf('grass');
/** The coarse mip the colour is read at: a blade is a point, so its colour is the patch's average. */
const COLOUR_LEVEL = 3;
/** A blade's width at its root (cells), the least and the most. */
const WIDTH = [0.022, 0.036] as const;
/** Far blades widen with distance (cells per cell away), so they never thin below a pixel or so. */
const WIDEN = 0.0016;
/** What a marked or hovered cell lays blades down to, and the parting's squash inside a base. */
const FLAT = 0.25;
const PARTED = 0.1;

/** A 1x1 blank of a format, until the layer puts its own in. Never disposed. */
function blank(format: THREE.PixelFormat): THREE.DataTexture {
	const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, format);
	texture.needsUpdate = true;
	return texture;
}
const list = T.texture(blank(THREE.RGBAFormat)) as unknown as N & { value: THREE.Texture };
const field = T.texture(blank(THREE.RedFormat)) as unknown as N & { value: THREE.Texture };

/** The grass's uniforms: set by `GrassLayer`. */
export const grassUniforms = {
	/** Cells in the list, and blades a cell may grow (the densest's, however many are drawn). */
	cells: T.uniform(1),
	blades: T.uniform(1),
	/** The footprints the grass parts round (#303): x, z, radius, weight; and how many are live. */
	parts: T.uniformArray(
		Array.from({ length: MAX_PARTING }, () => new THREE.Vector4()),
		'vec4'
	),
	partCount: T.uniform(0, 'int')
};
const g = grassUniforms as unknown as Record<keyof typeof grassUniforms, N>;

/** Puts a layer's cell list and field map in, or the blanks back with null. */
export function setGrassMaps(maps: { list: THREE.Texture; field: THREE.Texture } | null): void {
	list.value = maps?.list ?? blankList;
	field.value = maps?.field ?? blankField;
}
const [blankList, blankField] = [list.value, field.value];

/** Writes a parting set (`partingSet`) into the uniforms. */
export function setParting(parting: Parting): void {
	const parts = grassUniforms.parts.array as THREE.Vector4[];
	for (let k = 0; k < MAX_PARTING; k++) parts[k].fromArray(parting.data, k * 4);
	grassUniforms.partCount.value = parting.count;
}

let built: Graph | null = null;

/** The graph, built once (one variant). */
function grassGraph(): Graph {
	if (built) return built;
	const c = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
	const cs = c.cellSize;
	const i = t.float(t.instanceIndex);
	const k = i.mod(g.cells);
	const b = i.div(g.cells).floor();
	const texel = list.load(t.ivec2(k.mod(LIST_WIDTH), k.div(LIST_WIDTH).floor()));
	const high = texel.y.mul(255).round();
	const rank = high.div(64).floor();
	const index = texel.x
		.mul(255)
		.round()
		.add(high.sub(rank.mul(64)).mul(256));
	// The painted height: the scale of its rank (grass-cells.ts `HEIGHT_SCALES`, shortest first).
	const scaled = HEIGHT_SCALES.slice(1).reduce(
		(sum: N, s, n) => sum.add(t.step(n + 0.5, rank).mul(s - HEIGHT_SCALES[n])),
		t.float(HEIGHT_SCALES[0])
	);
	const bits = texel.z.mul(255).round();
	const cy = index.div(c.gridSize.x).floor();
	const cx = index.sub(cy.mul(c.gridSize.x));
	const cell = t.ivec2(cx, cy);
	const seed = index.mul(64).add(b).mul(8);
	const h = (n: number): N => t.hash(seed.add(n));
	// Off the sides the inset bits name (grass-blades.ts `margins`, `rootIn`).
	const bit = (n: number) =>
		bits
			.div(2 ** n)
			.floor()
			.mod(2);
	const side = (d: number) =>
		t.max(bit(d).mul(INSET_MARGIN.wall), bit(d + 4).mul(INSET_MARGIN.wide));
	const [north, east, south, west] = [0, 1, 2, 3].map(side);
	const at = t.vec2(
		cx.add(west).add(h(0).mul(t.float(1).sub(west).sub(east))),
		cy.add(north).add(h(1).mul(t.float(1).sub(north).sub(south)))
	);
	const rootXZ = at.sub(c.gridSize.mul(0.5)).mul(cs);
	const rootY = loose(groundTexel).load(cell).y.mul(255).round().mul(STEP_HEIGHT).mul(cs);
	const root = t.vec3(rootXZ.x, rootY, rootXZ.y);
	// How tall: kept below the cell's share of blades, thinned toward cells growing none, by
	// distance (higher blade numbers nearer, over the cell's own count), laid down under marks.
	const share = t.max(texel.w.mul(g.blades), 1);
	const kept = t.step(b.add(0.5), share);
	const near = t.clamp(at, 0.5, c.gridSize.sub(0.5)).div(MAP_SIDE);
	const border = t.smoothstep(0.35, 0.85, field.sample(near).level(0).x);
	const limit = b.div(share).mul(-FADE.keep).add(1).mul(FADE.far);
	const away = t.cameraPosition.distance(root).div(cs);
	const fade = t.float(1).sub(t.smoothstep(limit.mul(1 - FADE.band), limit, away));
	const marks = loose(overlayMap).load(cell);
	const hover = gridUniforms as unknown as Record<keyof typeof gridUniforms, N>;
	const hovered = t
		.step(hover.hover.sub(t.vec2(cx, cy)).abs().dot(t.vec2(1, 1)), 0.5)
		.mul(t.step(0.5, hover.pattern));
	const marked = t.max(t.max(t.max(marks.x, marks.y), t.max(marks.z, marks.w)), hovered);
	const cap = cs.mul(GRASS_HEIGHT).mul(scaled);
	const tall = t
		.mix(0.55, 1, h(3))
		.mul(cap)
		.mul(kept)
		.mul(border)
		.mul(fade)
		.mul(t.mix(1, FLAT, marked));
	// The parting (#303): inside a footprint the blade drops to `PARTED` and leans out; to 1.5
	// radii its tip is pushed out. ponytail: every blade loops every footprint (32 at most); bin
	// footprints per 4x4 cells if a crowd makes it costly.
	const parting = (t.Fn as unknown as (f: () => N) => () => N)(() => {
		const squash = t.float(1).toVar();
		const push = t.vec2(0, 0).toVar();
		t.Loop(g.partCount, ({ i: n }: { i: N }) => {
			const p = loose(g.parts).element(n);
			const d = rootXZ.sub(p.xy);
			const len = d.length();
			const inside = t
				.float(1)
				.sub(t.smoothstep(p.z.mul(0.85), p.z, len))
				.mul(p.w);
			squash.assign(t.min(squash, t.mix(1, PARTED, inside)));
			const ring = t
				.float(1)
				.sub(t.smoothstep(p.z, p.z.mul(1.5), len))
				.mul(p.w);
			push.addAssign(d.div(t.max(len, 1e-4)).mul(ring));
		});
		return t.vec3(squash, push);
	})();
	const height = tall.mul(parting.x);
	// The blade: its side and height along it from the strip, facing and bend from the hash.
	const across = tsl.positionGeometry.x;
	const along = tsl.positionGeometry.y;
	const yaw = h(4).mul(2 * Math.PI);
	const facing = t.vec2(t.cos(yaw), t.sin(yaw));
	const width = cs.mul(t.max(t.mix(WIDTH[0], WIDTH[1], h(5)), away.mul(WIDEN)));
	const curve = t.mix(0.1, 0.45, h(6));
	const t2 = along.mul(along);
	const sideways = t
		.vec2(facing.y.negate(), facing.x)
		.mul(across.mul(width).mul(along.mul(-0.7).add(1)));
	const bend = facing.mul(curve).add(parting.yz.mul(0.7)).mul(t2).mul(height);
	const up = t.min(along.mul(height).mul(curve.mul(along).mul(-0.25).add(1)), cap);
	const placed = t.vec3(
		rootXZ.x.add(sideways.x).add(bend.x),
		rootY.add(up),
		rootXZ.y.add(sideways.y).add(bend.y)
	);
	// Short and parted blades sway less: the weight scales with the height left.
	const positionNode = applyWind(t2.mul(height.div(cap)), 1, placed);
	// The colour: the grass floor's surface where the blade roots, or its palette colour.
	const layer = loose(floorLayers).element(GRASS);
	const surface = floorMaps.albedo as unknown as N;
	const painted = surface
		.sample(rootXZ.mul(loose(floorRepeat)))
		.depth(layer.sub(1).max(0))
		.level(COLOUR_LEVEL).xyz;
	const own = pick(layer.greaterThan(0.5), painted, loose(floorPalette).element(GRASS).xyz);
	const macro = tsl
		.mx_noise_float(t.vec3(rootXZ.div(cs).mul(0.12), 0))
		.mul(0.5)
		.add(0.5);
	const hue = t.mix(t.vec3(0.88, 0.97, 0.85), t.vec3(1.12, 1.06, 0.72), macro);
	const colour = tsl.varying(t.vec4(own.mul(hue).mul(t.mix(0.92, 1.08, h(7))), along), 'vGrass');
	const leaning = tsl.varying(t.vec3(facing.x.mul(0.35), 1, facing.y.mul(0.35)), 'vGrassUp');
	const shade = t.mix(0.5, 1.6, colour.w);
	built = {
		colorNode: t.vec4(colour.xyz.mul(shade), 1),
		opacityNode: null,
		alphaTestNode: null,
		positionNode,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, t.vec3(0), true),
		lit: {
			roughnessNode: tsl.materialReference('params.roughness', 'float'),
			metalnessNode: t.float(0),
			aoNode: t.mix(0.55, 1, colour.w),
			normalNode: tsl.cameraViewMatrix.mul(t.vec4(leaning.normalize(), 0)).xyz.normalize(),
			emissiveNode: t.vec3(0),
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
	return built;
}

// The grass variant of the foliage kind; every other foliage graph is the wind chunk's.
const sway = lazyGraphs.foliage;
lazyGraphs.foliage = (variant) => (variant.grass ? grassGraph() : sway!(variant));
