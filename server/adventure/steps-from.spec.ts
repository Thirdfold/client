// stepsFrom (#285) is findPath's step rule for every cell at once: checked on the monastery's and
// the Hollow's tables (heights, stairs, walls, doors) against the lengths findPath finds.
import { describe, expect, it } from 'vitest';
import { findPath, stepsFrom } from '../../src/lib/game/objects';
import { RoomManager } from '../rooms';
import { obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { hollowScene } from '../adventures/hollow-bell/hollow';
import { monasteryScene } from '../adventures/hollow-bell/monastery';

const tables = { monastery: monasteryScene, hollow: hollowScene };

describe.each(Object.entries(tables))('stepsFrom on the %s', (_name, scene) => {
	const rooms = new RoomManager();
	const created = rooms.create('Gia');
	if (!created.ok) throw new Error('no room');
	const room = created.room;
	applyScene(room, scene());
	const blocked = obstacles(room);
	const { width, height } = room.grid;
	const from = { x: Math.floor(width / 2), y: height - 3 };

	it('gives findPath’s length for every cell, and -1 where there is no way', () => {
		const steps = stepsFrom(room.grid, blocked, from, 1000);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const path = findPath(room.grid, blocked, from, (c) => c.x === x && c.y === y);
				expect(steps[y * width + x], `${x},${y}`).toBe(path ? path.length : -1);
			}
	});

	it('stops at max and honours passable', () => {
		const near = stepsFrom(room.grid, blocked, from, 3);
		expect(Math.max(...near)).toBeLessThanOrEqual(3);
		const walled = stepsFrom(room.grid, blocked, from, 1000, (c) => c.x !== from.x);
		const path = findPath(
			room.grid,
			blocked,
			from,
			(c) => c.x === 0 && c.y === 0,
			(c) => c.x !== from.x
		);
		expect(walled[0]).toBe(path ? path.length : -1);
	});
});
