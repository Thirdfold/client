// Lava's rendered light (#297, docs/RENDERING.md "Lava as light"): the rules light every lava
// cell to `LAVA_LIGHT_RADIUS`, which would be one GridLight each; instead each 3x3 block of the
// grid with lava in it is one `glow`-kind light at the block's centre, listed (`buildLists`'
// `cuts`) only on the cells its own lava cells light by the rules, so the rendered light never
// leaves `litMask` (the contract of #226). Pure (no three.js), tested in lava-glow.spec.ts.

import { LAVA, type FloorMap } from '$lib/game/floor';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import { LAVA_LIGHT_RADIUS, lavaSources, type LightSource } from '$lib/game/lights';
import type { Blockers } from '$lib/game/objects';
import {
	addVision,
	emptyMask,
	type CellMask,
	type SightCache,
	type VisionAdder
} from '$lib/game/visibility';
import { GLOW_ID } from './grid-lights';

/** Cells along a block's side. */
export const GLOW_BLOCK = 3;
/**
 * A block light's radius: far enough that its window (reach 4.5) covers every cell a block's lava
 * lights, from the block's centre (a block's lava is within √2 of it, its light √6). Not a whole
 * number, so a glow's sight can never be taken for a real light's (see `glowLights`).
 */
export const GLOW_RADIUS = LAVA_LIGHT_RADIUS + GLOW_BLOCK - 0.5;
/** One block's light and the lava cells it stands for. */
export interface LavaGlow {
	source: LightSource;
	cells: GridPos[];
}

/**
 * A `glow` light per block of lava, in block order (row by row): at the block's centre cell (the
 * last cell of a block the map's edge cuts short), the lava's colour, a steady glow.
 */
export function lavaGlows(grid: SquareGrid, floor: FloorMap | null): LavaGlow[] {
	if (!floor || floor.length !== grid.width * grid.height || !floor.includes(LAVA)) return [];
	const colour = lavaSources(grid, floor)[0].color;
	const blocks = new Map<number, GridPos[]>();
	const across = Math.ceil(grid.width / GLOW_BLOCK);
	for (let i = 0; i < floor.length; i++) {
		if (floor[i] !== LAVA) continue;
		const cell = { x: i % grid.width, y: Math.floor(i / grid.width) };
		const key = Math.floor(cell.y / GLOW_BLOCK) * across + Math.floor(cell.x / GLOW_BLOCK);
		const block = blocks.get(key);
		if (block) block.push(cell);
		else blocks.set(key, [cell]);
	}
	return [...blocks]
		.sort(([a], [b]) => a - b)
		.map(([key, cells]) => {
			const bx = key % across;
			const by = Math.floor(key / across);
			const pos = {
				x: Math.min(grid.width - 1, bx * GLOW_BLOCK + 1),
				y: Math.min(grid.height - 1, by * GLOW_BLOCK + 1)
			};
			const id = `${GLOW_ID}${bx},${by}`;
			return {
				source: { id, pos, radius: GLOW_RADIUS, color: colour, kind: 'glow', intensity: 0.8 },
				cells
			};
		});
}

/**
 * The cells a glow may light: those its own lava cells light by the rules (`lavaSources`' radius,
 * walls and doors blocking), so a union over glows is within `litMask` of every lava source.
 */
export function glowCut(
	grid: SquareGrid,
	blocked: Blockers,
	glow: LavaGlow,
	add: VisionAdder = addVision
): CellMask {
	const mask = emptyMask(grid);
	for (const cell of glow.cells) add(grid, blocked, cell, LAVA_LIGHT_RADIUS, mask);
	return mask;
}

/** The cuts kept between updates (their masks are the rows' keys), while the obstacles stay. */
export interface GlowCuts {
	signature: string;
	masks: Map<string, CellMask>;
}

/** What `GridLighting` adds for lava: the glows as lights, the sights that cut them, their slots. */
export interface Glows {
	lit: { id: string; source: LightSource; carrier: null }[];
	/** `base`, but a glow's sight (its position and radius) is its cut. */
	cache: SightCache;
	/**
	 * Lists each glow among `shown`'s entries from `first` on, on its cut's cells, in the first
	 * free slot of each cell's list (`k` slots a cell): after every light, displacing none.
	 */
	fill(grid: SquareGrid, lists: Uint8Array, k: number, first: number, shown: Shown): void;
}
type Shown = readonly { source: LightSource }[];

/** The glows for `floor`'s lava; `memo` is the lights' (`GridLighting`'s) between calls. */
export function glowLights(
	grid: SquareGrid,
	blocked: Blockers,
	base: SightCache,
	floor: FloorMap,
	memo: GlowCuts
): Glows {
	if (memo.signature !== base.signature)
		Object.assign(memo, { signature: base.signature, masks: new Map() });
	const cuts = new Map<string, CellMask>();
	const glows = lavaGlows(grid, floor).map((glow) => {
		const { id, pos, radius } = glow.source;
		const key = `${id}|${glow.cells.map((c) => `${c.x},${c.y}`).join(' ')}`;
		let cut = memo.masks.get(key);
		if (!cut) memo.masks.set(key, (cut = glowCut(grid, blocked, glow)));
		cuts.set(`${pos.x},${pos.y},${radius}`, cut);
		return { id: id ?? '', source: glow.source, carrier: null };
	});
	// A prototype's `sight`, overridden for a glow's key: a real light's radius is a whole number.
	const cache = Object.create(base) as SightCache;
	cache.sight = (g, pos, radius) =>
		cuts.get(`${pos.x},${pos.y},${radius}`) ?? base.sight(g, pos, radius);
	return {
		lit: glows,
		cache,
		fill(g, lists, k, first, shown) {
			for (let j = first; j < shown.length; j++) {
				const { pos, radius } = shown[j].source;
				const cut = cache.sight(g, pos, radius);
				const r = Math.floor(radius);
				for (let y = Math.max(0, pos.y - r); y <= Math.min(g.height - 1, pos.y + r); y++)
					for (let x = Math.max(0, pos.x - r); x <= Math.min(g.width - 1, pos.x + r); x++) {
						const c = y * g.width + x;
						if (!cut[c]) continue;
						const slot = lists.subarray(c * k, c * k + k).indexOf(0);
						if (slot >= 0) lists[c * k + slot] = j + 1;
					}
			}
		}
	};
}
