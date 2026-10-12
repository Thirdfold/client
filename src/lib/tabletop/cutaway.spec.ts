import { describe, expect, it } from 'vitest';
import { CUTAWAY, cutawayOf, readWalls, wallTop, type WallSpot } from './cutaway';
import { WALL_HEIGHT } from './ground';

// A room 6 cells deep round the focus at (0, 0), the camera to its south (+z), low.
const cam = { x: 0, z: 9 };
const focus = { x: 0, z: 0 };
const cs = 1;
const full = WALL_HEIGHT * cs;
const stub = full * CUTAWAY.stub;
const front: WallSpot = { x: 0, z: 3, axis: 0, base: 0 };
const back: WallSpot = { x: 0, z: -3, axis: 0, base: 0 };
const side: WallSpot = { x: 3, z: 0, axis: 1, base: 0 };

describe('the wall cutaway', () => {
	it('lowers a wall between the camera and the focus to the stub', () => {
		expect(cutawayOf(front, cam, focus, 'cutaway', cs)).toBe(1);
		expect(wallTop(front, cam, focus, 'cutaway', cs)).toBeCloseTo(stub);
	});

	it('keeps the back wall and a side wall up', () => {
		expect(wallTop(back, cam, focus, 'cutaway', cs)).toBe(full);
		expect(wallTop(side, cam, focus, 'cutaway', cs)).toBe(full);
	});

	it('keeps a front wall up when it is far beside the line to the focus', () => {
		const aside = { ...front, x: 6 };
		expect(wallTop(aside, cam, focus, 'cutaway', cs)).toBe(full);
	});

	it('eases as the camera turns, with no pop', () => {
		const tops = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((x) =>
			wallTop(front, cam, { x, z: 0 }, 'cutaway', cs)
		);
		for (let i = 1; i < tops.length; i++) expect(Math.abs(tops[i] - tops[i - 1])).toBeLessThan(0.6);
		expect(tops[0]).toBeCloseTo(stub);
	});

	it('stands on its floor, and scales with the cell', () => {
		const high = { ...front, z: 6, base: 2 };
		expect(wallTop(high, { x: 0, z: 18 }, focus, 'cutaway', 2)).toBeCloseTo(
			2 + full * 2 * CUTAWAY.stub
		);
	});

	it('follows the setting', () => {
		expect(wallTop(front, cam, focus, 'up', cs)).toBe(full);
		expect(wallTop(back, cam, focus, 'down', cs)).toBeCloseTo(stub);
		expect(readWalls('down')).toEqual({ walls: 'down' });
		expect(readWalls('sideways')).toEqual({});
	});
});
