import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridPos } from '$lib/game/grid';
import { roomBoundary } from '$lib/game/rooms';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { autoCut, cutHeight, levelAt, stepCut, storeyOf } from './cut';
import { STEP_HEIGHT } from './ground';

function fixture(name: string) {
	const file = parseSceneFile(
		JSON.parse(readFileSync(`tests/fixtures/scenes/${name}.json`, 'utf8'))
	);
	if (!file.ok) throw new Error(`${name}: ${file.error}`);
	const { grid, objects, terrain } = file.scene;
	const levels = terrain ? decodeLevels(terrain, grid.width * grid.height) : null;
	const level = (c: GridPos) => levels?.[c.y * grid.width + c.x] ?? 0;
	const boundary = roomBoundary(objects);
	/** The auto cut with the pivot on `cell`'s floor raised `storeys`. */
	const cut = (cell: GridPos, storeys = 0, keep: number[] = []) =>
		autoCut({ grid, boundary, pivot: cell, pivotLevel: level(cell) + storeys * 5, keep });
	return { grid, level, cut };
}

describe('storeys', () => {
	it('are WALL_LEVELS levels', () => {
		expect([0, 4, 5, 9, 10, 40].map(storeyOf)).toEqual([0, 0, 1, 1, 2, 8]);
	});

	it('cut just under a floor, which caps the storey below', () => {
		expect(cutHeight(5, 1)).toBeCloseTo(5 * STEP_HEIGHT - 0.02);
		expect(cutHeight(5, 2)).toBeCloseTo(2 * cutHeight(5, 1));
		expect(levelAt(cutHeight(5, 1), 1)).toBe(5);
		expect(levelAt(10 * STEP_HEIGHT * 3, 3)).toBe(10);
	});

	it('step a locked cut a storey at a time, from none to the top and never to 0', () => {
		expect(stepCut(5, 1)).toBe(10);
		expect(stepCut(10, -1)).toBe(5);
		expect(stepCut(5, -1)).toBe(5);
		expect(stepCut(40, 1)).toBeNull();
		expect(stepCut(null, 1)).toBeNull();
		expect(stepCut(null, -1)).toBe(40);
	});
});

describe('the auto cut on the monastery', () => {
	const m = fixture('monastery');
	const nave = { x: 12, y: 5 };
	const gallery = { x: 20, y: 5 };

	it('sits a storey above the nave, hiding the gallery (5) and the belfry (10)', () => {
		expect(m.level(nave)).toBe(0);
		expect(m.level(gallery)).toBe(5);
		expect(m.cut(nave)).toBe(5);
	});

	it('follows the pivot up a storey to show the gallery, and up another for the belfry', () => {
		expect(m.cut(nave, 1)).toBe(10);
		expect(m.cut(nave, 2)).toBe(15);
		expect(m.cut(gallery)).toBe(10);
	});

	it("never hides the viewer's own minis", () => {
		expect(m.cut(nave, 0, [m.level(gallery)])).toBe(10);
		expect(m.cut(nave, 0, [0, 10])).toBe(15);
	});

	it('parks on open ground', () => {
		expect(m.cut({ x: 15, y: 15 })).toBeNull();
		expect(m.cut({ x: 26, y: 4 }, 2)).toBeNull(); // the belfry: open arches
	});
});

describe('the auto cut on the Hollow', () => {
	const h = fixture('hollow');
	const cells: Record<string, GridPos> = {
		landing: { x: 23, y: 32 },
		island: { x: 24, y: 10 },
		bell: { x: 23, y: 8 },
		lake: { x: 10, y: 4 },
		causeway: { x: 23, y: 24 },
		steps: { x: 41, y: 18 },
		watch: { x: 43, y: 8 },
		ruins: { x: 8, y: 28 }
	};

	it('never cuts it, from the shore, the island, the lake or the terraces', () => {
		for (const [name, cell] of Object.entries(cells))
			for (const storeys of [0, 1, 2]) expect(h.cut(cell, storeys), name).toBeNull();
	});
});
