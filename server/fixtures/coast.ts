// Ref 5 (milestone 73, #299): the daylight coast. A grass bank at level 1 above a sand beach at 0,
// a wadeable sea running south to the grid's edge with sandbars in it, rocks in the shallows and
// on the beach, and a mini wading. The sea is one body of water at the beach's level (#293), so
// it deepens in colour with distance from the shore, and the fogged player's explored edge
// crosses it (the "no foam line at the explored boundary" check). Deterministic, like the rest.

import type { GridPos } from '../../src/lib/game/grid';
import { prop } from '../adventure/tables';
import { build, grid, mini, sidecar, type Fixture, type FixtureSidecar } from './compositions';

const rect = (x0: number, y0: number, x1: number, y1: number) => ({
	from: { x: x0, y: y0 } as GridPos,
	to: { x: x1, y: y1 } as GridPos
});

export function ref5(): Fixture {
	const g = grid(24, 18);
	const hero = { ...mini('ref5-mini-hero', 'Warden', 12, 10, 'warden', 1), vision: 5 };
	const rocks: [number, number][] = [
		[5, 7],
		[18, 6],
		[10, 11],
		[14, 9],
		[20, 12],
		[7, 12]
	];
	const fixture = build(
		{
			name: 'Fixture: daylight coast',
			grid: g,
			environment: 'village',
			ambient: 'day',
			// 13:00, a clear sky, a light warm haze, the sea out to the horizon at the beach's level.
			world: {
				time: 780,
				sky: 'temperate',
				haze: { density: 0.2, color: '#f0e2c8' },
				backdrop: { kind: 'sea', level: 0 }
			},
			objects: [],
			props: [
				...rocks.map(([x, y], i) => prop(`ref5-rock-${i + 1}`, 'rock', x, y)),
				prop('ref5-tree-1', 'tree', 4, 1),
				prop('ref5-tree-2', 'tree', 19, 2)
			],
			lights: [],
			tokens: [hero],
			terrain: [{ ...rect(0, 0, 23, 3), level: 1 }],
			floors: [
				{ ...rect(0, 0, 23, 3), floor: 'grass' },
				{ ...rect(0, 4, 23, 8), floor: 'sand' },
				{ ...rect(0, 9, 23, 17), floor: 'water' },
				// A cove cut into the beach, a spit running out at each side, and sandbars.
				{ ...rect(7, 8, 15, 8), floor: 'water' },
				{ ...rect(0, 9, 3, 10), floor: 'sand' },
				{ ...rect(20, 9, 23, 9), floor: 'sand' },
				{ ...rect(5, 12, 9, 12), floor: 'sand' },
				{ ...rect(6, 13, 8, 13), floor: 'sand' },
				{ ...rect(15, 14, 19, 14), floor: 'sand' },
				{ ...rect(16, 15, 18, 15), floor: 'sand' },
				{ ...rect(2, 16, 4, 16), floor: 'sand' },
				{ ...rect(10, 17, 12, 17), floor: 'sand' }
			]
		},
		// The player has explored the beach and half the shallows (vision 5): the edge crosses water.
		sidecar(g, 'day', 'ref5-mini-hero', { x: 12, y: 10 }, [
			{ x: 8, y: 6 },
			{ x: 16, y: 6 },
			{ x: 12, y: 10 }
		])
	);
	// Looking south toward the sea (yaw 180 looks south from the bank).
	const side: FixtureSidecar = fixture.sidecar;
	const overview = {
		mode: 'overview' as const,
		pivot: { x: 12, y: 9 },
		distance: 38,
		yaw: 160,
		pitch: 55
	};
	side.poses.overview = overview;
	side.poses.close = { ...side.poses.close, yaw: 160, pitch: 28 };
	side.poses.low = {
		mode: 'eye',
		pivot: { x: 12, y: 8 },
		distance: 6,
		yaw: 180,
		pitch: 10
	};
	// The overview at 23:00 under the moon.
	side.poses.dark = { ...overview, ambient: 'dark' };
	return fixture;
}
