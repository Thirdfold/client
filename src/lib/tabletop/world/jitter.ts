// Decor jitter (#306): a crate, a barrel or a heap of rubble sits at a slightly free angle and a
// little off its cell's centre, so a room does not look set on a grid. Purely visual: it comes from
// the prop's id (the same on every client), is bounded by the catalogue's `jitter` and by the
// model's manifest bounds so the model never crosses its footprint, and changes no rule, no pick
// and nothing on the wire. Pure, no three.js.

import { keyHash, seededRandom } from './hash';

/** The catalogue's limits (checked by the build): degrees, cells. */
export const JITTER_LIMITS = { yaw: 20, offset: 0.15 } as const;

/** A model must stay this far (in cells) inside its footprint's edge. */
export const JITTER_MARGIN = 0.03;

export interface JitterSpec {
	/** Largest turn either way, in degrees. */
	yaw: number;
	/** Largest nudge on each axis, in cells. */
	offset: number;
}

export interface Bounds {
	min: readonly [number, number, number];
	max: readonly [number, number, number];
}

/** What to add to a placement: a turn about the vertical (radians, three's sense) and a nudge in cells. */
export interface Jitter {
	yaw: number;
	dx: number;
	dz: number;
}

export const NO_JITTER: Jitter = { yaw: 0, dx: 0, dz: 0 };

/** The nudge range on one axis that keeps `[lo, hi]` (about the centre) inside `half` less the margin. */
function range(lo: number, hi: number, half: number, offset: number): [number, number] {
	return [
		Math.max(-half + JITTER_MARGIN - lo, -offset),
		Math.min(half - JITTER_MARGIN - hi, offset)
	];
}

/**
 * The jitter of prop `propId`. `bounds` are its model's (cells, about the footprint's centre),
 * `footprint` the footprint's size in cells as placed (already turned by `rotation`, the quarter
 * turns the prop is placed at) and `scale` its visual scale. The offset is clamped, and the yaw
 * shrunk, so the scaled and turned bounds stay inside the footprint; a model that cannot (it
 * overflows its footprint already), or has no `jitter` or no `bounds`, gets none.
 */
export function jitterFor(
	propId: string,
	jitter: JitterSpec | undefined,
	bounds: Bounds | undefined,
	footprint: { w: number; h: number },
	rotation: number,
	scale: number
): Jitter {
	if (!jitter || !bounds || (jitter.yaw <= 0 && jitter.offset <= 0)) return NO_JITTER;
	const rand = seededRandom(keyHash(propId));
	const [u, v, t] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
	const yawMax = (Math.min(jitter.yaw, JITTER_LIMITS.yaw) * Math.PI) / 180;
	const offset = Math.min(jitter.offset, JITTER_LIMITS.offset);
	const [x0, x1] = [bounds.min[0] * scale, bounds.max[0] * scale];
	const [z0, z1] = [bounds.min[2] * scale, bounds.max[2] * scale];
	// The yaw's shares to try: all of it, then less, then none.
	for (const share of [1, 0.5, 0.25, 0]) {
		const yaw = u * yawMax * share;
		// Three's turn about y by `a` takes (x, z) to (x cos a + z sin a, z cos a - x sin a).
		const a = -rotation * (Math.PI / 2) + yaw;
		const [c, s] = [Math.cos(a), Math.sin(a)];
		const xs = [x0 * c + z0 * s, x0 * c + z1 * s, x1 * c + z0 * s, x1 * c + z1 * s];
		const zs = [z0 * c - x0 * s, z1 * c - x0 * s, z0 * c - x1 * s, z1 * c - x1 * s];
		const [xl, xh] = range(Math.min(...xs), Math.max(...xs), footprint.w / 2, offset);
		const [zl, zh] = range(Math.min(...zs), Math.max(...zs), footprint.h / 2, offset);
		if (xl > xh || zl > zh) continue;
		const pick = (r: number, l: number, h: number) => Math.min(h, Math.max(l, r * offset)) + 0; // no -0
		return { yaw, dx: pick(v, xl, xh), dz: pick(t, zl, zh) };
	}
	return NO_JITTER;
}
