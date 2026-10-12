// The shore field (milestone 73, #292): how far each part of the map is from a shore, at four
// texels a cell, worked out from what the viewer was sent. Every water look reads it (depth
// colour, foam, shallow opacity, ripple damping) with no depth buffer, so it is the same on every
// tier and backend. Pure and renderer-free (no three.js), so its specs run in the server project.
// docs/RENDERING.md, "Shore field", is the contract.
//
// It reads only the floor, levels, props, walls and explored mask the viewer was sent. An
// unexplored cell never seeds a shore: a foam line along the explored edge would outline ground
// the viewer has not seen, so unknown cells beside water count as more water.

import { FLOOR_IDS, type FloorMap } from '../../game/floor';
import type { GridPos, SquareGrid } from '../../game/grid';
import { footprintCells, obstaclesFor, type Prop } from '../../game/props';
import type { CellMask } from '../../game/visibility';
import type { EdgeMap, WorldShape } from './shape';
import { SHORE_MAX, SHORE_TEXELS } from './shore-scale';

export { SHORE_MAX, SHORE_TEXELS };

/** The 3-4 chamfer's weights: a step along an axis is 3 units, a diagonal one 4. */
const AXIS = 3;
const DIAGONAL = 4;
/** A texel's distance in cells is its units over this. */
const UNITS_PER_CELL = AXIS * SHORE_TEXELS;
/** The units that encode as 255. */
const CAP = UNITS_PER_CELL * SHORE_MAX;
/** A texel no seed has reached. */
const FAR = 0xffff;

/** The props that are liquid, until the manifest says so (#294). */
const WATER = FLOOR_IDS.indexOf('water');
const LIQUID_PROPS: ReadonlySet<string> = new Set(['water', 'water-sm', 'water-lg']);
export const isLiquidProp = (assetId: string) => LIQUID_PROPS.has(assetId);

/**
 * Which cells are water (1, else 0), one byte per cell: those whose floor is water, and those a
 * liquid prop's footprint covers. Says nothing about what the viewer knows (`shoreField` masks).
 */
export function waterCells(
	grid: SquareGrid,
	floor: FloorMap | null,
	props: Iterable<Pick<Prop, 'assetId' | 'pos' | 'rotation'>>,
	isLiquid: (assetId: string) => boolean
): Uint8Array {
	const { width: w, height: h } = grid;
	const water = new Uint8Array(w * h);
	if (floor) for (let i = 0; i < water.length; i++) water[i] = floor[i] === WATER ? 1 : 0;
	for (const p of props) {
		if (!isLiquid(p.assetId)) continue;
		for (const c of footprintCells(p) as GridPos[])
			if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) water[c.y * w + c.x] = 1;
	}
	return water;
}

export interface ShoreInput {
	grid: SquareGrid;
	/** `waterCells`. */
	water: Uint8Array;
	/** Each cell's level, or null for a flat table. */
	levels: Uint8Array | null;
	/** The cells nobody can enter (`obstaclesFor(...).solid`): a solid water cell is a rock. */
	solid: Uint8Array | null;
	/** The walls, windows and doors as sent (`WorldShape.edges.built`), or null. */
	edges: EdgeMap | null;
	/** The cells the viewer has explored; null for the GM and with fog off. */
	known: CellMask | null;
	/** Beyond the grid: 'shore' (land) or 'water' (the sea runs on, #296). */
	outside: 'shore' | 'water';
}

/**
 * The distance to the nearest shore for every texel, `(width x 4) x (height x 4)` bytes in row
 * order: `round(255 x d / SHORE_MAX)` for d cells, so 255 is four cells or more. Shore is: known
 * cells that are not water; known water cells that are solid (rocks); both sides of an edge
 * between known water cells that differ in level (a waterfall's lip and foot) or carry a wall,
 * window or door (a pier); and, with `outside` 'shore', everything past the grid. Deterministic
 * integer work, byte-equal on every client.
 */
export function shoreField(input: ShoreInput): Uint8Array {
	const { grid, water, levels, solid, edges, known, outside } = input;
	const { width: w, height: h } = grid;
	const T = SHORE_TEXELS;
	const W = w * T;
	const H = h * T;
	const P = W + 2; // one texel of border all round, for the grid's outside
	const d = new Uint16Array(P * (H + 2)).fill(FAR);
	if (outside === 'shore') {
		d.fill(0, 0, P); // the border row above and below, and the columns beside
		d.fill(0, (H + 1) * P);
		for (let ty = 1; ty <= H; ty++) d[ty * P] = d[ty * P + P - 1] = 0;
	}
	const at = (tx: number, ty: number) => (ty + 1) * P + tx + 1;
	const seen = (i: number) => !known || known[i] === 1;
	const seedBlock = (x0: number, y0: number, x1: number, y1: number) => {
		for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) d[at(tx, ty)] = 0;
	};
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (seen(i) && (!water[i] || solid?.[i])) seedBlock(x * T, y * T, (x + 1) * T, (y + 1) * T);
		}
	const wet = (a: number, b: number) => water[a] && water[b] && seen(a) && seen(b);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (y > 0 && wet(i - w, i) && (levels?.[i - w] !== levels?.[i] || edges?.h[y * w + x]))
				seedBlock(x * T, y * T - 1, (x + 1) * T, y * T + 1);
			if (x > 0 && wet(i - 1, i) && (levels?.[i - 1] !== levels?.[i] || edges?.v[y * (w + 1) + x]))
				seedBlock(x * T - 1, y * T, x * T + 1, (y + 1) * T);
		}
	chamfer(d, P, W, H);
	const out = new Uint8Array(W * H);
	for (let ty = 0; ty < H; ty++)
		for (let tx = 0; tx < W; tx++)
			out[ty * W + tx] = Math.min(255, Math.round((d[at(tx, ty)] * 255) / CAP));
	return out;
}

/** The shore map's side (shore-map.ts): the texture and the inputs of its last rebuild. */
export interface ShoreTarget {
	texture: { image: { data: unknown }; needsUpdate: boolean };
	last: unknown[];
	/** The texture's side, in texels. */
	side: number;
}

/**
 * Rebuilds `target`'s field for a viewer's world shape and props if any input changed by
 * identity (so never while idle), timed as `shore`, and writes it into the texture a row at a
 * time. Past the grid is shore unless the backdrop is the sea (the water runs on, #296).
 */
export function refreshShore(
	target: ShoreTarget,
	grid: SquareGrid,
	shape: WorldShape,
	props: readonly Prop[],
	backdrop: string | null | undefined,
	perf: { time<T>(label: string, fn: () => T): T }
): void {
	const { floor, levels, known, edges } = shape;
	const outside = backdrop === 'sea' ? 'water' : 'shore';
	const inputs = [floor, levels, known, edges.built, props, outside]; // a new grid is a new shape
	if (inputs.every((v, i) => v === target.last[i])) return;
	target.last = inputs;
	perf.time('shore', () => {
		const field = shoreField({
			grid,
			water: waterCells(grid, floor, props, isLiquidProp),
			levels,
			solid: obstaclesFor(grid, [], props, levels, floor).solid,
			edges: edges.built,
			known,
			outside
		});
		const out = target.texture.image.data as Uint8Array;
		const row = grid.width * SHORE_TEXELS;
		for (let ty = 0; ty < grid.height * SHORE_TEXELS; ty++)
			out.set(field.subarray(ty * row, ty * row + row), ty * target.side);
		target.texture.needsUpdate = true;
	});
}

/** Two passes of the 3-4 chamfer over the interior of a padded `P`-wide buffer. */
function chamfer(d: Uint16Array, P: number, W: number, H: number): void {
	for (let ty = 1; ty <= H; ty++)
		for (let tx = 1, i = ty * P + 1; tx <= W; tx++, i++) {
			let best = d[i];
			let v = d[i - 1] + AXIS;
			if (v < best) best = v;
			v = d[i - P] + AXIS;
			if (v < best) best = v;
			v = d[i - P - 1] + DIAGONAL;
			if (v < best) best = v;
			v = d[i - P + 1] + DIAGONAL;
			if (v < best) best = v;
			d[i] = best;
		}
	for (let ty = H; ty >= 1; ty--)
		for (let tx = W, i = ty * P + W; tx >= 1; tx--, i--) {
			let best = d[i];
			let v = d[i + 1] + AXIS;
			if (v < best) best = v;
			v = d[i + P] + AXIS;
			if (v < best) best = v;
			v = d[i + P + 1] + DIAGONAL;
			if (v < best) best = v;
			v = d[i + P - 1] + DIAGONAL;
			if (v < best) best = v;
			d[i] = best;
		}
}
