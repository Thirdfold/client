// The sea ring (milestone 73, #296): for a `sea` backdrop, the ocean round the grid out to the
// horizon, built instead of beyond.ts's skirt. An annulus whose hole is exactly the grid's
// rectangle (its columns start on the border, so nothing lies inside it), with rows spaced
// geometrically: dense at the grid, sparse far out. Its inner heights take the surface of the
// edge cells they meet and ease to the backdrop's level over `SWELL_RAMP_CELLS`, so there is no
// step at the border. The swell (swell.ts) is the shader's, on top of these heights.
//
// Pure, renderer-free and built only from scene-level data (the backdrop, the grid's size) and,
// when the caller has it, the surface height of each edge cell as the viewer knows it: an unknown
// edge cell is just the backdrop's, so the ring tells nobody about unexplored ground.
// docs/RENDERING.md, "Sea surround".

import { STEP_HEIGHT } from '../ground';
import type { Beyond, BeyondMesh } from './beyond';
import { SWELL_RAMP_CELLS, type SeaTier } from './swell';
import { DEEP_SURFACE, WADE_SURFACE } from './water';

/** Columns round the ring and rows out from the grid, by tier: about 8k, 20k and 40k vertices. */
export const SEA_RING = {
	low: { columns: 96, rows: 80 },
	medium: { columns: 160, rows: 120 },
	high: { columns: 240, rows: 160 }
} as const;

/** The tier table's vertex counts, ring corners included (a spec holds each ring within 5%). */
export const SEA_VERTICES = { low: 8000, medium: 20000, high: 40000 } as const;

/** How fast the rows spread out: the last is this many times the first's step from the grid. */
const GROWTH = 64;

/** The surface of deep water over a floor at `level`, in world units. */
export const deepSurfaceY = (level: number, cellSize: number) =>
	(level - DEEP_SURFACE) * STEP_HEIGHT * cellSize;
/** The surface of wadeable water (and what meets land or the void) at `level`. */
export const wadeSurfaceY = (level: number, cellSize: number) =>
	level * STEP_HEIGHT * cellSize - WADE_SURFACE * cellSize;

/** The surface height, in world units, of the edge cell in column `x`, row `y`. */
export type EdgeSurface = (x: number, y: number) => number;

const smooth = (f: number) => {
	const t = Math.min(Math.max(f, 0), 1);
	return t * t * (3 - 2 * t);
};

/** The grid's side from where its rectangle ends, in whole cells. */
const cells = (half: number, cellSize: number) => Math.max(1, Math.round((2 * half) / cellSize));

/**
 * The ring for a `sea` backdrop. `edge` gives the surface of the grid's border cells; without it
 * every one is wadeable water at the backdrop's level. Columns run clockwise from above (north
 * edge toward +x, then east, south, west), the corners each one column, so every triangle faces up.
 */
export function seaMesh(b: Beyond, tier: SeaTier, edge?: EdgeSurface): BeyondMesh {
	const { halfX: hw, halfZ: hd, cellSize: c, horizon } = b.span;
	const { columns: want, rows } = SEA_RING[tier];
	const [w, h] = [cells(hw, c), cells(hd, c)];
	const far = deepSurfaceY(b.level, c);
	const home = wadeSurfaceY(b.level, c);
	const surface = (px: number, pz: number) => {
		if (!edge) return home;
		// Between the centres of the border cells nearest the point: only one axis varies.
		const u = Math.min(Math.max((px + hw) / c - 0.5, 0), w - 1);
		const v = Math.min(Math.max((pz + hd) / c - 0.5, 0), h - 1);
		const [u0, v0] = [Math.floor(u), Math.floor(v)];
		const [u1, v1] = [Math.min(u0 + 1, w - 1), Math.min(v0 + 1, h - 1)];
		const [fu, fv] = [u - u0, v - v0];
		const top = edge(u0, v0) * (1 - fu) + edge(u1, v0) * fu;
		const bottom = edge(u0, v1) * (1 - fu) + edge(u1, v1) * fu;
		return top * (1 - fv) + bottom * fv;
	};

	// The border's points in order, with the outward normal of each (a corner's is its diagonal).
	const sides = [
		{ x: -hw, z: -hd, dx: 1, dz: 0, len: 2 * hw, nx: 0, nz: -1 },
		{ x: hw, z: -hd, dx: 0, dz: 1, len: 2 * hd, nx: 1, nz: 0 },
		{ x: hw, z: hd, dx: -1, dz: 0, len: 2 * hw, nx: 0, nz: 1 },
		{ x: -hw, z: hd, dx: 0, dz: -1, len: 2 * hd, nx: -1, nz: 0 }
	];
	const perimeter = 4 * (hw + hd);
	const points: { x: number; z: number; nx: number; nz: number }[] = [];
	sides.forEach((s, i) => {
		const n = Math.max(1, Math.round((want * s.len) / perimeter));
		const before = sides[(i + 3) % 4];
		for (let t = 0; t < n; t++) {
			const [x, z] = [s.x + (s.dx * s.len * t) / n, s.z + (s.dz * s.len * t) / n];
			if (t > 0) points.push({ x, z, nx: s.nx, nz: s.nz });
			else
				points.push({
					x,
					z,
					nx: Math.SQRT1_2 * (s.nx + before.nx),
					nz: Math.SQRT1_2 * (s.nz + before.nz)
				});
		}
	});

	// Out to where even the nearest side is at the horizon; the haze has taken the sea by then.
	const reach = Math.max(horizon - Math.min(hw, hd), SWELL_RAMP_CELLS * c);
	const distance = (k: number) => (reach * (GROWTH ** (k / (rows - 1)) - 1)) / (GROWTH - 1);
	const positions = new Float32Array(points.length * rows * 3);
	const uvs = new Float32Array(points.length * rows * 2);
	points.forEach((p, i) => {
		const inner = surface(p.x, p.z);
		for (let k = 0; k < rows; k++) {
			const d = distance(k);
			const [x, z] = [p.x + p.nx * d, p.z + p.nz * d];
			const y = inner + (far - inner) * smooth(d / (SWELL_RAMP_CELLS * c));
			const v = i * rows + k;
			positions.set([x, y, z], v * 3);
			uvs.set([x, -z], v * 2);
		}
	});

	const indices = new Uint32Array(points.length * (rows - 1) * 6);
	let o = 0;
	for (let i = 0; i < points.length; i++) {
		const a = i * rows;
		const next = ((i + 1) % points.length) * rows;
		for (let k = 0; k < rows - 1; k++) {
			// Columns rise from +x toward +z, so (a, next, a+1) faces up (+y).
			indices.set([a + k, next + k, a + k + 1, a + k + 1, next + k, next + k + 1], o);
			o += 6;
		}
	}
	return { positions, uvs, indices };
}
