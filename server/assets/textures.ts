// Textures made from recipes: small, seamlessly tiling images (earth,
// flagstones, planks, rock) generated from a seed, so the same source
// always builds the same PNG. An author can also provide a PNG instead.
// `paint` is data, not colour (#178): the painted-miniature detail props and minis sample in
// object space, as a tangent-space normal map or a greyscale gloss map. `ripple` is data too
// (#293): the water's swells as a tangent-space normal map, their height in alpha. The shared
// noise, flow, ramp and leaf textures (#301: perlin, worley, curl, ramp, leaves) are noise.ts's.

import { USAGE_SPACE, type TextureUsage } from '../../src/lib/assets/manifest';
import { DECAL_OUTPUTS, renderDecals, type DecalOutput } from './decal-art';
import { curl, leaves, perlin, ramp, worley } from './noise';

export const RECIPES = [
	'noise',
	'flagstones',
	'planks',
	'paint',
	'ripple',
	'perlin',
	'worley',
	'curl',
	'ramp',
	'leaves',
	'decals'
] as const;
export type Recipe = (typeof RECIPES)[number];
export const PAINT_OUTPUTS = ['normal', 'gloss'] as const;
export type PaintOutput = (typeof PAINT_OUTPUTS)[number];
export const LEAF_OUTPUTS = ['albedo', 'normal'] as const;
export type LeafOutput = (typeof LEAF_OUTPUTS)[number];

/**
 * Recipes drawn at their own size, never BASE_PX and with no 1K or 2K: data that sharpening
 * wouldn't improve (the ripples, #293, and #301's noises, ramp and leaves).
 */
export const OWN_SIZE: readonly Recipe[] = [
	'ripple',
	'perlin',
	'worley',
	'curl',
	'ramp',
	'leaves',
	'decals' // #307's atlas: small, so its download stays within a table's budget
];
/** Recipes that are data, never colour: their usage must be linear. */
const DATA: readonly Recipe[] = ['paint', 'ripple', 'perlin', 'worley', 'curl'];
/** How many colour stops each recipe takes. */
const COLOURS: Record<Recipe, [number, number]> = {
	noise: [2, 2],
	flagstones: [3, 3],
	planks: [3, 3],
	paint: [0, 0],
	ripple: [0, 0],
	perlin: [0, 0],
	worley: [0, 0],
	curl: [0, 0],
	ramp: [2, 8],
	leaves: [2, 2],
	decals: [0, 0]
};

export interface TextureSource {
	recipe: Recipe;
	/** Width and height in pixels: a power of two, 16 to 512 (a ramp's width; `height` its rows). */
	size: number;
	/** A ramp's rows, 1 to 16. */
	height?: number;
	/**
	 * `#rrggbb`: the base colours; flagstones and planks take a third for the joints; a ramp its 2
	 * to 8 stops, leaves dark and light; the data recipes (paint, ripple, perlin, worley, curl) none.
	 */
	colors: string[];
	seed: number;
	/** How many noise cells across the image (coarser for fewer); leaves: sprigs across. */
	scale?: number;
	/** Perlin and curl: fBm octaves, 1 to 5, each twice as fine as the last. */
	octaves?: number;
	/**
	 * Paint: a normal map or a gloss map; leaves: the albedo with alpha, or its normal map; decals
	 * (#307): the atlas's albedo, normal map or mask.
	 */
	output?: PaintOutput | LeafOutput | DecalOutput;
}

/** A recipe's pixels: its own size (`OWN_SIZE`), else BASE_PX `base` a side. */
export function recipeSize(source: TextureSource, base: number): [number, number] {
	if (!OWN_SIZE.includes(source.recipe)) return [base, base];
	return [source.size, source.height ?? source.size];
}

const COLOR = /^#[0-9a-f]{6}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function readTextureSource(raw: unknown): TextureSource {
	if (!isRecord(raw)) throw new Error('not an object');
	const recipe = RECIPES.find((r) => r === raw.recipe);
	if (!recipe) throw new Error(`recipe must be one of ${RECIPES.join(', ')}`);
	// A ramp is a strip: `width` by `height` (1 to 16 rows).
	const size = recipe === 'ramp' ? raw.width : raw.size;
	if (typeof size !== 'number' || size < 16 || size > 512 || (size & (size - 1)) !== 0) {
		throw new Error(
			`${recipe === 'ramp' ? 'width' : 'size'} must be a power of two from 16 to 512`
		);
	}
	const height = recipe === 'ramp' ? raw.height : undefined;
	if (
		recipe === 'ramp' &&
		!(Number.isInteger(height) && (height as number) >= 1 && (height as number) <= 16)
	)
		throw new Error('a ramp`s height is 1 to 16 rows');
	const usage = (raw.usage ?? 'albedo') as TextureUsage;
	const [least, most] = COLOURS[recipe];
	const colors = most === 0 ? (raw.colors ?? []) : raw.colors;
	if (
		!Array.isArray(colors) ||
		colors.length < least ||
		colors.length > most ||
		!colors.every((c) => typeof c === 'string' && COLOR.test(c))
	) {
		throw new Error(`needs ${least === most ? least : `${least} to ${most}`} colours`);
	}
	if (typeof raw.seed !== 'number' || !Number.isInteger(raw.seed))
		throw new Error('needs an integer seed');
	const scale = raw.scale ?? 8;
	if (typeof scale !== 'number' || scale < 1 || scale > 64 || !Number.isInteger(scale)) {
		throw new Error('scale must be 1 to 64');
	}
	const source: TextureSource = { recipe, size, colors: colors as string[], seed: raw.seed, scale };
	if (height !== undefined) source.height = height as number;
	if (recipe === 'perlin' || recipe === 'curl') {
		const octaves = raw.octaves ?? 4;
		if (!Number.isInteger(octaves) || (octaves as number) < 1 || (octaves as number) > 5)
			throw new Error('octaves must be 1 to 5');
		source.octaves = octaves as number;
	}
	if (recipe === 'paint' || recipe === 'leaves') {
		const outputs: readonly string[] = recipe === 'paint' ? PAINT_OUTPUTS : LEAF_OUTPUTS;
		const output = outputs.find((o) => o === raw.output) as TextureSource['output'];
		if (!output) throw new Error(`${recipe} needs an output: ${outputs.join(' or ')}`);
		if (recipe === 'leaves' && (output === 'normal') !== (usage === 'normal'))
			throw new Error('leaves` normal map is of usage normal, its albedo of usage albedo');
		source.output = output;
	}
	if (recipe === 'decals') {
		const output = DECAL_OUTPUTS.find((o) => o === raw.output);
		const want = { albedo: 'albedo', normal: 'normal', mask: 'orm' } as const;
		if (!output || want[output] !== usage)
			throw new Error('decals need an output: albedo (usage albedo), normal or mask (usage orm)');
		source.output = output;
	}
	if (DATA.includes(recipe) && USAGE_SPACE[usage] !== 'linear')
		throw new Error(`${recipe} is data: its usage must be linear (mask, height, normal or orm)`);
	return source;
}

function rgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A small seeded random source (mulberry32). */
export function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Tiling value noise in 0..1: `cells` random values across, smoothly interpolated, wrapping. */
function noise(size: number, cells: number, rand: () => number): Float32Array {
	const grid = Float32Array.from({ length: cells * cells }, rand);
	const out = new Float32Array(size * size);
	const smooth = (t: number) => t * t * (3 - 2 * t);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const gx = (x / size) * cells;
			const gy = (y / size) * cells;
			const x0 = Math.floor(gx);
			const y0 = Math.floor(gy);
			const tx = smooth(gx - x0);
			const ty = smooth(gy - y0);
			const at = (i: number, j: number) => grid[(j % cells) * cells + (i % cells)];
			const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
			const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
			out[y * size + x] = top * (1 - ty) + bottom * ty;
		}
	}
	return out;
}

/** Two octaves of noise, for surfaces that aren't flat colour. */
function grain(size: number, scale: number, rand: () => number): Float32Array {
	const coarse = noise(size, scale, rand);
	const fine = noise(size, scale * 4, rand);
	return coarse.map((v, i) => v * 0.7 + fine[i] * 0.3);
}

/**
 * The RGBA pixels of a texture source, `px` a side (its `size` by default). The recipe is drawn
 * at `size` and only sharpens at a larger `px` (texture detail: the 512 base, 1K and 2K): its
 * noise cells, boards and stones stay where they are, and joints keep their width.
 */
export function renderTexture(source: TextureSource, px = source.size): Uint8Array {
	const { recipe } = source;
	if (recipe === 'decals')
		return renderDecals(source.size, source.output as DecalOutput, source.seed);
	if (OWN_SIZE.includes(recipe) && recipe !== 'ripple') return renderShared(source);
	const size = px;
	const k = px / source.size;
	const rand = random(source.seed);
	const [a, b, joint] = source.colors.map(rgb);
	const out = new Uint8Array(size * size * 4);
	const put = (i: number, c: readonly number[], shade = 1) => {
		out[i * 4] = Math.round(Math.min(255, c[0] * shade));
		out[i * 4 + 1] = Math.round(Math.min(255, c[1] * shade));
		out[i * 4 + 2] = Math.round(Math.min(255, c[2] * shade));
		out[i * 4 + 3] = 255;
	};
	const mix = (t: number) => [0, 1, 2].map((k) => a[k] * (1 - t) + b[k] * t);
	const g = grain(size, source.scale ?? 8, rand);
	if (recipe === 'paint') {
		paint(size, source.scale ?? 8, g, source.output as PaintOutput, put);
		return out;
	}
	if (recipe === 'ripple') {
		// Smooth swells in two octaves; the height rides in alpha for the foam's cut.
		const scale = source.scale ?? 8;
		const fine = noise(size, scale * 2, rand);
		const swell = noise(size, scale, rand).map((v, i) => v * 0.7 + fine[i] * 0.3);
		normals(size, scale, swell, RIPPLE_RELIEF, put);
		for (let i = 0; i < size * size; i++) out[i * 4 + 3] = Math.round(swell[i] * 255);
		return out;
	}
	if (recipe === 'noise') {
		for (let i = 0; i < size * size; i++) put(i, mix(g[i]));
		return out;
	}
	if (recipe === 'planks') {
		// Boards running along y, each its own shade, with a dark gap between.
		const boards = 4;
		const width = size / boards;
		const tone = Array.from({ length: boards }, () => 0.85 + rand() * 0.3);
		const lines = noise(size, 16, rand);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const i = y * size + x;
				const board = Math.floor(x / width);
				if (x % width < 2 * k) put(i, joint);
				else
					put(i, mix(lines[((y * 7) % size) * size + (x % size)] * 0.6 + g[i] * 0.4), tone[board]);
			}
		}
		return out;
	}
	// Flagstones: irregular stones on a staggered grid, mortar between, each stone its own shade.
	const rows = 4;
	const h = size / rows;
	const w = size / 3;
	const shades = Array.from({ length: rows * 4 }, () => 0.8 + rand() * 0.35);
	for (let y = 0; y < size; y++) {
		const row = Math.floor(y / h);
		const offset = row % 2 ? w / 2 : 0;
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const sx = (x + offset) % size;
			const col = Math.floor(sx / w);
			const edge = Math.min(sx % w, w - (sx % w), y % h, h - (y % h));
			// The mortar line wanders a little with the grain.
			if (edge < (1.5 + g[i] * 2) * k) put(i, joint);
			else put(i, mix(g[i]), shades[row * 4 + col]);
		}
	}
	return out;
}

/** How steep the paint's bumps are: a slope of 1 per noise cell tilts the normal this far. */
const PAINT_RELIEF = 0.35;
/** How steep the water's swells are: gentle, the graph scales them again by the shore. */
const RIPPLE_RELIEF = 0.6;

/**
 * Paint detail (#178). Gloss is the grain as grey (0.5 leaves roughness as it is). A normal map
 * is the grain as a height field turned into tangent-space RGB (+y up the image, as three reads
 * it) by a Sobel filter whose neighbours wrap, so the map tiles like the height does.
 */
function paint(
	size: number,
	scale: number,
	height: Float32Array,
	output: PaintOutput | undefined,
	put: (i: number, c: readonly number[]) => void
): void {
	if (output === 'gloss') {
		for (let i = 0; i < size * size; i++) put(i, [0, 0, 0].fill(height[i] * 255));
		return;
	}
	normals(size, scale, height, PAINT_RELIEF, put);
}

/**
 * A height field as a tangent-space normal map (+y up the image, as three reads it), by a Sobel
 * filter whose neighbours wrap, so the map tiles like the height does; `relief` per noise cell.
 */
function normals(
	size: number,
	scale: number,
	height: Float32Array,
	relief: number,
	put: (i: number, c: readonly number[]) => void
): void {
	const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
	// Sobel sums 8 neighbour differences over 2 pixels; per noise cell, as the relief is.
	const perCell = (size / scale / 8) * relief;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx =
				h(x + 1, y - 1) +
				2 * h(x + 1, y) +
				h(x + 1, y + 1) -
				(h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
			const dy =
				h(x - 1, y + 1) +
				2 * h(x, y + 1) +
				h(x + 1, y + 1) -
				(h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
			// Image rows run down, tangent space's y up: a height rising down the image tilts +y.
			const [nx, ny, nz] = [-dx * perCell, dy * perCell, 1];
			const length = Math.hypot(nx, ny, nz);
			put(
				y * size + x,
				[nx, ny, nz].map((n) => ((n / length) * 0.5 + 0.5) * 255)
			);
		}
	}
}

/** #301's recipes, at their own size (`recipeSize`): noise as grey, curl in RG, a ramp, leaves. */
function renderShared(source: TextureSource): Uint8Array {
	const { recipe, size } = source;
	const rows = source.height ?? size;
	const scale = source.scale ?? 8;
	const rand = random(source.seed);
	const out = new Uint8Array(size * rows * 4).fill(255);
	const byte = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
	if (recipe === 'perlin' || recipe === 'worley') {
		const n =
			recipe === 'perlin'
				? perlin(size, scale, source.octaves ?? 4, rand)
				: worley(size, scale, rand);
		for (let i = 0; i < n.length; i++) out.fill(byte(n[i]), i * 4, i * 4 + 3);
		return out;
	}
	if (recipe === 'curl') {
		const flow = curl(size, scale, source.octaves ?? 4, rand);
		for (let i = 0; i < size * size; i++) {
			out.set([byte(flow[i * 2]), byte(flow[i * 2 + 1]), 128], i * 4);
		}
		return out;
	}
	if (recipe === 'ramp') {
		const strip = ramp(size, source.colors.map(rgb));
		for (let y = 0; y < rows; y++)
			for (let x = 0; x < size; x++) out.set(strip[x].map(Math.round), (y * size + x) * 4);
		return out;
	}
	// Leaves: their albedo with coverage in alpha, or their normal map (flat outside the leaves).
	const { cover, tone, height } = leaves(size, scale, rand);
	if (source.output === 'normal') {
		normals(size, size / 8, height, LEAF_RELIEF, (i, c) => out.set(c.map(Math.round), i * 4));
		return out;
	}
	const [dark, light] = source.colors.map(rgb);
	for (let i = 0; i < size * size; i++) {
		const c = [0, 1, 2].map((k) => Math.round(dark[k] + (light[k] - dark[k]) * tone[i]));
		// Outside a leaf the nearest leaf colour would bleed less in mips; dark is close enough.
		out.set([...(cover[i] ? c : dark), cover[i] ? 255 : 0], i * 4);
	}
	return out;
}

/** How steep a leaf's dome reads in its normal map. */
const LEAF_RELIEF = 0.5;
