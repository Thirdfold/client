import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { edgeKey, findPath, unitEdges } from '$lib/game/objects';
import { walkPlan } from './walk-plan';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 8 };
const at = (x: number, y: number) => ({ x, y });
const base = { grid, blocked: new Set<string>(), explored: null, movesLeft: null };

describe('walkPlan (#286)', () => {
	it('is as long as the server’s walk, from the start to the hovered cell', () => {
		const plan = walkPlan({ ...base, from: at(1, 1), to: at(6, 4) })!;
		const found = findPath(grid, base.blocked, at(1, 1), (c) => c.x === 6 && c.y === 4)!;
		expect(plan.cells).toHaveLength(found.length + 1);
		expect(plan.cells[0]).toEqual(at(1, 1));
		expect(plan.cells.at(-1)).toEqual(at(6, 4));
	});

	it('counts steps outside a fight, and steps against the movement left in one', () => {
		const outside = walkPlan({ ...base, from: at(0, 0), to: at(3, 0) })!;
		expect([outside.within, outside.label]).toEqual([3, '3 steps']);
		expect(walkPlan({ ...base, from: at(0, 0), to: at(1, 0) })!.label).toBe('1 step');
		const fight = walkPlan({ ...base, from: at(0, 0), to: at(5, 0), movesLeft: 3 })!;
		expect([fight.within, fight.label]).toEqual([3, '5 / 3']);
		expect(walkPlan({ ...base, from: at(0, 0), to: at(2, 0), movesLeft: 0 })!.within).toBe(0);
	});

	it('is null on its own cell, off the grid, or with no way through', () => {
		expect(walkPlan({ ...base, from: at(2, 2), to: at(2, 2) })).toBeNull();
		expect(walkPlan({ ...base, from: at(2, 2), to: at(40, 2) })).toBeNull();
		// A wall right across the table.
		const wall = new Set(unitEdges(at(5, 0), at(5, grid.height)).map(edgeKey));
		expect(walkPlan({ ...base, blocked: wall, from: at(1, 1), to: at(9, 1) })).toBeNull();
	});

	it('never routes over, or ends on, unexplored cells', () => {
		const explored = new Uint8Array(grid.width * grid.height);
		for (let y = 0; y < grid.height; y++)
			for (let x = 0; x <= 6; x++) explored[y * grid.width + x] = 1;
		expect(walkPlan({ ...base, explored, from: at(1, 1), to: at(9, 1) })).toBeNull();
		const plan = walkPlan({ ...base, explored, from: at(1, 1), to: at(6, 3) })!;
		for (const c of plan.cells) expect(explored[c.y * grid.width + c.x]).toBe(1);
	});
});
