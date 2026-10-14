// Where heat haze hangs (#326): only over open fires, explored lava and the Heart.

import { describe, expect, it } from 'vitest';
import { FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { Fire } from './fire';
import { HAZE_MAX, LAVA_MAX, fireHeat, mergeHeat, terrainHeat } from './haze-plan';
import { worldShape } from './world/shape';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 10, height: 10 };
const fire = (kind: Fire['kind'], over: Partial<Fire> = {}): Fire => ({
	id: kind,
	kind,
	x: 1,
	y: 1,
	z: 2,
	profile: 0,
	phase: 0,
	carried: false,
	...over
});
const LAVA = FLOOR_IDS.indexOf('lava');

function shapeWith(lava: number[], known: Uint8Array | null = null) {
	const floor = new Uint8Array(100);
	for (const i of lava) floor[i] = LAVA;
	return worldShape({ grid, levels: null, floor, objects: [], known });
}

describe('fireHeat', () => {
	it('shimmers over braziers and floor fires, not torches, candles or a carried flame', () => {
		const hot = fireHeat([
			fire('brazier'),
			fire('fire'),
			fire('torch'),
			fire('candle'),
			fire('lantern'),
			fire('brazier', { carried: true })
		]);
		expect(hot).toHaveLength(2);
		expect(hot[0]).toMatchObject({ x: 1, z: 2 });
	});
});

describe('terrainHeat', () => {
	const at = { x: 0, z: 0 };

	it('hangs over lava, the cells nearest the target first, at most LAVA_MAX', () => {
		const every = Array.from({ length: 100 }, (_, i) => i);
		const heat = terrainHeat(grid, shapeWith(every), [], at);
		expect(heat).toHaveLength(LAVA_MAX);
		const d = (h: { x: number; z: number }) => h.x ** 2 + h.z ** 2;
		expect(Math.max(...heat.map(d))).toBeLessThan(25); // a disc round the target
	});

	it('never over lava the viewer has not explored', () => {
		const known = new Uint8Array(100);
		known[44] = 1;
		const heat = terrainHeat(grid, shapeWith([44, 45, 46], known), [], at);
		expect(heat).toHaveLength(1);
	});

	it('is deterministic', () => {
		const shape = shapeWith([11, 12, 21, 22, 55]);
		expect(terrainHeat(grid, shape, [], at)).toEqual(terrainHeat(grid, shape, [], at));
	});

	it('hangs over the Heart, in the middle of its footprint, and over nothing else', () => {
		const props = [
			{ assetId: 'heart' as const, pos: { x: 4, y: 4 }, rotation: 0 as const },
			{ assetId: 'barrel' as const, pos: { x: 1, y: 1 }, rotation: 0 as const }
		];
		const heat = terrainHeat(grid, shapeWith([]), props, at);
		expect(heat).toHaveLength(1);
		expect(heat[0].size).toBeGreaterThan(0);
	});
});

describe('mergeHeat', () => {
	it('holds at most HAZE_MAX, the earlier lists first', () => {
		const one = { x: 0, y: 0, z: 0, size: 1 };
		const many = Array.from({ length: HAZE_MAX + 5 }, () => ({ ...one, size: 2 }));
		const merged = mergeHeat([[one], many]);
		expect(merged).toHaveLength(HAZE_MAX);
		expect(merged[0].size).toBe(1);
	});
});
