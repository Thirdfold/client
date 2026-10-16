// Shaping steps of a CC0 pack model beyond the pack's own nodes (M76, cc0-assemble.ts `glue`): a
// prop laid down or tipped over (`tilt`), a lid swung open about its hinge (`open`) and a fire
// socket (`flame`). They work on the baked parts, before the turn and the fit (tilt) or after them,
// in cells (open, flame), so a lid opened or a socket added never changes the scale a model fits.

import type { Part } from './cc0-assemble';

export interface OpenMeta {
	/** Node names (globs) of what swings: a lid. */
	nodes: string[];
	/** The angle it opens to, in degrees. */
	degrees: number;
	/** The edge it hangs on, in the model's own frame after the turn: its back faces -z. */
	hinge?: 'back' | 'front';
	/** The hinge's [y, z] in cells after the fit, where the group's bounds are not it (a lever's pin). */
	pivot?: [number, number];
}

export interface FlameMeta {
	/** Where the fire sits, in cells from the footprint's centre and the floor. */
	at: [number, number, number];
	/** Its half-size in cells (0.08 by default). */
	size?: number;
}

type Axis = 0 | 1 | 2;

/** Rotates a part's positions and normals by `degrees` about an axis through `origin`. */
function rotate(part: Part, axis: Axis, degrees: number, origin: number[]): void {
	const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
	const [a, b] = [(axis + 1) % 3, (axis + 2) % 3];
	for (const [array, o] of [
		[part.position, origin],
		[part.normal, [0, 0, 0]]
	] as const) {
		for (let i = 0; i < array.length; i += 3) {
			const [u, v] = [array[i + a] - o[a], array[i + b] - o[b]];
			array[i + a] = c * u - s * v + o[a];
			array[i + b] = s * u + c * v + o[b];
		}
	}
}

/** The parts turned about x, then about z, by degrees: a gate laid flat, a bell tipped over. */
export function tilt(parts: Part[], [rx, rz]: [number, number]): void {
	for (const part of parts) {
		if (rx) rotate(part, 0, rx, [0, 0, 0]);
		if (rz) rotate(part, 2, rz, [0, 0, 0]);
	}
}

/** The parts flagged `open` swung up about the bottom edge of their back (or front), by `degrees`. */
export function swingOpen(parts: Part[], open: OpenMeta): void {
	const lid = parts.filter((p) => p.open);
	if (!lid.length) throw new Error(`open: no node matches ${open.nodes.join(', ')}`);
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const p of lid) {
		for (let i = 0; i < p.position.length; i++) {
			min[i % 3] = Math.min(min[i % 3], p.position[i]);
			max[i % 3] = Math.max(max[i % 3], p.position[i]);
		}
	}
	const back = open.hinge !== 'front';
	const edge = back ? min[2] : max[2];
	const hinge = [(min[0] + max[0]) / 2, open.pivot?.[0] ?? min[1], open.pivot?.[1] ?? edge];
	// A right-handed turn about x lifts +z when the angle is negative.
	for (const p of lid) rotate(p, 0, back ? -open.degrees : open.degrees, hinge);
}

/** A small octahedron where the fire sits: the `flame` mesh the lights and the fire seat on. */
export function flameSocket({ at, size = 0.08 }: FlameMeta): Part {
	const r = size;
	const v = [
		[r, 0, 0],
		[-r, 0, 0],
		[0, r * 1.6, 0],
		[0, -r, 0],
		[0, 0, r],
		[0, 0, -r]
	];
	const faces = [
		[0, 2, 4],
		[4, 2, 1],
		[1, 2, 5],
		[5, 2, 0],
		[4, 3, 0],
		[1, 3, 4],
		[5, 3, 1],
		[0, 3, 5]
	];
	const position = new Float32Array(faces.length * 9);
	const normal = new Float32Array(faces.length * 9);
	faces.forEach((f, k) => {
		const [p, q, w] = f.map((i) => v[i]);
		const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
		const e2 = [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
		const n = [
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0]
		];
		const l = Math.hypot(...n) || 1;
		[p, q, w].forEach((pt, j) => {
			for (let a = 0; a < 3; a++) {
				position[k * 9 + j * 3 + a] = pt[a] + at[a];
				normal[k * 9 + j * 3 + a] = n[a] / l;
			}
		});
	});
	return {
		role: 'flame',
		pose: 0,
		material: null,
		position,
		normal,
		uv: null,
		color: null,
		index: Uint32Array.from({ length: faces.length * 3 }, (_, i) => i)
	};
}

/**
 * A part with no UVs given box-projected ones, one repeat per `cells` cells (a library surface's
 * scale): each face takes its dominant normal's two other axes, so the vertices are split per
 * triangle (the weld after the simplifier joins the ones that still agree).
 */
export function boxUvs(part: Part, cells = 0.5): void {
	const n = part.index.length;
	const position = new Float32Array(n * 3);
	const normal = new Float32Array(n * 3);
	const uv = new Float32Array(n * 2);
	const color = part.color ? new Float32Array(n * 4) : null;
	for (let t = 0; t < n; t += 3) {
		let [nx, ny, nz] = [0, 0, 0];
		for (let k = 0; k < 3; k++) {
			const v = part.index[t + k];
			nx += part.normal[v * 3];
			ny += part.normal[v * 3 + 1];
			nz += part.normal[v * 3 + 2];
		}
		const axis =
			Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz)
				? 1
				: Math.abs(nx) >= Math.abs(nz)
					? 0
					: 2;
		const [u, w] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
		for (let k = 0; k < 3; k++) {
			const [v, o] = [part.index[t + k], t + k];
			for (let a = 0; a < 3; a++) {
				position[o * 3 + a] = part.position[v * 3 + a];
				normal[o * 3 + a] = part.normal[v * 3 + a];
			}
			uv[o * 2] = part.position[v * 3 + u] / cells;
			uv[o * 2 + 1] = part.position[v * 3 + w] / cells;
			if (color && part.color) color.set(part.color.subarray(v * 4, v * 4 + 4), o * 4);
		}
	}
	Object.assign(part, {
		position,
		normal,
		uv,
		color,
		index: Uint32Array.from({ length: n }, (_, i) => i)
	});
}
