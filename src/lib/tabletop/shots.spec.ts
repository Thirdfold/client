import { describe, expect, it } from 'vitest';
import {
	FRAMES,
	OUTWARD_TURN,
	OVERVIEW,
	SHOT_MS,
	SHOT_TOTAL,
	shotAt,
	shotFocus,
	shotPose,
	type Pose
} from './shots';

const home: Pose = { position: { x: 0, y: 20, z: 10 }, target: { x: 0, y: 0, z: 0 } };
const focus = { x: 5, y: 0, z: -4 };
const dist = (p: Pose) =>
	Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);

const floor = { x: 5, y: 0.8, z: -4 };
const flat = (p: Pose) => ({ x: p.position.x - p.target.x, z: p.position.z - p.target.z });
const bearing = (p: Pose) => Math.atan2(flat(p).z, flat(p).x);

describe('a cinematic shot', () => {
	it('looks at its focus, lifted by its frame, from the same side the viewer looked from', () => {
		const close = shotPose(home, focus, 'close', 30, 1);
		expect(close.target).toEqual({ ...focus, y: focus.y + FRAMES.close.lift });
		// The viewer looked from +z; the shot still does.
		expect(close.position.z).toBeGreaterThan(focus.z);
		expect(close.position.y).toBeGreaterThan(close.target.y);
	});

	it('scales its distance and lift with the cell, and stands on the floor it was given', () => {
		const a = shotPose(home, floor, 'close', 30, 1);
		const b = shotPose(home, floor, 'close', 60, 2);
		expect(b.target.y - floor.y).toBeCloseTo(2 * (a.target.y - floor.y));
		expect(dist(b)).toBeCloseTo(2 * dist(a));
		expect(a.target.y).toBeCloseTo(floor.y + FRAMES.close.lift);
	});

	it('frames close nearer than wide, and wide aimed higher at a lower angle (the horizon)', () => {
		const close = shotPose(home, focus, 'close', 30, 1);
		const wide = shotPose(home, focus, 'wide', 30, 1);
		const table = shotPose(home, focus, 'table', 30, 1);
		expect(dist(close)).toBeLessThan(dist(wide));
		expect(dist(wide)).toBeLessThan(dist(table));
		expect(FRAMES.wide.lift).toBeGreaterThan(FRAMES.close.lift);
		expect(FRAMES.wide.elevation).toBeLessThan(FRAMES.close.elevation);
		// Within a few degrees of level: the sky comes into the frame.
		const [dx, dy] = [Math.hypot(flat(wide).x, flat(wide).z), wide.position.y - wide.target.y];
		expect(Math.atan2(dy, dx)).toBeLessThan(0.15);
		expect(table.target).toEqual({ x: 0, y: OVERVIEW.lift, z: 0 });
		expect(dist(table)).toBeGreaterThan(30);
	});

	it('turns toward the table-side view of a focus near its edge, by at most OUTWARD_TURN', () => {
		const edge = { x: -10, y: 0, z: -10 };
		// Viewer from +z (a quarter turn off the table-side view): the shot is exactly table-side.
		const near = shotPose(home, edge, 'wide', 30, 1);
		expect(bearing(near)).toBeCloseTo(Math.atan2(10, 10));
		// A viewer on the far side (-z... the opposite way): turned, but never more than the cap.
		const away: Pose = { position: { x: -9, y: 20, z: -20 }, target: { x: -9, y: 0, z: -10 } };
		const turned = shotPose(away, edge, 'wide', 30, 1);
		const have = Math.atan2(-10, 0);
		const diff = Math.abs(
			Math.atan2(Math.sin(bearing(turned) - have), Math.cos(bearing(turned) - have))
		);
		expect(diff).toBeCloseTo(OUTWARD_TURN);
		// A focus in the middle keeps the viewer's own direction.
		const middle = shotPose(home, { x: 0.5, y: 0, z: 0.5 }, 'close', 30, 1);
		expect(middle.position.x).toBeCloseTo(0.5 + flat(middle).x);
		expect(flat(middle).x).toBeCloseTo(0);
	});

	it("poses 'overview' exactly like 'table'", () => {
		expect(shotPose(home, focus, 'overview', 30, 1)).toEqual(shotPose(home, focus, 'table', 30, 1));
	});

	it('copes with a camera looking straight down', () => {
		const overhead: Pose = { position: { x: 0, y: 30, z: 0 }, target: { x: 0, y: 0, z: 0 } };
		const pose = shotPose(overhead, focus, 'close', 30, 1);
		expect(Number.isFinite(pose.position.x + pose.position.y + pose.position.z)).toBe(true);
	});

	it('goes there, holds, and gives the camera back where it was', () => {
		const to = shotPose(home, focus, 'close', 30, 1);
		expect(shotAt(home, to, 0)).toEqual({ pose: home, done: false });
		const halfway = shotAt(home, to, SHOT_MS.go / 2).pose;
		expect(halfway.target.x).toBeGreaterThan(0);
		expect(halfway.target.x).toBeLessThan(focus.x);
		expect(shotAt(home, to, SHOT_MS.go + 10).pose).toEqual(to);
		expect(shotAt(home, to, SHOT_TOTAL)).toEqual({ pose: home, done: true });
		// A few seconds at most: a moment, not a cutscene.
		expect(SHOT_TOTAL).toBeLessThanOrEqual(6000);
	});
});

describe("a shot's depth of field", () => {
	it('eases in as the camera goes, holds, eases out as it comes back, and is 0 outside', () => {
		expect(shotFocus(-1)).toBe(0);
		expect(shotFocus(0)).toBe(0);
		expect(shotFocus(SHOT_MS.go / 2)).toBeCloseTo(0.5);
		expect(shotFocus(SHOT_MS.go)).toBe(1);
		expect(shotFocus(SHOT_MS.go + SHOT_MS.hold - 1)).toBe(1);
		expect(shotFocus(SHOT_MS.go + SHOT_MS.hold + SHOT_MS.back / 2)).toBeCloseTo(0.5);
		expect(shotFocus(SHOT_TOTAL)).toBe(0);
		for (let t = 0; t < SHOT_TOTAL; t += 50) {
			expect(shotFocus(t)).toBeGreaterThanOrEqual(0);
			expect(shotFocus(t)).toBeLessThanOrEqual(1);
		}
	});
});
