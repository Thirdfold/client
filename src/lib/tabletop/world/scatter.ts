// Scatter (M74 #305): small ground decoration (clover, tufts, pebbles, moss, reeds, rubble) laid
// where a builder would put it by hand, worked out on the CPU from what the viewer was sent and
// handed to the GPU layer (decor-layer.ts) per 16x16 chunk. Pure and renderer-free (no three.js),
// so its specs run in the server project. docs/RENDERING.md, "Scatter", is the contract.
//
// The rules are an environment's data (src/lib/assets/scatter.ts). What decides a placement:
// - Only what the viewer was sent: the shape's continued maps and edge classes, the roof mask and
//   the props. A cell the viewer has not explored gets none, and nothing is laid along a side
//   toward one, so nothing about unexplored ground is an input (a differential spec scrambles it).
// - Nothing from an id: the seed is the environment, the rule and the cell and side, never a room,
//   an object or a prop id. A sealed secret door is a wall as sent and dresses like any wall.
// - Nothing on void or lava, in water, under any prop, or on a roofed cell for an `outdoor` rule.
// - Decor taller than `DECOR_FLAT` stays out of a token's footing: it may reach `INTRUSION` into
//   the disk (shape.ts), no further. Flatter decor may lie under a base.

import { DECOR_FLAT, type ScatterRule, type ScatterWhere } from '../../assets/scatter';
import { TOKEN_DISK } from '../../assets/kit';
import { FLOOR_IDS, SOLID_FLOORS } from '../../game/floor';
import { gridToWorld } from '../../game/grid';
import { ASSETS, footprintCells, type Prop } from '../../game/props';
import type { CellMask } from '../../game/visibility';
import { keyHash, seededRandom } from './hash';
import {
	CHUNK,
	chunksAcross,
	dirtyChunks,
	EDGE_BUILT,
	EDGE_GROUND,
	hEdge,
	INTRUSION,
	vEdge,
	visualFloorY,
	type WorldShape
} from './shape';

/** Floats per instance: x, y, z (world), yaw (radians), scale, tint (see `thinKey`). */
export const DECOR_STRIDE = 6;
/** A decor model's size at scale 1, in cells: its height and the radius round its origin. */
export interface DecorSize {
	height: number;
	radius: number;
}

export interface ScatterInput {
	/** The viewer's shape (`worldShape`), with `water` from `waterCells` when liquid props count. */
	shape: WorldShape;
	/** The roofed cells as sent, masked to the viewer. */
	interior: CellMask | null;
	/** The props the viewer was sent. */
	props: readonly Pick<Prop, 'assetId' | 'pos' | 'rotation'>[];
	/** The environment's id: with the rule index and the place, the whole seed. */
	environment: string;
	rules: readonly ScatterRule[];
	/** Each rule's decor model's size by its id; a rule whose decor is missing lays nothing. */
	sizes: Readonly<Record<string, DecorSize>>;
}

/** One chunk's decor: a decor model's id to its instances (`DECOR_STRIDE` floats each). */
export type ChunkDecor = Map<string, Float32Array>;

/** A tall instance's centre keeps this far from its cell's centre, less its own radius: see top. */
const REACH = TOKEN_DISK - INTRUSION;
/** Furthest an instance's centre lies from its cell's centre toward a side, by where it goes. */
const HIGH: Record<ScatterWhere, number> = {
	open: 0.42,
	besideProp: 0.42,
	wallFoot: 0.46,
	cliffFoot: 0.46,
	cliffTop: 0.42,
	voidRim: 0.42,
	shore: 0.42
};
/** How far past its cell's edge an instance may reach: the far face of a wall, else not at all. */
const EDGE: Record<ScatterWhere, number> = {
	open: 0.5,
	besideProp: 0.5,
	wallFoot: 0.55,
	cliffFoot: 0.52,
	cliffTop: 0.5,
	voidRim: 0.5,
	shore: 0.5
};
/** Along a side, an instance keeps this far from the middle: clear of the corners' rounding. */
const ALONG = 0.25;
const FLAT_LOW = 0.3;
/** North, east, south, west, as shape.ts's neighbour offsets. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const PLAIN = FLOOR_IDS.indexOf('plain');
const LAVA = FLOOR_IDS.indexOf('lava');

/** What the placement of a chunk reads besides its cells, worked out once per input. */
export interface ScatterContext {
	env: number;
	/** 1 under any prop. */
	covered: Uint8Array;
	/** Per rule, per floor byte: 1 if the rule takes that floor. */
	floors: Uint8Array[];
	/** Per rule with a `beside`: 1 on the cells in or beside such a prop. */
	beside: (Uint8Array | null)[];
}

export function scatterContext(input: ScatterInput): ScatterContext {
	const { shape, props, rules } = input;
	const { width: w, height: h } = shape.grid;
	const covered = new Uint8Array(w * h);
	const at = (c: { x: number; y: number }) =>
		c.x < 0 || c.y < 0 || c.x >= w || c.y >= h ? -1 : c.y * w + c.x;
	for (const p of props) for (const c of footprintCells(p)) if (at(c) >= 0) covered[at(c)] = 1;
	const beside = rules.map((rule) => {
		if (rule.beside === undefined) return null;
		const mask = new Uint8Array(w * h);
		for (const p of props) {
			if (p.assetId !== rule.beside && ASSETS[p.assetId]?.category !== rule.beside) continue;
			for (const c of footprintCells(p))
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const j = at({ x: c.x + dx, y: c.y + dy });
						if (j >= 0) mask[j] = 1;
					}
		}
		return mask;
	});
	const floors = rules.map((rule) => {
		const takes = new Uint8Array(FLOOR_IDS.length);
		for (const id of rule.on) takes[id === 'default' ? PLAIN : FLOOR_IDS.indexOf(id as never)] = 1;
		return takes;
	});
	return { env: keyHash(input.environment), covered, floors, beside };
}

/** A seed from the environment, rule, cell and side: integer mixing, no strings. */
export function seedOf(env: number, rule: number, x: number, y: number, side: number): number {
	let h = env;
	for (const v of [rule, x, y, side]) {
		h = Math.imul(h ^ v, 0x9e3779b1);
		h ^= h >>> 15;
	}
	return h >>> 0;
}

/**
 * The key a tint also carries for thinning (a lower tier keeps the instances whose key is under
 * its density): the tint's fine bits, independent of the colour the coarse ones make.
 */
export const thinKey = (tint: number): number => (tint * 4096) % 1;

/** The scatter of chunk `c` (row-major, `cy * chunksAcross + cx`), only its own cells. */
export function scatterChunk(
	input: ScatterInput,
	c: number,
	ctx: ScatterContext = scatterContext(input)
): ChunkDecor {
	const { shape, interior, rules, sizes } = input;
	const { grid, known, floor, water } = shape;
	const { width: w, height: h } = grid;
	const across = chunksAcross(grid).x;
	const [x0, y0] = [(c % across) * CHUNK, Math.floor(c / across) * CHUNK];
	const out = new Map<string, number[]>();
	const sized = rules.map((r) => sizes[r.decor]);

	for (let y = y0; y < Math.min(y0 + CHUNK, h); y++)
		for (let x = x0; x < Math.min(x0 + CHUNK, w); x++) {
			const i = y * w + x;
			if ((known && !known[i]) || ctx.covered[i] || water[i] || SOLID_FLOORS.has(floor[i]))
				continue;
			let place: Place | null = null; // the cell's centre and ground, once a rule lays
			let read = false; // its sides, once a rule asks
			for (let k = 0; k < rules.length; k++) {
				const rule = rules[k];
				if (!sized[k] || !rule.density || !ctx.floors[k][floor[i]]) continue;
				if (rule.outdoor && interior?.[i]) continue;
				if (rule.where === 'besideProp' && !ctx.beside[k]![i]) continue;
				const sides = rule.where === 'open' || rule.where === 'besideProp' ? OPEN : SIDES;
				for (const d of sides) {
					if (d >= 0) {
						if (!read) readSides(shape, x, y);
						read = true;
						if (!sideOn(shape, rule.where, i, d)) continue;
					}
					place ??= { ...gridToWorld(grid, { x, y }), ground: visualFloorY(shape, { x, y }) };
					const list = out.get(rule.decor) ?? [];
					const rng = seededRandom(seedOf(ctx.env, k, x, y, d + 1));
					const n = Math.floor(rule.density) + (rng() < rule.density % 1 ? 1 : 0);
					for (let m = 0; m < n; m++) instance(list, rng, rule, sized[k]!, d, place, grid.cellSize);
					if (list.length) out.set(rule.decor, list);
				}
			}
		}
	return new Map([...out].map(([id, list]) => [id, Float32Array.from(list)]));
}

interface Place {
	x: number;
	z: number;
	ground: number;
}
const OPEN = [-1];
const SIDES = [0, 1, 2, 3];

/** A cell's four sides (north, east, south, west) as the rules read them, filled by `readSides`. */
const side = { built: new Uint8Array(4), ground: new Uint8Array(4), next: new Int32Array(4) };

/** Reads what stands on each side of cell (x, y): its wall, its ground edge and its neighbour (-1: none). */
function readSides(shape: WorldShape, x: number, y: number): void {
	const { grid, edges } = shape;
	const { width: w, height: h } = grid;
	for (let d = 0; d < 4; d++) {
		const [nx, ny] = [x + DX[d], y + DY[d]];
		side.next[d] = nx >= 0 && ny >= 0 && nx < w && ny < h ? ny * w + nx : -1;
		// North and south are on the h map (the south side of this cell is the north of the next row).
		const slot = d & 1 ? vEdge(grid, d === 1 ? x + 1 : x, y) : hEdge(grid, x, d === 0 ? y : y + 1);
		const map = d & 1 ? 'v' : 'h';
		side.built[d] = edges.built[map][slot];
		side.ground[d] = edges.ground[map][slot];
	}
}

/** Whether side `d` of known cell `i` is where `where` lays decor (after `readSides`). */
function sideOn(shape: WorldShape, where: ScatterWhere, i: number, d: number): boolean {
	const { known, levels, floor, water } = shape;
	const j = side.next[d];
	if (where === 'wallFoot') {
		// Nothing toward an unexplored cell; the table's border has no neighbour to ask.
		const built = side.built[d];
		return (
			(built === EDGE_BUILT.wall || built === EDGE_BUILT.window) && (j < 0 || !known || !!known[j])
		);
	}
	if (j < 0 || (known && !known[j])) return false;
	if (where === 'shore') return !!water[j] && floor[j] !== LAVA;
	if (where === 'voidRim') return side.ground[d] === EDGE_GROUND.void;
	return (
		side.ground[d] === EDGE_GROUND.cliff &&
		(where === 'cliffFoot' ? levels[j] > levels[i] : levels[j] < levels[i])
	);
}

/** Appends one instance of `rule` in a cell (or along its `side`, 0-3, or anywhere with -1). */
function instance(
	list: number[],
	rng: () => number,
	rule: ScatterRule,
	size: DecorSize,
	side: number,
	at: Place,
	cs: number
): void {
	const scale = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * rng();
	const [yaw, tint] = [rng() * Math.PI * 2, rng()];
	const reach = size.radius * scale;
	const tall = size.height * scale > DECOR_FLAT;
	let u: number;
	let v: number;
	if (side < 0) {
		const m = HIGH.open - reach;
		if (m <= 0) return;
		if (!tall) [u, v] = [(rng() * 2 - 1) * m, (rng() * 2 - 1) * m];
		else {
			// Only the cell's corners are clear of the footing (a centre at least `near` away, and
			// within `m` along both axes): an angle in a corner's span, a distance out to the square.
			const near = REACH + reach;
			if (near > m * Math.SQRT2) return;
			const edge = Math.acos(Math.min(1, m / near));
			const angle = Math.floor(rng() * 4) * (Math.PI / 2) + edge + rng() * (Math.PI / 2 - 2 * edge);
			const far = m / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
			const r = near + (far - near) * rng();
			[u, v] = [r * Math.cos(angle), r * Math.sin(angle)];
		}
	} else {
		const lo = tall ? REACH + reach : FLAT_LOW;
		const hi = Math.min(HIGH[rule.where], EDGE[rule.where] - reach);
		if (lo > hi) return;
		const n = lo + (hi - lo) * rng();
		const t = (rng() * 2 - 1) * ALONG;
		[u, v] = [DX[side] * n + (DY[side] ? t : 0), DY[side] * n + (DX[side] ? t : 0)];
	}
	list.push(at.x + u * cs, at.ground, at.z + v * cs, yaw, scale * cs, tint);
}

/** Every chunk's decor, in chunk order. */
export function scatter(input: ScatterInput): ChunkDecor[] {
	const ctx = scatterContext(input);
	const { x, y } = chunksAcross(input.shape.grid);
	return Array.from({ length: x * y }, (_, c) => scatterChunk(input, c, ctx));
}

/**
 * The chunks whose decor may differ between two inputs: all of them when anything but the shape
 * changed (props, roofs, rules, sizes, the environment, the grid), else the chunks of the cells the
 * shape's maps and edges changed (with `dirtyChunks`' margin, for the sides).
 */
export function scatterDirty(prev: ScatterInput | null, next: ScatterInput): number[] {
	const { x, y } = chunksAcross(next.shape.grid);
	const all = Array.from({ length: x * y }, (_, c) => c);
	if (
		!prev ||
		prev.props !== next.props ||
		prev.interior !== next.interior ||
		prev.rules !== next.rules ||
		prev.sizes !== next.sizes ||
		prev.environment !== next.environment ||
		prev.shape.grid !== next.shape.grid
	)
		return all;
	const dirty = new Set(dirtyChunks(prev.shape, next.shape));
	const g = next.shape.grid;
	const [a, b] = [prev.shape.edges.built, next.shape.edges.built];
	const mark = (cx: number, cy: number) => {
		if (cx >= 0 && cy >= 0 && cx < g.width && cy < g.height)
			dirty.add(Math.floor(cy / CHUNK) * x + Math.floor(cx / CHUNK));
	};
	for (let k = 0; k < a.h.length; k++)
		if (a.h[k] !== b.h[k]) {
			const [ex, ey] = [k % g.width, Math.floor(k / g.width)];
			mark(ex, ey);
			mark(ex, ey - 1);
		}
	for (let k = 0; k < a.v.length; k++)
		if (a.v[k] !== b.v[k]) {
			const [ex, ey] = [k % (g.width + 1), Math.floor(k / (g.width + 1))];
			mark(ex, ey);
			mark(ex - 1, ey);
		}
	return [...dirty].sort((p, q) => p - q);
}
