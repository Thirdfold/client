// Waterfalls and flow (milestone 73, #295): where water drops a level, and which way each water
// cell drifts. Both come from the level map alone, so there is no new scene data. Pure and
// renderer-free (no three.js), tested in the server project; docs/RENDERING.md, "Flow and falls".
//
// Only known cells count: a fall toward an unexplored lower cell is not listed (so it cannot show
// the drop), and a cell the viewer has not explored never drifts.

import { VOID, type FloorMap } from '../../game/floor';
import type { SquareGrid } from '../../game/grid';
import type { CellMask } from '../../game/visibility';
import { DIRS } from './regions';

/** A water edge: water in `from` spills to the lower cell `to`, which lies in direction `dir`. */
export interface DropEdge {
	from: number;
	to: number;
	/** An index into `DIRS` (north, east, south, west): the way the water falls. */
	dir: number;
	/** The levels either side (`upper` above `lower` by at least one). */
	upper: number;
	lower: number;
	/** The lower cell is water too (a stepped river), not land: the fall ends in a pool. */
	toWater: boolean;
}

/** Water cells joined edge to edge at one level, as `regions.ts`'s `WaterBody`. */
export interface FlowBody {
	cells: readonly number[];
	level: number;
}

/**
 * The edges where a known water cell meets a known lower cell (water or land) by at least one
 * level, one per shared cell side, in cell order then north, east, south, west. Edges toward
 * unknown cells are skipped (the continuation rule), and so are void cells: water beside a void
 * is a bank above a chasm, not a fall. A flat table (`levels` null) has none.
 */
export function dropEdges(
	grid: SquareGrid,
	water: Uint8Array,
	levels: Uint8Array | null,
	known: CellMask | null,
	floor: FloorMap | null = null
): DropEdge[] {
	const edges: DropEdge[] = [];
	if (!levels) return edges;
	const { width: w, height: h } = grid;
	for (let i = 0; i < w * h; i++) {
		if (!water[i] || (known && !known[i])) continue;
		const x = i % w;
		const y = (i - x) / w;
		for (let dir = 0; dir < 4; dir++) {
			const nx = x + DIRS[dir].dx;
			const ny = y + DIRS[dir].dy;
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if ((known && !known[j]) || floor?.[j] === VOID || levels[j] >= levels[i]) continue;
			edges.push({
				from: i,
				to: j,
				dir,
				upper: levels[i],
				lower: levels[j],
				toWater: water[j] === 1
			});
		}
	}
	return edges;
}

/** The water bodies of a mask: known water cells at one level, joined edge to edge. */
export function waterBodies(
	grid: SquareGrid,
	water: Uint8Array,
	levels: Uint8Array | null,
	known: CellMask | null
): FlowBody[] {
	const { width: w, height: h } = grid;
	const wet = (i: number) => water[i] === 1 && (!known || known[i] === 1);
	const level = (i: number) => levels?.[i] ?? 0;
	const seen = new Uint8Array(w * h);
	const bodies: FlowBody[] = [];
	for (let s = 0; s < w * h; s++) {
		if (seen[s] || !wet(s)) continue;
		const cells = [s];
		seen[s] = 1;
		for (let k = 0; k < cells.length; k++) {
			const x = cells[k] % w;
			const y = (cells[k] - x) / w;
			for (const { dx, dy } of DIRS) {
				const [nx, ny] = [x + dx, y + dy];
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
				const j = ny * w + nx;
				if (!seen[j] && wet(j) && level(j) === level(s)) {
					seen[j] = 1;
					cells.push(j);
				}
			}
		}
		bodies.push({ cells, level: level(s) });
	}
	return bodies;
}

/** A flat body at least this many times as long as it is wide drifts along its long axis. */
export const ELONGATED = 1.5;
/** How fast a flat body drifts, against a cell that spills down a step (1). */
export const DRIFT = 0.25;
/** A flow byte: 128 is zero, 1 and 255 are -1 and 1 (`flowByte`). */
export const FLOW_ZERO = 128;
const FLOW_SCALE = 127;

/** A flow component in [-1, 1] as its byte. */
export const flowByte = (v: number) =>
	Math.max(1, Math.min(255, Math.round(FLOW_ZERO + FLOW_SCALE * v)));
/** A flow byte as its component. */
export const flowOf = (byte: number) => (byte - FLOW_ZERO) / FLOW_SCALE;

/**
 * The flow of every cell, RG8 (`width x height x 2` bytes in row order, `flowOf` reads a byte): a
 * known water cell sums the unit vectors toward its lower neighbours weighted by how many levels
 * lower they are (so water runs to a fall's lip), a flat body at least `ELONGATED` times as long
 * as wide adds a slow `DRIFT` along its long axis (toward +x or +y, or the way the body itself
 * falls), and each cell is blurred once with the cells of its own body. Dry and unknown cells,
 * and flat square ponds, are zero. Deterministic: byte-equal on every client.
 */
export function flowField(
	grid: SquareGrid,
	water: Uint8Array,
	levels: Uint8Array | null,
	known: CellMask | null,
	bodies: readonly FlowBody[] = waterBodies(grid, water, levels, known),
	floor: FloorMap | null = null
): Uint8Array {
	const { width: w, height: h } = grid;
	const n = w * h;
	const vx = new Float32Array(n);
	const vy = new Float32Array(n);
	for (const e of dropEdges(grid, water, levels, known, floor)) {
		vx[e.from] += (e.upper - e.lower) * DIRS[e.dir].dx;
		vy[e.from] += (e.upper - e.lower) * DIRS[e.dir].dy;
	}
	const body = new Int32Array(n).fill(-1);
	bodies.forEach((b, k) => b.cells.forEach((i) => (body[i] = k)));
	for (const b of bodies) {
		let [x0, y0, x1, y1] = [w, h, -1, -1];
		let [fx, fy] = [0, 0];
		for (const i of b.cells) {
			const x = i % w;
			const y = (i - x) / w;
			[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
			[fx, fy] = [fx + vx[i], fy + vy[i]];
		}
		const [bw, bh] = [x1 - x0 + 1, y1 - y0 + 1];
		const along = bw >= ELONGATED * bh ? 0 : bh >= ELONGATED * bw ? 1 : -1;
		if (along < 0) continue;
		const sign = (along === 0 ? fx : fy) < 0 ? -1 : 1;
		for (const i of b.cells) (along === 0 ? vx : vy)[i] += sign * DRIFT;
	}
	for (let i = 0; i < n; i++) {
		const len = Math.hypot(vx[i], vy[i]);
		if (len > 1) [vx[i], vy[i]] = [vx[i] / len, vy[i] / len];
	}
	const out = new Uint8Array(n * 2).fill(FLOW_ZERO);
	for (let i = 0; i < n; i++) {
		if (body[i] < 0) continue;
		const x = i % w;
		const y = (i - x) / w;
		// Itself twice, and each neighbour of its own body once.
		let [sx, sy, weight] = [2 * vx[i], 2 * vy[i], 2];
		for (const { dx, dy } of DIRS) {
			const [nx, ny] = [x + dx, y + dy];
			if (nx < 0 || ny < 0 || nx >= w || ny >= h || body[ny * w + nx] !== body[i]) continue;
			[sx, sy, weight] = [sx + vx[ny * w + nx], sy + vy[ny * w + nx], weight + 1];
		}
		out[i * 2] = flowByte(sx / weight);
		out[i * 2 + 1] = flowByte(sy / weight);
	}
	return out;
}

/**
 * The two samples' weights at `phase` (time x speed), summing to 1: a sample is offset by
 * `flow x fract(phase)` and the other by `flow x fract(phase + 0.5)`, each weighted by a triangle
 * that is 0 at the instant its own offset wraps, so no reset ever shows. The water kind's TSL
 * mirrors this.
 */
export function flowWeights(phase: number): [number, number] {
	const f = phase - Math.floor(phase);
	const second = Math.abs(1 - 2 * f);
	return [1 - second, second];
}
