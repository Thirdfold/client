// The water's surfaces (#293), one 16x16 chunk at a time: a flat quad over every water cell of the
// world's shape at its class's height, wadeable water just under its floor (a base meets it) and
// deep water lower, under a lip. Pure, in the lazy `world` chunk; water-layer.ts makes the meshes.
// The ground's chunks carve the bed under them (`WATER_BED`, ground-mesh.ts) and run the banks down
// to it, so the surface needs no walls of its own. A quad reaches `OVERLAP` past an edge toward
// ground as high as its floor or higher, under that ground's top, so no crack shows where a cliff's
// face is set back under its rim. Unexplored cells the shape continues as water get a surface too:
// it is black there, as everything is.

import { STEP_HEIGHT } from '../ground';
import { CHUNK, chunksAcross, MAX_NOISE, type WorldShape } from './shape';
import { WATER_CLASS } from './shore';

/** How far under its floor wadeable water lies, in cells: a token's base meets it. */
export const WADE_SURFACE = 0.02;
/** How far under its floor deep water lies, in levels: below a lip. */
export const DEEP_SURFACE = 0.3;
/** How far a surface reaches under higher ground beside it, in cells: past any cliff's set-back. */
export const OVERLAP = MAX_NOISE;

/** One class's surface in a chunk: flat quads facing up. */
export interface WaterMesh {
	positions: Float32Array;
	indices: Uint32Array;
}

/** A water cell's surface height, in world units (`classes` from shore.ts `waterClasses`). */
export function surfaceY(shape: WorldShape, classes: Uint8Array, i: number): number {
	const { grid } = shape;
	const floor = shape.levels[i] * STEP_HEIGHT * grid.cellSize;
	return classes[i] === WATER_CLASS.wade
		? floor - WADE_SURFACE * grid.cellSize
		: floor - DEEP_SURFACE * STEP_HEIGHT * grid.cellSize;
}

/** A chunk's wadeable and deep surfaces (`chunksAcross` row-major). */
export function chunkWater(
	shape: WorldShape,
	classes: Uint8Array,
	chunk: number
): { wade: WaterMesh; deep: WaterMesh } {
	const { grid, levels } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid).x;
	const [cx, cy] = [(chunk % across) * CHUNK, Math.floor(chunk / across) * CHUNK];
	const out = { wade: { pos: [] as number[], idx: [] as number[] }, deep: { pos: [], idx: [] } };
	const reach = OVERLAP * cs;
	/** Whether the surface reaches past the edge toward (x, y): ground as high or higher. */
	const under = (i: number, x: number, y: number) => {
		if (x < 0 || y < 0 || x >= w || y >= h) return false;
		const j = y * w + x;
		return !classes[j] && levels[j] >= levels[i];
	};
	for (let y = cy; y < Math.min(cy + CHUNK, h); y++)
		for (let x = cx; x < Math.min(cx + CHUNK, w); x++) {
			const i = y * w + x;
			if (!classes[i]) continue;
			const into = classes[i] === WATER_CLASS.wade ? out.wade : out.deep;
			const top = surfaceY(shape, classes, i);
			const x0 = (x - w / 2) * cs - (under(i, x - 1, y) ? reach : 0);
			const x1 = (x + 1 - w / 2) * cs + (under(i, x + 1, y) ? reach : 0);
			const z0 = (y - h / 2) * cs - (under(i, x, y - 1) ? reach : 0);
			const z1 = (y + 1 - h / 2) * cs + (under(i, x, y + 1) ? reach : 0);
			const base = into.pos.length / 3;
			into.pos.push(x0, top, z0, x0, top, z1, x1, top, z1, x1, top, z0);
			into.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}
	const done = (m: { pos: number[]; idx: number[] }): WaterMesh => ({
		positions: new Float32Array(m.pos),
		indices: new Uint32Array(m.idx)
	});
	return { wade: done(out.wade), deep: done(out.deep) };
}

/**
 * The chunks whose water changed from `prev` to `next` classes, with a one-cell margin (a quad
 * reaches past its edge by what lies beside it). Every chunk when the sizes differ. Sorted.
 */
export function dirtyWaterChunks(
	shape: WorldShape,
	prev: Uint8Array | null,
	next: Uint8Array
): number[] {
	const { grid } = shape;
	const across = chunksAcross(grid);
	const all = Array.from({ length: across.x * across.y }, (_, c) => c);
	if (!prev || prev.length !== next.length) return all;
	const dirty = new Set<number>();
	for (let i = 0; i < next.length; i++) {
		if (prev[i] === next[i]) continue;
		const [x, y] = [i % grid.width, Math.floor(i / grid.width)];
		for (const [dx, dy] of [
			[0, 0],
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1]
		]) {
			const [nx, ny] = [x + dx, y + dy];
			if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
			dirty.add(Math.floor(ny / CHUNK) * across.x + Math.floor(nx / CHUNK));
		}
	}
	return [...dirty].sort((a, b) => a - b);
}
