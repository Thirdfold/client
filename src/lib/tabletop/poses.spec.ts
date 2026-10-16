import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { decodeLevels } from '../game/terrain';
import { WALL_LEVELS } from '../game/visibility';
import { committedFixtures } from '../../../server/fixtures/build';
import {
	CLEARANCE_CELLS,
	minCameraY,
	pitchForDistance,
	poseOf,
	rigOf,
	TILT,
	type RigPose
} from './camera-rig';
import { CAMERA_MODES } from './camera-modes';
import { eyeLift } from './camera-track';
import { groundFor, STEP_HEIGHT } from './ground';
import { placePose, rigPoseFor, type RigGridPose } from './poses';
import type { Pose } from './shots';
import { worldExtents } from './world-ground';

const DEG = Math.PI / 180;
const grid: SquareGrid = { kind: 'square', cellSize: 2, width: 4, height: 4 };

const offset = (pose: Pose) => ({
	dx: pose.position.x - pose.target.x,
	dy: pose.position.y - pose.target.y,
	dz: pose.position.z - pose.target.z
});

describe('a named pose in the legacy form', () => {
	it('stands as given: at its cell, from the given distance, direction and height', () => {
		const legacy = { target: { x: 1, y: 1 }, distance: 5, azimuth: 0, elevation: 30 };
		const [pose, rig] = placePose(grid, null, legacy);
		expect(rig).toBeUndefined();
		expect(pose.target).toEqual({ x: -1, y: 0, z: -1 });
		const { dx, dy, dz } = offset(pose);
		expect(Math.hypot(dx, dy, dz)).toBeCloseTo(10);
		expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo(30 * DEG);
		// Azimuth 0 is from the south, looking north.
		expect(dx).toBeCloseTo(0);
		expect(dz).toBeGreaterThan(0);
		const [east] = placePose(grid, null, { ...legacy, azimuth: 90 });
		expect(east.position.x).toBeGreaterThan(east.target.x);
		// Read through the rig's terms: the same numbers.
		const r = rigOf(pose);
		expect(r.yaw).toBeCloseTo(0);
		expect(r.pitch).toBeCloseTo(30 * DEG);
	});

	it('looks at the floor of a raised cell', () => {
		const levels = new Uint8Array(16);
		levels[1 * 4 + 1] = 3;
		const legacy = { target: { x: 1, y: 1 }, distance: 5, azimuth: 0, elevation: 30 };
		const [pose] = placePose(grid, groundFor(grid, levels), legacy);
		expect(pose.target.y).toBeCloseTo(3 * STEP_HEIGHT * 2);
	});
});

describe('a named pose in the rig form', () => {
	const levels = new Uint8Array(16);
	levels[1 * 4 + 1] = 3;
	const ground = groundFor(grid, levels);
	const base: RigGridPose = { mode: 'explore', pivot: { x: 1, y: 1 }, distance: 7, yaw: 90 };

	it("stands at its view's curve, its pivot on the floor, the yaw as the rig's", () => {
		const [pose, rig] = placePose(grid, ground, base);
		expect(rig).toEqual({ view: 'explore', storeys: 0, tilt: 0 });
		expect(pose.target.y).toBeCloseTo(3 * STEP_HEIGHT * 2);
		const r = rigOf(pose);
		expect(r.distance).toBeCloseTo(14);
		expect(r.pitch).toBeCloseTo(pitchForDistance(7, 'explore'));
		expect(r.yaw).toBeCloseTo(90 * DEG);
		expect(pose.position.x).toBeGreaterThan(pose.target.x); // from the east
	});

	it('keeps a pitch off the curve as a tilt, at most the tilt band', () => {
		const curve = pitchForDistance(7, 'explore') / DEG;
		const [, tilted] = placePose(grid, ground, { ...base, pitch: curve - 4 });
		expect(tilted!.tilt).toBeCloseTo(-4 * DEG);
		const { rig, tilt } = rigPoseFor(grid, ground, { ...base, pitch: 80 });
		expect(tilt).toBeCloseTo(TILT);
		expect(rig.pitch).toBeCloseTo(curve * DEG + TILT);
	});

	it('raises the pivot by storeys, and to the eye at eye level', () => {
		const floor = 3 * STEP_HEIGHT * 2;
		const raised = rigPoseFor(grid, ground, { ...base, storeys: 1 }).rig;
		expect(raised.pivot.y).toBeCloseTo(floor + WALL_LEVELS * STEP_HEIGHT * 2);
		const eye = placePose(grid, ground, { ...base, mode: 'eye', distance: 4 });
		expect(eye[0].target.y).toBeCloseTo(floor + eyeLift(2));
		expect(eye[1]?.view).toBe('eye');
	});
});

const near = (a: RigPose, b: RigPose) => {
	for (const k of ['x', 'y', 'z'] as const) expect(a.pivot[k]).toBeCloseTo(b.pivot[k], 6);
	expect(a.distance).toBeCloseTo(b.distance, 6);
	expect(Math.cos(a.yaw - b.yaw)).toBeCloseTo(1, 9);
	expect(a.pitch).toBeCloseTo(b.pitch, 6);
};

describe("every fixture's named pose", () => {
	const fixtures = Object.entries(committedFixtures());

	it('is a rig pose', () => {
		expect(fixtures.length).toBeGreaterThan(0);
		for (const [name, { sidecar }] of fixtures)
			for (const pose of Object.values(sidecar.poses)) expect('mode' in pose, name).toBe(true);
	});

	for (const [name, { scene, sidecar }] of fixtures) {
		it(`${name}: resolves within the rig's bounds, clear of the ground, and round-trips`, () => {
			const g = scene.grid;
			const levels = scene.terrain ? decodeLevels(scene.terrain, g.width * g.height) : null;
			const ground = groundFor(g, levels);
			const far = worldExtents(g).play.maxDistance;
			for (const [which, pose] of Object.entries(sidecar.poses)) {
				const what = `${name} ${which}`;
				const { rig, tilt } = rigPoseFor(g, ground, pose);
				const [placed] = placePose(g, ground, pose);
				// Over the grid, within the view's reach.
				expect(pose.pivot.x, what).toBeGreaterThanOrEqual(0);
				expect(pose.pivot.y, what).toBeGreaterThanOrEqual(0);
				expect(pose.pivot.x, what).toBeLessThan(g.width);
				expect(pose.pivot.y, what).toBeLessThan(g.height);
				const { min, max } = CAMERA_MODES[pose.mode].distance;
				expect(pose.distance, what).toBeGreaterThanOrEqual(min);
				expect(pose.distance, what).toBeLessThanOrEqual(max ?? Infinity);
				expect(rig.distance, what).toBeLessThanOrEqual(far);
				// The pitch it asks for is in the view's band, so the rig keeps it as asked.
				expect(Math.abs(tilt), what).toBeLessThanOrEqual(TILT + 1e-9);
				if (pose.pitch !== undefined) expect(rig.pitch / DEG, what).toBeCloseTo(pose.pitch, 9);
				// Clear of the ground as the rig keeps a viewer's camera, so it is never lifted.
				const low = minCameraY(ground, g, placed.position, CLEARANCE_CELLS);
				expect(placed.position.y, what).toBeGreaterThanOrEqual(low);
				// Its rig terms and its camera are the same pose.
				near(rigOf(placed), rig);
				near(rigOf(poseOf(rigOf(placed))), rig);
			}
		});
	}

	it('frames the close references low on the minis and the wide ones from above', () => {
		const all = Object.fromEntries(fixtures);
		const pitch = (name: string, which: 'close' | 'overview') => {
			const { scene, sidecar } = all[name];
			return rigPoseFor(scene.grid, groundFor(scene.grid, null), sidecar.poses[which]).rig.pitch;
		};
		for (const name of ['ref-1', 'ref-6', 'ref-7']) {
			expect(all[name].sidecar.poses.close.mode, name).toBe('explore');
			expect(pitch(name, 'close') / DEG, name).toBeGreaterThanOrEqual(25);
			expect(pitch(name, 'close') / DEG, name).toBeLessThanOrEqual(35);
		}
		for (const name of ['monastery', 'ref-8']) {
			expect(all[name].sidecar.poses.overview.mode, name).toBe('overview');
			expect(pitch(name, 'overview') / DEG, name).toBeGreaterThanOrEqual(50);
			expect(pitch(name, 'overview') / DEG, name).toBeLessThanOrEqual(60);
		}
	});
});
