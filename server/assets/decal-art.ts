// The decal atlas (#307): grime, moss, damp, soot, scorch, hairline cracks, leaf litter and a
// blood splatter, each in `DECAL_VARIANTS` cells of a 4x4 grid, drawn from a seed (the `decals`
// recipe, textures.ts), so the same source always builds the same PNGs. Three outputs, one layout:
// the albedo with alpha (sRGB), its normal map and a mask (linear: R roughness, G cavity, B kept
// at 0 for #313's wetness). Cells run row-major from the bottom of the image (the texture is
// flipped on load, so v = 0 is a cell's bottom: wall decals gather there, at the wall's foot).
//
// Straight alpha with the colour dilated: under alpha 0 every texel holds its decal's middle
// colour, so filtering and mips never pull a dark fringe in (what premultiplying would buy,
// without its error through the sRGB curve). Every cell fades out a few texels inside its border.

import { DECAL_ACROSS, DECAL_KEYS, DECAL_VARIANTS } from '../../src/lib/assets/decals';

export const DECAL_OUTPUTS = ['albedo', 'normal', 'mask'] as const;
export type DecalOutput = (typeof DECAL_OUTPUTS)[number];

/** What a decal is at a point of its cell (u, v in 0..1, v up). */
interface Texel {
	/** Coverage. */
	a: number;
	/** 0 its dark colour, 1 its light one. */
	tone: number;
	/** Relief, in cells of the decal: positive raised, negative a groove. */
	h: number;
	/** Cavity darkening, 0 to 1. */
	cavity: number;
}

interface Look {
	dark: [number, number, number];
	light: [number, number, number];
	rough: number;
	draw: (u: number, v: number, n: Noise) => Texel;
}

type Noise = (x: number, y: number, octaves?: number) => number;

const smooth = (e0: number, e1: number, x: number) => {
	const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Seeded fBm value noise in 0..1 (not tiling: a decal fades out inside its cell). */
function noiseOf(seed: number): Noise {
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
	return (x, y, octaves = 4) => {
		let [sum, weight, f, total] = [0, 1, 1, 0];
		for (let o = 0; o < octaves; o++) {
			sum += value(x * f + o * 17.3, y * f + o * 9.1) * weight;
			total += weight;
			weight *= 0.5;
			f *= 2;
		}
		return sum / total;
	};
}

const rgb = (hex: number): [number, number, number] => [hex >> 16, (hex >> 8) & 255, hex & 255];
const none: Texel = { a: 0, tone: 0.5, h: 0, cavity: 0 };

/** A ragged band rising from a wall's foot: `top` its height, `depth` how soft its top. */
function foot(u: number, v: number, n: Noise, top: number, depth: number): number {
	const edge = top + (n(u * 5, 3.7) - 0.5) * 0.35;
	return smooth(edge, edge - depth, v) * sides(u);
}

/** Feathered toward a cell's sides, so a band along a wall has no hard ends. */
const sides = (u: number) => smooth(0.5, 0.36, Math.abs(u - 0.5));

/** Small round splashes about the centre: their coverage at (u, v). */
function drops(u: number, v: number, rand: () => number, count: number, reach: number): number {
	let a = 0;
	for (let k = 0; k < count; k++) {
		const [angle, d] = [rand() * Math.PI * 2, 0.15 + rand() * reach];
		const r = 0.012 + rand() * 0.03 * (1 - d / (reach + 0.15));
		const dist = Math.hypot(u - 0.5 - Math.cos(angle) * d, v - 0.5 - Math.sin(angle) * d);
		a = Math.max(a, smooth(r, r * 0.6, dist));
	}
	return a;
}

const LOOKS: Record<(typeof DECAL_KEYS)[number], Look> = {
	grime: {
		dark: rgb(0x221e19),
		light: rgb(0x4a4236),
		rough: 0.95,
		draw: (u, v, n) => {
			const a = foot(u, v, n, 0.5, 0.4) * (0.45 + 0.4 * n(u * 9, v * 9));
			return { a, tone: n(u * 14, v * 14), h: 0, cavity: 0.5 };
		}
	},
	moss: {
		dark: rgb(0x29411a),
		light: rgb(0x6f8f38),
		rough: 0.85,
		draw: (u, v, n) => {
			const patch = n(u * 6, v * 6) + (0.45 - v) * 0.9;
			const a = smooth(0.48, 0.6, patch) * smooth(0.95, 0.7, v) * sides(u);
			const tuft = n(u * 28, v * 28, 2);
			return { a, tone: tuft, h: a * tuft * 0.05, cavity: 0.3 };
		}
	},
	damp: {
		dark: rgb(0x191816),
		light: rgb(0x2c2a26),
		rough: 0.3,
		draw: (u, v, n) => {
			// A wet band with streaks running down from it.
			const streak = smooth(0.6, 0.8, n(u * 9, v * 1.5, 2)) * smooth(0.7, 0.2, v) * sides(u);
			const a = Math.max(foot(u, v, n, 0.35, 0.25), streak) * 0.75;
			return { a, tone: n(u * 10, v * 10), h: 0, cavity: 0.2 };
		}
	},
	soot: {
		dark: rgb(0x0c0a09),
		light: rgb(0x1f1b17),
		rough: 0.95,
		draw: (u, v, n) => {
			// A plume, narrow at the fire and spreading as it rises.
			const across = Math.abs(u - 0.5 + (n(v * 3, 1.3) - 0.5) * 0.15) / (0.1 + 0.32 * v);
			const a =
				smooth(1, 0.45, across) *
				smooth(0.98, 0.45, v) *
				smooth(0, 0.12, v) *
				(0.5 + 0.5 * n(u * 7, v * 7));
			return { a, tone: n(u * 12, v * 12), h: 0, cavity: 0 };
		}
	},
	scorch: {
		dark: rgb(0x0e0c0a),
		light: rgb(0x3d2c1d),
		rough: 0.95,
		draw: (u, v, n) => {
			const r = Math.hypot(u - 0.5, v - 0.5) * 2;
			const edge = 0.72 + (n(u * 6, v * 6) - 0.5) * 0.35;
			const a = smooth(edge, edge - 0.35, r) * (0.65 + 0.35 * n(u * 16, v * 16));
			return { a, tone: smooth(0.1, 0.9, r), h: 0, cavity: 0.3 };
		}
	},
	cracks: {
		dark: rgb(0x13110e),
		light: rgb(0x2a251f),
		rough: 0.9,
		draw: (u, v, n) => {
			// Contours of noise: thin, branching, wandering lines.
			const line = (k: number) => smooth(0.014, 0.004, Math.abs(n(u * 2.5 + k, v * 2.5, 3) - 0.5));
			const a = Math.max(line(0), line(41) * 0.8) * smooth(0.48, 0.3, Math.hypot(u - 0.5, v - 0.5));
			return { a, tone: n(u * 20, v * 20), h: -a * 0.03, cavity: a };
		}
	},
	leaves: {
		dark: rgb(0x5a3a1c),
		light: rgb(0xa8762e),
		rough: 0.7,
		draw: () => none // drawn leaf by leaf (`leafLitter`)
	},
	blood: {
		dark: rgb(0x2e0b0a),
		light: rgb(0x4f1513),
		rough: 0.45,
		draw: () => none // a splash and its drops (`splatter`)
	}
};

/** Fallen leaves: pointed ellipses at random places and turns, each its own colour. */
function leafLitter(u: number, v: number, seed: number, n: Noise): Texel {
	const rand = random(seed);
	let best = none;
	for (let k = 0; k < 22; k++) {
		const [cx, cy, turn] = [0.18 + rand() * 0.64, 0.18 + rand() * 0.64, rand() * Math.PI];
		const [len, tone] = [0.05 + rand() * 0.05, rand()];
		const [dx, dy] = [u - cx, v - cy];
		const x = (dx * Math.cos(turn) + dy * Math.sin(turn)) / len;
		const y = (-dx * Math.sin(turn) + dy * Math.cos(turn)) / (len * 0.45 * (1 - x * x * 0.4));
		const d = x * x + y * y;
		if (d < 1) best = { a: smooth(1, 0.7, d), tone, h: (1 - d) * 0.04, cavity: 0.2 };
	}
	return { ...best, tone: best.tone * 0.8 + n(u * 30, v * 30, 2) * 0.2 };
}

/** A splash: a ragged blob and its drops about it. */
function splatter(u: number, v: number, seed: number, n: Noise): Texel {
	const r = Math.hypot(u - 0.5, v - 0.5);
	const edge = 0.16 + n(Math.atan2(v - 0.5, u - 0.5) * 1.6 + 4, 0.5, 3) * 0.14;
	const a = Math.max(smooth(edge, edge * 0.8, r), drops(u, v, random(seed), 26, 0.3));
	return { a: a * 0.92, tone: n(u * 9, v * 9), h: a * 0.012, cavity: 0 };
}

/** A small seeded random source (mulberry32), as textures.ts's. */
function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), s | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** How steep relief reads in the normal map, per cell of the decal. */
const RELIEF = 3;

/** The atlas's `output`, `size` a side, RGBA rows from the top. */
export function renderDecals(size: number, output: DecalOutput, seed: number): Uint8Array {
	const cell = size / DECAL_ACROSS;
	const out = new Uint8Array(size * size * 4);
	const texels: Texel[] = new Array(size * size);
	DECAL_KEYS.forEach((key, k) => {
		for (let variant = 0; variant < DECAL_VARIANTS; variant++) {
			const c = k * DECAL_VARIANTS + variant;
			const [x0, y0] = [
				(c % DECAL_ACROSS) * cell,
				(DECAL_ACROSS - 1 - Math.floor(c / DECAL_ACROSS)) * cell
			];
			const s = seed * 131 + c * 7919;
			const n = noiseOf(s);
			const look = LOOKS[key];
			for (let y = 0; y < cell; y++)
				for (let x = 0; x < cell; x++) {
					const [u, v] = [(x + 0.5) / cell, 1 - (y + 0.5) / cell];
					const t =
						key === 'leaves'
							? leafLitter(u, v, s, n)
							: key === 'blood'
								? splatter(u, v, s, n)
								: look.draw(u, v, n);
					// Faded out a few texels inside the cell, so neither filtering nor mips bleed.
					const rim = smooth(0.02, 0.07, Math.min(u, 1 - u, v, 1 - v));
					texels[(y0 + y) * size + x0 + x] = { ...t, a: t.a * rim };
				}
		}
	});
	const keyOf = (i: number) => {
		const c =
			Math.floor((i % size) / cell) +
			(DECAL_ACROSS - 1 - Math.floor(Math.floor(i / size) / cell)) * DECAL_ACROSS;
		return DECAL_KEYS[Math.floor(c / DECAL_VARIANTS)];
	};
	// Alpha in 32 levels and tone in 8: the PNG's deflate keeps the atlas small.
	const byte = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 255);
	for (let i = 0; i < size * size; i++) {
		const t = texels[i];
		const look = LOOKS[keyOf(i)];
		const a = Math.round(t.a * 31) / 31;
		if (output === 'albedo') {
			const tone = a > 0 ? Math.round(t.tone * 7) / 7 : 0.5;
			const c = look.dark.map((d, j) => Math.round(d + (look.light[j] - d) * tone));
			out.set([...c, byte(a)], i * 4);
		} else if (output === 'mask') out.set([byte(look.rough), byte(t.cavity * a), 0, 255], i * 4);
		else {
			const h = (dx: number, dy: number) => {
				const j = i + dy * size + dx;
				return j >= 0 && j < texels.length ? texels[j].h * texels[j].a : 0;
			};
			// Central differences, in cells of the decal; image rows run down, tangent y up.
			const [gx, gy] = [(h(1, 0) - h(-1, 0)) * cell * 0.5, (h(0, -1) - h(0, 1)) * cell * 0.5];
			const [nx, ny, nz] = [-gx * RELIEF, -gy * RELIEF, 1];
			const len = Math.hypot(nx, ny, nz);
			out.set([nx, ny, nz].map((q) => byte((q / len) * 0.5 + 0.5)).concat(255), i * 4);
		}
	}
	return out;
}
