// The grass's blades (#302): how many a cell grows, the strip each is drawn from, and the CPU
// mirror of where the graph puts them in a cell (materials/grass.ts reads the same constants).
// Pure and renderer-free (no three.js), so its specs run in the server project.

import { CAP_OVERHANG, WALL_HALF_THIN } from '../../assets/kit';
import { INSET } from './grass-cells';

/** The tallest a blade grows, in cells: under a base's rim with its parting (#303), never above. */
export const GRASS_HEIGHT = 0.15;
/**
 * How far blades keep off a cell's side, in cells, by its `INSET` bit: half a thin wall and its
 * cap's overhang from a wall, window or door; the dual grid's rounding (shape.ts `MAX_ROUND`,
 * held to it by the specs; not imported, so the grass chunk keeps clear of the world chunk's code)
 * from a drop, the void, lava or water.
 */
export const INSET_MARGIN = { wall: WALL_HALF_THIN + CAP_OVERHANG + 0.02, wide: 0.25 };
/**
 * Distance fade (cells): the last blade of a cell fades out by `far`, and blade b of B by
 * `far * (1 - keep * b / B)`, so a field thins with distance; each over its last `band` of that.
 */
export const FADE = { far: 80, keep: 0.6, band: 0.3 };

/** The margins (north, east, south, west) a cell's inset bits keep its blades off its sides. */
export function margins(bits: number): [number, number, number, number] {
	const side = (d: number) =>
		Math.max(
			bits & (INSET.wall << d) ? INSET_MARGIN.wall : 0,
			bits & (INSET.wide << d) ? INSET_MARGIN.wide : 0
		);
	return [side(0), side(1), side(2), side(3)];
}

/**
 * Where a blade with placement `(a, b)` (two hashes, 0-1) roots in its cell, 0-1 across it (x east,
 * y south): the cell less its margins. What the graph does, for the specs.
 */
export function rootIn(bits: number, a: number, b: number): { x: number; y: number } {
	const [n, e, s, w] = margins(bits);
	return { x: w + a * (1 - w - e), y: n + b * (1 - n - s) };
}

/**
 * One blade's strip: `segments` quads tapering to a tip. Each vertex's x is its side (-1, 1, or 0 at
 * the tip) and y its height along the blade (`t`, 0 at the root, 1 at the tip); the graph makes the
 * rest from them. Wound both ways round in effect: the material is double-sided.
 */
export function bladeStrip(segments: number): { positions: Float32Array; indices: Uint16Array } {
	const positions = new Float32Array((2 * segments + 1) * 3);
	for (let s = 0; s < segments; s++) {
		positions.set([-1, s / segments, 0, 1, s / segments, 0], s * 6);
	}
	positions.set([0, 1, 0], segments * 6);
	const indices: number[] = [];
	for (let s = 0; s < segments - 1; s++) {
		const [a, b, c, d] = [2 * s, 2 * s + 1, 2 * s + 2, 2 * s + 3];
		indices.push(a, b, c, b, d, c);
	}
	const last = 2 * (segments - 1);
	indices.push(last, last + 1, 2 * segments);
	return { positions, indices: Uint16Array.from(indices) };
}

/**
 * How many of a cell's `blades` can show to a camera `near` (cells) from the nearest grass: the
 * rest have faded out (`FADE`), so drawing fewer instances drops nothing visible.
 */
export function bladesInView(blades: number, near: number): number {
	if (near >= FADE.far) return 0;
	const shown = Math.ceil((blades * (1 - near / FADE.far)) / FADE.keep);
	return Math.min(blades, Math.max(0, shown));
}
