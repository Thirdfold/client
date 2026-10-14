// The particle atlas (#311): the sprites the particle layer draws (src/lib/tabletop/vfx-recipes.ts
// `ATLAS`), drawn from a seed (the `sprites` recipe, textures.ts), so the same source always builds
// the same PNG. A 4x4 grid of cells, row-major from the bottom of the image (the texture is
// flipped on load, as the decal atlas, decal-art.ts): a soft disc, a spark's glint, four frames of
// a smoke puff spreading and thinning, a ring, a shield and a plus. Coverage in alpha, a shade in
// RGB (white but for the puff's billows), linear: the recipes colour them. Every cell fades out a
// few texels inside its border, so neither filtering nor mips bleed into the next.

import { ATLAS, ATLAS_ACROSS, PUFF_FRAMES } from '../../src/lib/tabletop/vfx-recipes';

const smooth = (e0: number, e1: number, x: number) => {
	const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Seeded value noise in 0..1, three octaves (not tiling: a puff fades out inside its cell). */
function noiseOf(seed: number): (x: number, y: number) => number {
	const hash = (x: number, y: number) => {
		let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 0x9e3779b1);
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	};
	const value = (x: number, y: number) => {
		const [x0, y0] = [Math.floor(x), Math.floor(y)];
		const [tx, ty] = [smooth(0, 1, x - x0), smooth(0, 1, y - y0)];
		const top = hash(x0, y0) * (1 - tx) + hash(x0 + 1, y0) * tx;
		const bottom = hash(x0, y0 + 1) * (1 - tx) + hash(x0 + 1, y0 + 1) * tx;
		return top * (1 - ty) + bottom * ty;
	};
	return (x, y) =>
		(value(x, y) * 4 + value(x * 2 + 7.1, y * 2) * 2 + value(x * 4, y * 4 + 3.3)) / 7;
}

/** Inside a heater shield (x, y in -1..1, y up), scaled by `s`. */
const inShield = (x: number, y: number, s: number) => {
	[x, y] = [x / s, y / s];
	if (y > 0.75 || y < -0.85) return false;
	const half = y >= 0 ? 0.65 : 0.65 * Math.sqrt(1 - (y / -0.85) ** 2);
	return Math.abs(x) <= half;
};

/** What a sprite is at a point of its cell (x, y in -1..1, y up): coverage and shade. */
function sprite(cell: number, x: number, y: number, noise: (x: number, y: number) => number) {
	const r = Math.hypot(x, y);
	if (cell === ATLAS.disc) return { a: (1 - smooth(0, 1, r)) ** 1.5, shade: 1 };
	if (cell === ATLAS.spark) {
		const glint = Math.exp(-(x * x * 60 + y * y * 3)) + Math.exp(-(y * y * 60 + x * x * 3));
		return { a: Math.min(1, glint + Math.exp(-r * r * 12)) * (1 - smooth(0.6, 1, r)), shade: 1 };
	}
	if (cell >= ATLAS.puff && cell < ATLAS.puff + PUFF_FRAMES) {
		const f = (cell - ATLAS.puff) / (PUFF_FRAMES - 1); // 0 a tight puff, 1 spread thin
		const n = noise((x + 1) * (2 + f) + cell * 3.7, (y + 1) * (2 + f));
		const body = 1 - smooth(0.35 + 0.25 * f, 0.95, r + (n - 0.5) * (0.5 + 0.3 * f));
		return { a: body * (1 - 0.45 * f), shade: 0.7 + 0.3 * n };
	}
	if (cell === ATLAS.ring) return { a: Math.exp(-(((r - 0.78) / 0.09) ** 2)), shade: 1 };
	if (cell === ATLAS.shield) {
		// A bright rim round a fainter face, supersampled for its edges.
		let [a, k] = [0, 0];
		for (let i = 0; i < 4; i++)
			for (let j = 0; j < 4; j++, k++) {
				const [sx, sy] = [x + (i - 1.5) * 0.008, y + (j - 1.5) * 0.008];
				a += inShield(sx, sy, 1) ? (inShield(sx, sy, 0.82) ? 0.45 : 1) : 0;
			}
		return { a: a / k, shade: 1 };
	}
	if (cell === ATLAS.plus) {
		const bar = (u: number, v: number) =>
			smooth(0.2, 0.15, Math.abs(u)) * smooth(0.72, 0.66, Math.abs(v));
		return { a: Math.max(bar(x, y), bar(y, x)), shade: 1 };
	}
	return { a: 0, shade: 1 };
}

/** The atlas's RGBA pixels, `size` a side. */
export function renderSprites(size: number, seed: number): Uint8Array {
	const cell = size / ATLAS_ACROSS;
	const out = new Uint8Array(size * size * 4);
	const noise = noiseOf(seed);
	const byte = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
	for (let c = 0; c < ATLAS_ACROSS * ATLAS_ACROSS; c++) {
		const [x0, y0] = [
			(c % ATLAS_ACROSS) * cell,
			(ATLAS_ACROSS - 1 - Math.floor(c / ATLAS_ACROSS)) * cell
		];
		for (let y = 0; y < cell; y++)
			for (let x = 0; x < cell; x++) {
				const [u, v] = [(x + 0.5) / cell, 1 - (y + 0.5) / cell];
				const { a, shade } = sprite(c, u * 2 - 1, v * 2 - 1, noise);
				const rim = smooth(0.01, 0.05, Math.min(u, 1 - u, v, 1 - v));
				const s = byte(shade);
				out.set([s, s, s, byte(a * rim)], ((y0 + y) * size + x0 + x) * 4);
			}
	}
	return out;
}
