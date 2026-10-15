// Props by chunk (#334): which 16x16-cell chunks of props a camera may see, so the props layer
// leaves out the visible levels of models with levels in chunks out of view. Their shadows never
// change with it: a model with levels casts through its proxy (#274), which holds every prop. Pure
// (no three.js), in the lazy `world` chunk, tested in the server project.

import { CHUNK } from './shape';

/** The planes of a view: the four sides and the near one (axis 0, 1 or 2 of the clip box, and its sign). */
const SIDES = [
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[2, 1]
] as const;

/**
 * The side and near planes of a camera whose projection times view matrix is `vp` (three's
 * column-major `elements`): each plane is the matrix's last row plus or minus another (Gribb and
 * Hartmann), as `[a, b, c, d]` with `|(a, b, c)|` as a fifth entry.
 */
export function viewPlanes(vp: ArrayLike<number>): number[][] {
	return SIDES.map(([k, s]) => {
		const p = [0, 1, 2, 3].map((col) => vp[4 * col + 3] + s * vp[4 * col + k]);
		return [...p, Math.hypot(p[0], p[1], p[2])];
	});
}

/** Whether a sphere reaches into the view of `planes` (`viewPlanes`). Conservative: never false for one in view. */
export function sphereInView(planes: number[][], x: number, y: number, z: number, r: number) {
	return planes.every(([a, b, c, d, n]) => a * x + b * y + c * z + d >= -r * n);
}

/** The chunk of a prop anchored at cell `pos` on a grid `width` cells wide: row-major, as the ground's. */
export function propChunk(pos: { x: number; y: number }, width: number): number {
	return Math.floor(pos.y / CHUNK) * Math.ceil(width / CHUNK) + Math.floor(pos.x / CHUNK);
}

/** A prop as the culling sees it: its chunk and a sphere (world units) round all it may draw. */
export interface PropSphere {
	chunk: number;
	x: number;
	y: number;
	z: number;
	r: number;
}

/**
 * The chunks with any prop sphere in the view of `vp`. A chunk is in or out whole, so the set
 * changes only as the first of its props comes into view or the last leaves it.
 */
export function chunksInView(spheres: Iterable<PropSphere>, vp: ArrayLike<number>): Set<number> {
	const planes = viewPlanes(vp);
	const seen = new Set<number>();
	for (const s of spheres)
		if (!seen.has(s.chunk) && sphereInView(planes, s.x, s.y, s.z, s.r)) seen.add(s.chunk);
	return seen;
}

/** Whether two sets of chunks are the same. */
export function sameChunks(a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean {
	return a === b || (!!a && !!b && a.size === b.size && [...a].every((c) => b.has(c)));
}
