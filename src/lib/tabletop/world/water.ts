// The water's surfaces (#293), one 16x16 chunk at a time: a flat quad over every water cell of the
// world's shape at its class's height, wadeable water just under its floor (a base meets it) and
// deep water lower, under a lip. Pure, in the lazy `world` chunk; water-layer.ts makes the meshes.
// The ground's chunks carve the bed under them (`WATER_BED`, ground-mesh.ts) and run the banks down
// to it, so the surface needs no walls of its own. A quad reaches `OVERLAP` past an edge toward
// ground as high as its floor or higher, under that ground's top, so no crack shows where a cliff's
// face is set back under its rim. Unexplored cells the shape continues as water get a surface too:
// it is black there, as everything is. Lava (#297) is the same quads at deep water's height, a mesh
// of its own; waterfalls (#295, `chunkFalls`) hang one quad down each run of drop edges.

import { STEP_HEIGHT } from '../ground';
import type { DropEdge } from './flow';
import { DIRS } from './regions';
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
): { wade: WaterMesh; deep: WaterMesh; lava: WaterMesh } {
	const { grid, levels } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid).x;
	const [cx, cy] = [(chunk % across) * CHUNK, Math.floor(chunk / across) * CHUNK];
	const mesh = () => ({ pos: [] as number[], idx: [] as number[] });
	const out = { wade: mesh(), deep: mesh(), lava: mesh() };
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
			const c = classes[i];
			const into = c === WATER_CLASS.wade ? out.wade : c === WATER_CLASS.lava ? out.lava : out.deep;
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
	return { wade: done(out.wade), deep: done(out.deep), lava: done(out.lava) };
}

/** How far a fall hangs in front of the edge it spills over, in cells: before the cliff's face. */
export const FALL_FRONT = 0.02;

/** A waterfall (#295): its foot's middle, its width along the edge and its drop, world units. */
export interface Fall {
	pos: { x: number; y: number; z: number };
	width: number;
	height: number;
}

/** A chunk's waterfalls: one quad per run, facing the lower side; uv (along, down), both 0 to 1. */
export interface FallMesh extends WaterMesh {
	normals: Float32Array;
	uvs: Float32Array;
	falls: Fall[];
}

/**
 * The waterfalls of a chunk (`chunksAcross` row-major) from `dropEdges` over the shape's water:
 * each run of edges along one side that drop from the same height to the same height, within the
 * chunk, is one quad `FALL_FRONT` in front of the edge, from the upper surface to the lower one
 * (a pool's surface, or the ground). Lava (#297) never falls; water may fall into it.
 */
export function chunkFalls(
	shape: WorldShape,
	classes: Uint8Array,
	edges: readonly DropEdge[],
	chunk: number
): FallMesh {
	const { grid, levels } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid).x;
	const inChunk = (i: number) =>
		Math.floor((i % w) / CHUNK) + Math.floor(Math.floor(i / w) / CHUNK) * across === chunk;
	const top = (e: DropEdge) => surfaceY(shape, classes, e.from);
	const foot = (e: DropEdge) =>
		classes[e.to] ? surfaceY(shape, classes, e.to) : levels[e.to] * STEP_HEIGHT * cs;
	const byKey = new Map<string, DropEdge>();
	for (const e of edges)
		if (inChunk(e.from) && classes[e.from] !== WATER_CLASS.lava) byKey.set(`${e.from}:${e.dir}`, e);
	const same = (a: DropEdge | undefined, b: DropEdge) =>
		!!a && inChunk(a.from) && top(a) === top(b) && foot(a) === foot(b);
	const [pos, nor, uv, idx] = [[], [], [], []] as number[][];
	const falls: Fall[] = [];
	for (const e of byKey.values()) {
		const { dx, dy } = DIRS[e.dir];
		const step = dx === 0 ? 1 : w; // along the edge
		if (same(byKey.get(`${e.from - step}:${e.dir}`), e)) continue; // inside a run
		let last = e;
		for (let next; same((next = byKey.get(`${last.from + step}:${e.dir}`)), e);) last = next!;
		const [x0, y0] = [e.from % w, Math.floor(e.from / w)];
		const [x1, y1] = [last.from % w, Math.floor(last.from / w)];
		// The edge's line, in cells: the far side of the cells toward the drop.
		const fx = dx > 0 ? x0 + 1 : dx < 0 ? x0 : null;
		const fy = dy > 0 ? y0 + 1 : dy < 0 ? y0 : null;
		const [ax, az] = [fx ?? x0, fy ?? y0];
		const [bx, bz] = [fx ?? x1 + 1, fy ?? y1 + 1];
		const world = (cx: number, cz: number): [number, number] => [
			(cx - w / 2 + dx * FALL_FRONT) * cs,
			(cz - h / 2 + dy * FALL_FRONT) * cs
		];
		const [a, b] = [world(ax, az), world(bx, bz)];
		const [hi, lo] = [top(e), foot(e)];
		const base = pos.length / 3;
		pos.push(a[0], hi, a[1], b[0], hi, b[1], b[0], lo, b[1], a[0], lo, a[1]);
		for (let k = 0; k < 4; k++) nor.push(dx, 0, dy);
		uv.push(0, 0, 1, 0, 1, 1, 0, 1);
		// Facing the drop: (a, b, b's foot)'s normal is (bz - az, -(bx - ax)) across the edge.
		const flip = (b[1] - a[1]) * dx - (b[0] - a[0]) * dy < 0;
		idx.push(...(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]).map((k) => base + k));
		const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const mid = { x: (a[0] + b[0]) / 2, y: lo, z: (a[1] + b[1]) / 2 };
		falls.push({ pos: mid, width, height: hi - lo });
	}
	return {
		positions: new Float32Array(pos),
		normals: new Float32Array(nor),
		uvs: new Float32Array(uv),
		indices: new Uint32Array(idx),
		falls
	};
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
