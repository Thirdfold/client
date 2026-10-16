// pathFromSteps (#286) reads a walk back from stepsFrom's distances: as long as findPath's, every
// step allowed by canStep (levels and walls included), ending on the target.
import { describe, expect, it } from 'vitest';
import { canStep, findPath, stepsFrom } from '../../src/lib/game/objects';
import { pathFromSteps } from '../../src/lib/game/path-steps';
import { RoomManager } from '../rooms';
import { obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { hollowScene } from '../adventures/hollow-bell/hollow';
import { monasteryScene } from '../adventures/hollow-bell/monastery';

describe.each([
	['monastery', monasteryScene],
	['hollow', hollowScene]
])('pathFromSteps on the %s', (_name, scene) => {
	const rooms = new RoomManager();
	const created = rooms.create('Gia');
	if (!created.ok) throw new Error('no room');
	const room = created.room;
	applyScene(room, scene());
	const blocked = obstacles(room);
	const { width, height } = room.grid;
	const from = { x: Math.floor(width / 2), y: height - 3 };
	const steps = stepsFrom(room.grid, blocked, from, 1000);

	it('is as long as findPath and every step is allowed', () => {
		for (let y = 0; y < height; y += 2)
			for (let x = 0; x < width; x += 2) {
				const path = pathFromSteps(steps, room.grid, blocked, { x, y });
				const found = findPath(room.grid, blocked, from, (c) => c.x === x && c.y === y);
				expect(path?.length ?? null, `${x},${y}`).toBe(found ? found.length : null);
				if (!path?.length) continue;
				expect(path.at(-1)).toEqual({ x, y });
				let at = from;
				for (const cell of path) {
					expect(canStep(blocked, at, cell)).toBe(true);
					at = cell;
				}
			}
	});

	it('is empty at the start and null off the grid', () => {
		expect(pathFromSteps(steps, room.grid, blocked, from)).toEqual([]);
		expect(pathFromSteps(steps, room.grid, blocked, { x: -1, y: 0 })).toBeNull();
	});
});
