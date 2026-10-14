// The shared noise, flow, ramp and leaf textures (#301) that vegetation, fire and water read:
// generated from a seed by the recipe step (textures.ts), never downloaded, so the same source
// always builds the same PNG. Every noise here is periodic on its own lattice, so it tiles:
// `perlin` (gradient noise in fBm octaves), `worley` (F1 cellular), `curl` (the curl of a perlin
// potential, a divergence-free flow in RG about 0.5), `ramp` (a strip from colour stops) and
// `leaves` (an atlas of stylised leaves with alpha, and their height for a normal map).
// `coverageMips` is the alpha-tested leaves' mip chain that keeps their coverage.

/** A periodic gradient-noise octave: `period` lattice cells across `size` pixels, -1..1-ish. */
function gradientOctave(size: number, period: number, rand: () => number): Float32Array {
	const angles = Float32Array.from({ length: period * period }, () => rand() * 2 * Math.PI);
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const out = new Float32Array(size * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const [gx, gy] = [(x / size) * period, (y / size) * period];
			const [x0, y0] = [Math.floor(gx), Math.floor(gy)];
			const [fx, fy] = [gx - x0, gy - y0];
			const dot = (i: number, j: number) => {
				const a = angles[((y0 + j) % period) * period + ((x0 + i) % period)];
				return Math.cos(a) * (fx - i) + Math.sin(a) * (fy - j);
			};
			const [u, v] = [fade(fx), fade(fy)];
			const top = dot(0, 0) + (dot(1, 0) - dot(0, 0)) * u;
			const bottom = dot(0, 1) + (dot(1, 1) - dot(0, 1)) * u;
			out[y * size + x] = top + (bottom - top) * v;
		}
	}
	return out;
}

/** Stretched to fill 0..1. */
function normalised(values: Float32Array): Float32Array {
	let [lo, hi] = [Infinity, -Infinity];
	for (const v of values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
	return values.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5));
}

/** Tiling perlin noise in 0..1: `cells` lattice cells across, `octaves` (1-5) each twice as fine. */
export function perlin(size: number, cells: number, octaves: number, rand: () => number) {
	const sum = new Float32Array(size * size);
	for (let o = 0, amp = 1; o < octaves; o++, amp /= 2) {
		const octave = gradientOctave(size, Math.min(cells << o, size), rand);
		for (let i = 0; i < sum.length; i++) sum[i] += octave[i] * amp;
	}
	return normalised(sum);
}

/** Tiling F1 cellular noise in 0..1: the distance to the nearest of one point per cell. */
export function worley(size: number, cells: number, rand: () => number): Float32Array {
	const points = Float32Array.from({ length: cells * cells * 2 }, rand);
	const out = new Float32Array(size * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const [gx, gy] = [(x / size) * cells, (y / size) * cells];
			const [cx, cy] = [Math.floor(gx), Math.floor(gy)];
			let nearest = Infinity;
			for (let j = -1; j <= 1; j++) {
				for (let i = -1; i <= 1; i++) {
					// The neighbour's point, from its cell wrapped round the tile.
					const k = (((cy + j + cells) % cells) * cells + ((cx + i + cells) % cells)) * 2;
					const d = Math.hypot(cx + i + points[k] - gx, cy + j + points[k + 1] - gy);
					nearest = Math.min(nearest, d);
				}
			}
			out[y * size + x] = nearest;
		}
	}
	return normalised(out);
}

/**
 * The curl of a perlin potential ψ as (∂ψ/∂y, -∂ψ/∂x) by central differences that wrap: its
 * discrete divergence is exactly 0 (the differences commute), so whatever it carries never
 * bunches up. Scaled into 0..1 about 0.5, the largest component reaching the edge.
 */
export function curl(size: number, cells: number, octaves: number, rand: () => number) {
	const psi = perlin(size, cells, octaves, rand);
	const at = (x: number, y: number) => psi[((y + size) % size) * size + ((x + size) % size)];
	const flow = new Float32Array(size * size * 2);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			flow[(y * size + x) * 2] = (at(x, y + 1) - at(x, y - 1)) / 2;
			flow[(y * size + x) * 2 + 1] = -(at(x + 1, y) - at(x - 1, y)) / 2;
		}
	}
	const most = flow.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
	return flow.map((v) => 0.5 + (0.5 * v) / most);
}

/** A strip `width` across, rows alike: the colour stops spread evenly, blended in between. */
export function ramp(width: number, stops: readonly (readonly number[])[]): number[][] {
	return Array.from({ length: width }, (_, x) => {
		const t = (x / (width - 1)) * (stops.length - 1);
		const i = Math.min(Math.floor(t), stops.length - 2);
		return [0, 1, 2].map((c) => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * (t - i));
	});
}

/** One leaf of the atlas: where it lies, its turn, size and tone. */
interface Leaf {
	x: number;
	y: number;
	angle: number;
	length: number;
	width: number;
	tone: number;
}

/**
 * The leaf atlas: `cells` x `cells` sprigs, each a few pointed leaves round the cell's centre,
 * kept inside their cell so no mip bleeds one into the next. Per pixel: coverage (0 or 1), a 0-1
 * tone along the leaf (darker at the midrib and the stem) and a height (domed, grooved midrib).
 */
export function leaves(size: number, cells: number, rand: () => number) {
	const cover = new Uint8Array(size * size);
	const tone = new Float32Array(size * size);
	const height = new Float32Array(size * size);
	const cell = size / cells;
	for (let cy = 0; cy < cells; cy++) {
		for (let cx = 0; cx < cells; cx++) {
			// A rosette: each leaf from the cell's centre out, its tip at most 0.44 of a cell away.
			const count = 5 + Math.floor(rand() * 3);
			const sprig: Leaf[] = Array.from({ length: count }, (_, k) => {
				const angle = ((k + rand() * 0.4) / count) * 2 * Math.PI;
				const length = cell * (0.18 + rand() * 0.04);
				return {
					x: (cx + 0.5) * cell + Math.cos(angle) * length,
					y: (cy + 0.5) * cell + Math.sin(angle) * length,
					angle,
					length,
					width: length * (0.32 + rand() * 0.1),
					tone: rand()
				};
			});
			for (const [n, leaf] of sprig.entries()) paintLeaf(leaf, n, size, cover, tone, height);
		}
	}
	return { cover, tone, height };
}

/** Lays one leaf over what is there (later leaves on top, a little higher). */
function paintLeaf(
	leaf: Leaf,
	layer: number,
	size: number,
	cover: Uint8Array,
	tone: Float32Array,
	height: Float32Array
): void {
	const [c, s] = [Math.cos(leaf.angle), Math.sin(leaf.angle)];
	const r = Math.ceil(leaf.length);
	for (let y = Math.floor(leaf.y - r); y <= leaf.y + r; y++) {
		for (let x = Math.floor(leaf.x - r); x <= leaf.x + r; x++) {
			if (x < 0 || y < 0 || x >= size || y >= size) continue;
			// Along the leaf (-1 stem, 1 tip) and across it, from the pixel's centre.
			const [dx, dy] = [x + 0.5 - leaf.x, y + 0.5 - leaf.y];
			const u = (dx * c + dy * s) / leaf.length;
			const v = (dy * c - dx * s) / leaf.width;
			const half = Math.pow(Math.max(1 - u * u, 0), 0.8);
			if (Math.abs(u) >= 1 || Math.abs(v) >= half) continue;
			const across = Math.abs(v) / half;
			const i = y * size + x;
			cover[i] = 1;
			tone[i] = Math.min(Math.max(0.3 + 0.35 * (u + 1) * 0.5 + 0.35 * leaf.tone, 0), 1);
			tone[i] *= across < 0.08 ? 0.75 : 1; // the midrib
			height[i] = 0.2 + 0.05 * layer + 0.5 * (1 - across * across) - (across < 0.08 ? 0.1 : 0);
		}
	}
}

/** One level of a mip chain: its side and RGBA pixels. */
export interface MipLevel {
	size: number;
	rgba: Uint8Array;
}

/** The share of a level's texels whose alpha is at least `cutoff` (0-255). */
export function coverageOf(rgba: Uint8Array, cutoff: number): number {
	let covered = 0;
	for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= cutoff) covered++;
	return covered / (rgba.length / 4);
}

/**
 * Coverage-preserving mips for alpha-tested leaves (Castaño 2010): each level box-filtered from
 * the one above, then its alpha scaled so as many texels pass `cutoff` (0-255) as at level 0, so
 * a canopy doesn't thin out into the distance. Level 0 is `rgba` itself; the last is 1x1.
 * ponytail: a level's alpha scale is searched (bisection), fine for the 256 px atlas.
 */
export function coverageMips(rgba: Uint8Array, size: number, cutoff: number): MipLevel[] {
	const levels: MipLevel[] = [{ size, rgba }];
	const target = coverageOf(rgba, cutoff);
	while (levels[levels.length - 1].size > 1) {
		const above = levels[levels.length - 1];
		const side = above.size / 2;
		const box = new Float32Array(side * side * 4);
		for (let y = 0; y < side; y++)
			for (let x = 0; x < side; x++)
				for (let c = 0; c < 4; c++) {
					const at = (i: number, j: number) =>
						above.rgba[((y * 2 + j) * above.size + x * 2 + i) * 4 + c];
					box[(y * side + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
				}
		const scaled = (k: number) =>
			Uint8Array.from(box, (v, i) => Math.round(i % 4 === 3 ? Math.min(v * k, 255) : v));
		let [lo, hi] = [0, 64];
		for (let step = 0; step < 24; step++) {
			const mid = (lo + hi) / 2;
			if (coverageOf(scaled(mid), cutoff) < target) lo = mid;
			else hi = mid;
		}
		// The scale whose coverage lands nearer level 0's.
		const [a, b] = [scaled(lo), scaled(hi)];
		const nearer =
			Math.abs(coverageOf(a, cutoff) - target) <= Math.abs(coverageOf(b, cutoff) - target) ? a : b;
		levels.push({ size: side, rgba: nearer });
	}
	return levels;
}
