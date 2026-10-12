import { describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '../game/grid';
import { blockingEdges, type SceneObject } from '../game/objects';
import { decodeLevels } from '../game/terrain';
import { MONASTERY_IDS, monasteryScene } from '../../../server/adventures/hollow-bell/monastery';
import { hollowScene } from '../../../server/adventures/hollow-bell/hollow';
import { groundFor } from './ground';
import { GROUND_CLEARANCE } from './world-ground';
import { Arm, ARM_MIN, armDistance, springArm } from './spring-arm';

type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const at = (grid: SquareGrid, x: number, y: number, h: number): V => ({
	...gridToWorld(grid, { x, y }),
	y: h
});
/** The point `d` along the line from `from` toward `to`. */
const along = (from: V, to: V, d: number): V => {
	const k = d / dist(from, to);
	return {
		x: from.x + (to.x - from.x) * k,
		y: from.y + (to.y - from.y) * k,
		z: from.z + (to.z - from.z) * k
	};
};

function table(scene: ReturnType<typeof monasteryScene>) {
	const { grid } = scene;
	const levels = scene.terrain ? decodeLevels(scene.terrain, grid.width * grid.height) : null;
	return { grid, ground: groundFor(grid, levels), objects: scene.objects as SceneObject[] };
}

const monastery = table(monasteryScene());
const none = new Set<string>();

describe('the spring arm (#290)', () => {
	it('leaves a clear line as long as it is, less the margin', () => {
		const { grid, ground } = monastery;
		const pivot = at(grid, 15, 14, 1.2);
		const camera = at(grid, 15, 19, 3);
		expect(springArm(ground, none, grid, pivot, camera, 0.3)).toBeCloseTo(dist(pivot, camera));
	});

	it('stops at a wall between the courtyard and the nave, and passes over its top', () => {
		const { grid, ground, objects } = monastery;
		const edges = blockingEdges(objects);
		const pivot = at(grid, 7, 12, 1.2); // the courtyard, south of the nave's wall (x 6-9, y 10)
		const behind = at(grid, 7, 7, 1.6); // inside, below the wall's top
		const over = at(grid, 7, 7, 4);
		const free = springArm(ground, edges, grid, pivot, behind, 0.3);
		expect(free).toBeGreaterThan(0);
		expect(free).toBeLessThan(dist(pivot, behind) / 2); // the wall is just over half way
		expect(springArm(ground, edges, grid, pivot, over, 0.3)).toBeCloseTo(dist(pivot, over));
		// The viewer knowing no walls: nothing to bump into, nothing revealed.
		expect(springArm(ground, none, grid, pivot, behind, 0.3)).toBeCloseTo(dist(pivot, behind));
	});

	it('is stopped by a shut door and a window, not by an open door', () => {
		const { grid, ground, objects } = monastery;
		const pivot = at(grid, 13, 12, 1.2); // south of the great doors (x 13, y 10)
		const behind = at(grid, 13, 7, 1.5);
		const full = dist(pivot, behind);
		const door = (open: boolean) =>
			blockingEdges(objects.map((o) => (o.id === MONASTERY_IDS.greatDoor ? { ...o, open } : o)));
		expect(springArm(ground, door(false), grid, pivot, behind, 0.3)).toBeLessThan(full - 0.5);
		expect(springArm(ground, door(true), grid, pivot, behind, 0.3)).toBeCloseTo(full);
		// A window (x 5, y 10) is a sill gap the camera must not slip through either.
		const w = at(grid, 5, 12, 1.2);
		const inside = at(grid, 5, 7, 1.5);
		expect(springArm(ground, blockingEdges(objects), grid, w, inside, 0.3)).toBeLessThan(
			dist(w, inside) - 0.5
		);
	});

	it('stops at the bell tower below its belfry, and clears it from above', () => {
		const { grid, ground } = monastery;
		const edges = none; // the arches in the way are walls, tested above
		const pivot = at(grid, 26, 8, 1.2); // the courtyard south of the tower; the belfry is level 10
		const through = at(grid, 26, 3, 2);
		expect(springArm(ground, edges, grid, pivot, through, 0.3)).toBeLessThan(
			dist(pivot, through) - 1
		);
		const above = at(grid, 26, 3, 8);
		expect(springArm(ground, edges, grid, pivot, above, 0.3)).toBeCloseTo(dist(pivot, above));
	});

	it('stops at a terrace edge in the Hollow', () => {
		const { grid, ground } = table(hollowScene());
		let found = 0;
		for (let y = 0; y < grid.height && found < 3; y++)
			for (let x = 0; x < grid.width - 4; x++) {
				const [lo, hi] = [ground.level({ x, y }), ground.level({ x: x + 1, y })];
				if (hi < lo + 2) continue;
				const floor = ground.floorY({ x, y });
				const pivot = at(grid, x, y, floor + 0.4);
				const camera = at(grid, x + 3, y, floor + 0.8);
				expect(springArm(ground, none, grid, pivot, camera, GROUND_CLEARANCE)).toBeLessThan(1);
				found++;
			}
		expect(found).toBeGreaterThan(0);
	});

	it('is not stopped by flat ground beside a pivot standing on the floor', () => {
		const { grid, ground } = table(hollowScene());
		const pivot = at(grid, 24, 32, ground.floorY({ x: 24, y: 32 }));
		const camera = { ...pivot, x: pivot.x + 3, y: pivot.y + 3 };
		expect(springArm(ground, none, grid, pivot, camera, 0.3)).toBeCloseTo(dist(pivot, camera));
	});

	it('copes with a camera at the pivot and one far beyond the grid', () => {
		const { grid, ground } = monastery;
		const p = at(grid, 1, 1, 1);
		expect(springArm(ground, none, grid, p, p, 0.3)).toBe(0);
		expect(springArm(ground, none, grid, p, { x: -100, y: 3, z: -100 }, 0.3)).toBeGreaterThan(0);
	});
});

describe('the arm easing', () => {
	it('shortens at once and eases back out, in about a quarter of a second', () => {
		expect(armDistance(10, 4, 10, 1, 16.67, false)).toBe(4);
		let d = 4;
		let ms = 0;
		while (d < 9.7 && ms < 2000) {
			d = armDistance(10, 20, d, 1, 16.67, false);
			ms += 16.67;
		}
		expect(ms).toBeGreaterThan(100); // 95% of the way
		expect(ms).toBeLessThan(350);
		expect(armDistance(10, 20, 4, 1, 16.67, true)).toBe(10);
		expect(armDistance(10, 0.1, 10, 2, 16.67, false)).toBe(2); // never under the minimum
	});

	it('remembers what the viewer wanted, and rests once the way is clear', () => {
		const { grid, ground, objects } = monastery;
		const arm = new Arm();
		const pivot = at(grid, 7, 12, 1.2);
		const out = at(grid, 7, 7, 1.6);
		const wanted = dist(pivot, out);
		const d1 = arm.step(ground, objects, grid, pivot, out, 0.3, 16.67, false);
		expect(d1).toBeLessThan(wanted - 1);
		expect(d1).toBeGreaterThanOrEqual(ARM_MIN);
		// The camera now sits at d1 and the wall is still there: it stays, and rests.
		let cam = along(pivot, out, d1);
		expect(arm.step(ground, objects, grid, pivot, cam, 0.3, 16.67, false)).toBeCloseTo(d1);
		expect(arm.easing).toBe(false);
		// The wall goes: it eases back out to what the viewer wanted, then rests.
		let steps = 0;
		do {
			const d = arm.step(ground, [], grid, pivot, cam, 0.3, 16.67, false);
			cam = along(pivot, cam, d);
			steps++;
		} while (arm.easing && steps < 200);
		expect(arm.easing).toBe(false);
		expect(dist(pivot, cam)).toBeCloseTo(wanted, 1);
		expect(steps).toBeGreaterThan(1);
	});
});
