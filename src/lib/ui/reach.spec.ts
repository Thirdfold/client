import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { CHANNEL_COLOUR, CHANNELS, CHANNEL_DISTANCE } from '$lib/tabletop/cell-overlay';
import { oklabDistance, type Deficiency } from '$lib/tabletop/cvd';
import { FREE_REACH, overlayCells } from './reach';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 30, height: 20 };
const at = (x: number, y: number) => ({ x, y });
type Cells = NonNullable<ReturnType<typeof overlayCells>>;
const texel = (o: Cells, x: number, y: number, ch: number) => o.data[(y * o.width + x) * 4 + ch];
const base = { grid, blocked: new Set<string>(), explored: null };

describe('overlayCells', () => {
	it('is null when there is nothing to show', () => {
		expect(overlayCells(base)).toBeNull();
		expect(overlayCells({ ...base, walkFrom: at(5, 5), movesLeft: 0 })).toBeNull();
	});

	it('marks the walk within the movement left, not the start', () => {
		const o = overlayCells({ ...base, walkFrom: at(10, 10), movesLeft: 3 })!;
		expect(texel(o, 13, 10, 0)).toBe(255);
		expect(texel(o, 14, 10, 0)).toBe(0);
		expect(texel(o, 10, 10, 0)).toBe(0);
	});

	it('previews a capped walk outside a fight', () => {
		const o = overlayCells({ ...base, walkFrom: at(0, 0) })!;
		expect(texel(o, FREE_REACH, 0, 0)).toBe(255);
		expect(texel(o, FREE_REACH + 1, 0, 0)).toBe(0);
	});

	it('marks the aimed action’s range, and none for a self action', () => {
		const aimFrom = at(10, 10);
		const o = overlayCells({ ...base, aimFrom, aim: { range: 3, target: 'enemy' } })!;
		expect(texel(o, 13, 10, 1)).toBe(255);
		expect(texel(o, 14, 10, 1)).toBe(0);
		expect(overlayCells({ ...base, aimFrom, aim: { range: 3, target: 'self' } })).toBeNull();
	});

	it('shows nothing on unexplored cells in any channel, and never routes through them', () => {
		const explored = new Uint8Array(grid.width * grid.height);
		for (let y = 0; y < grid.height; y++)
			for (let x = 5; x <= 12; x++) explored[y * grid.width + x] = 1;
		const o = overlayCells({
			...base,
			explored,
			walkFrom: at(10, 10),
			movesLeft: 20,
			aimFrom: at(10, 10),
			aim: { range: 8, target: 'enemy' },
			path: [at(10, 10), at(20, 10)],
			area: [at(4, 4), at(8, 8)]
		})!;
		for (let i = 0; i < grid.width * grid.height; i++)
			if (!explored[i]) for (let ch = 0; ch < 4; ch++) expect(o.data[i * 4 + ch]).toBe(0);
		expect(texel(o, 8, 8, 3)).toBe(255);
		expect(texel(o, 12, 10, 0)).toBe(255);
		expect(texel(o, 20, 10, 2)).toBe(0);
	});
});

describe('the channel colours', () => {
	it('keep reach and range apart plain and under each dichromacy', () => {
		for (const kind of [null, 'protanopia', 'deuteranopia', 'tritanopia'] as (Deficiency | null)[])
			expect(
				oklabDistance(CHANNEL_COLOUR.reach, CHANNEL_COLOUR.range, kind),
				String(kind)
			).toBeGreaterThanOrEqual(CHANNEL_DISTANCE);
	});

	it('has a colour for every channel', () => {
		for (const c of CHANNELS) expect(CHANNEL_COLOUR[c]).toBeGreaterThan(0);
	});
});
