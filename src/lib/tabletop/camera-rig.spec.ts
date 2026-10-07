import { describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '../game/grid';
import { decodeLevels } from '../game/terrain';
import { BELFRY, monasteryScene } from '../../../server/adventures/hollow-bell/monastery';
import { hollowScene, WATCH } from '../../../server/adventures/hollow-bell/hollow';
import {
	clampPivot,
	CLEARANCE_CELLS,
	DAMPING,
	dampingFor,
	framePose,
	minCameraY,
	panStep,
	parseSavedCamera,
	pitchForDistance,
	pivotBounds,
	pivotHeight,
	poseOf,
	restorePose,
	rigOf,
	savedCamera,
	snapAzimuth,
	steerPitch,
	TILT,
	type CameraHold,
	type FramedToken
} from './camera-rig';
import { groundFor, STEP_HEIGHT } from './ground';
import { GROUND_CLEARANCE } from './world-ground';

const DEG = Math.PI / 180;

function table(scene: ReturnType<typeof monasteryScene>) {
	const grid = scene.grid;
	const levels = scene.terrain ? decodeLevels(scene.terrain, grid.width * grid.height) : null;
	return { grid, ground: groundFor(grid, levels) };
}

/** A seeded generator, so a failing sweep fails the same way twice. */
function random(seed: number) {
	return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('the camera rig', () => {
	it('puts the pivot on the belfry floor at level 10, and storeys above it', () => {
		const { grid, ground } = table(monasteryScene());
		const cell = BELFRY.from;
		expect(ground.level(cell)).toBe(10);
		expect(pivotHeight(ground, cell, 0, grid.cellSize)).toBeCloseTo(10 * STEP_HEIGHT);
		expect(pivotHeight(ground, cell, 1, grid.cellSize)).toBeCloseTo(15 * STEP_HEIGHT);
		expect(pivotHeight(ground, cell, -2, grid.cellSize)).toBeCloseTo(0);
	});

	it('keeps the pivot over the play area and a margin, clamped at every corner', () => {
		const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 30, height: 20 };
		const bounds = pivotBounds({ width: 30, depth: 20, cellSize: 1 });
		for (const [sx, sz] of [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1]
		]) {
			const p = clampPivot(bounds, { x: sx * 1000, y: 2, z: sz * 1000 });
			expect(p).toEqual({ x: sx * 18, y: 2, z: sz * 13 });
		}
		const inside = gridToWorld(grid, { x: 3, y: 4 });
		expect(clampPivot(bounds, { ...inside, y: 0 })).toEqual({ ...inside, y: 0 });
	});

	it('never leaves the camera under minCameraY over the monastery or the Hollow', () => {
		const next = random(280);
		for (const scene of [monasteryScene(), hollowScene()]) {
			const { grid, ground } = table(scene);
			const beyond = () => 0.6;
			for (let i = 0; i < 2000; i++) {
				const pivot = {
					x: (next() - 0.5) * grid.width,
					y: next() * 4,
					z: (next() - 0.5) * grid.height
				};
				const r = { pivot, distance: 1 + next() * 40, yaw: next() * 7, pitch: next() * 1.5 };
				const p = poseOf(r).position;
				p.y = Math.max(p.y, minCameraY(ground, grid, p, CLEARANCE_CELLS, beyond));
				// Over its own cell and every neighbour, with the near plane's margin.
				const lowest = minCameraY(ground, grid, p, CLEARANCE_CELLS, beyond);
				expect(p.y).toBeGreaterThanOrEqual(lowest);
				expect(lowest).toBeGreaterThanOrEqual(GROUND_CLEARANCE);
			}
		}
	});

	it('keeps clear of the Hollow’s watch from beside it', () => {
		const { grid, ground } = table(hollowScene());
		const watch = gridToWorld(grid, WATCH.from);
		const beside = { x: watch.x - 1, z: watch.z };
		const y = minCameraY(ground, grid, beside, CLEARANCE_CELLS);
		expect(y).toBeGreaterThanOrEqual(ground.floorY(WATCH.from) + GROUND_CLEARANCE);
	});

	it('pitches up as it pulls back: 25-35 degrees close, 50-60 far in explore, higher in overview', () => {
		let last = 0;
		for (let d = 0; d <= 80; d += 0.5) {
			const p = pitchForDistance(d, 'explore');
			expect(p).toBeGreaterThanOrEqual(last);
			expect(pitchForDistance(d, 'overview')).toBeGreaterThan(p);
			last = p;
		}
		expect(pitchForDistance(6, 'explore') / DEG).toBeGreaterThanOrEqual(25);
		expect(pitchForDistance(8, 'explore') / DEG).toBeLessThanOrEqual(35);
		expect(pitchForDistance(40, 'explore') / DEG).toBeGreaterThanOrEqual(50);
		expect(pitchForDistance(80, 'explore') / DEG).toBeLessThanOrEqual(60);
	});

	it('keeps the viewer’s tilt through a zoom, and eases a stray pitch back into the band', () => {
		const base = pitchForDistance(10, 'explore');
		expect(steerPitch(base + 0.05, base, 0.05, false, 0.2).tilt).toBeCloseTo(0.05);
		const zoomed = pitchForDistance(30, 'explore');
		expect(steerPitch(base + 0.05, zoomed, 0.05, true, 0.2).pitch).toBeCloseTo(zoomed + 0.05);
		const stray = steerPitch(base + 0.6, base, 0, false, 0.5);
		expect(stray.pitch).toBeLessThan(base + 0.6);
		expect(stray.tilt).toBeLessThanOrEqual(TILT);
	});

	it('damps the same at 60 and 144 Hz: within 2% after 500 ms', () => {
		const settle = (hz: number) => {
			const dt = 1000 / hz;
			const f = dampingFor(dt, DAMPING);
			let [left, applied] = [1, 0];
			for (let t = 0; t + dt <= 500 + 1e-6; t += dt) {
				applied += left * f;
				left *= 1 - f;
			}
			return applied;
		};
		expect(dampingFor(16.67, DAMPING)).toBeCloseTo(DAMPING);
		expect(Math.abs(settle(60) - settle(144)) / settle(60)).toBeLessThan(0.02);
	});

	describe('frames a new table', () => {
		const { grid, ground } = table(monasteryScene());
		const tokens: FramedToken[] = [
			{ id: 'mine', pos: { x: 3, y: 15 }, ownerId: 'p1' },
			{ id: 'friend', pos: { x: 9, y: 15 }, ownerId: 'p2' },
			{ id: 'hound', pos: { x: 25, y: 4 }, ownerId: null }
		];
		const frame = 36;

		it('on a player’s own tokens, close and at 25-35 degrees', () => {
			const r = framePose(tokens, new Set(['mine']), grid, ground, 'explore', frame);
			const at = gridToWorld(grid, { x: 3, y: 15 });
			expect(r.pivot.x).toBeCloseTo(at.x);
			expect(r.pivot.z).toBeCloseTo(at.z);
			expect(r.pitch / DEG).toBeGreaterThanOrEqual(25);
			expect(r.pitch / DEG).toBeLessThanOrEqual(35);
		});

		it('on the party for the GM or a spectator (owned tokens they were sent), never an enemy', () => {
			const r = framePose(tokens, new Set(), grid, ground, 'explore', frame);
			expect(r.pivot.x).toBeCloseTo(
				(gridToWorld(grid, { x: 3, y: 15 }).x + gridToWorld(grid, { x: 9, y: 15 }).x) / 2
			);
			const far = framePose(tokens, new Set(), grid, ground, 'explore', frame).distance;
			const near = framePose(tokens, new Set(['mine']), grid, ground, 'explore', frame).distance;
			expect(far).toBeGreaterThan(near);
		});

		it('on the play area’s centre with nobody to frame, and in overview', () => {
			const enemies = tokens.filter((t) => t.ownerId === null);
			for (const r of [
				framePose(enemies, new Set(), grid, ground, 'explore', frame),
				framePose(tokens, new Set(['mine']), grid, ground, 'overview', frame)
			])
				expect(r.pivot).toEqual({ x: 0, y: 0, z: 0 });
		});
	});

	it('stores a pose in cells and gives it back, ignoring another grid size', () => {
		const { grid, ground } = table(monasteryScene());
		const at = gridToWorld(grid, { x: 5, y: 6 });
		const r = { pivot: { x: at.x, y: 0, z: at.z }, distance: 12, yaw: 0.7, pitch: 0.6 };
		const saved = JSON.parse(JSON.stringify(savedCamera(grid, r, 1, 0.1)));
		const back = parseSavedCamera(saved, grid)!;
		expect(back).toEqual({
			width: 30,
			height: 20,
			cell: { x: 5, y: 6 },
			storeys: 1,
			distance: 12,
			yaw: 0.7,
			tilt: 0.1
		});
		const pose = restorePose(back, grid, ground, 'explore');
		expect(pose.yaw).toBeCloseTo(0.7);
		expect(pose.pivot.y).toBeCloseTo(pivotHeight(ground, { x: 5, y: 6 }, 1));
		expect(parseSavedCamera(saved, { ...grid, width: 31 })).toBeNull();
		expect(parseSavedCamera({ ...saved, tilt: 9 }, grid)).toBeNull();
		expect(parseSavedCamera('nope', grid)).toBeNull();
		expect(rigOf(poseOf(r)).distance).toBeCloseTo(12);
	});
});

describe('camera keys (#279)', () => {
	const held = (...k: CameraHold[]) => new Set(k);
	const north = { x: 0, z: -1 };

	it('pans camera-relative, faster the farther out, the same on diagonals', () => {
		const f = panStep(held('pan_forward'), north, 20, 1000);
		expect(f.x).toBeCloseTo(0);
		expect(f.z).toBeCloseTo(-18);
		expect(panStep(held('pan_right'), north, 10, 1000).x).toBeCloseTo(9);
		const d = panStep(held('pan_forward', 'pan_right'), north, 10, 1000);
		expect(Math.hypot(d.x, d.z)).toBeCloseTo(9);
		expect(panStep(held('pan_forward'), north, 20, 500).z).toBeCloseTo(-9);
		expect(panStep(held('pan_left', 'pan_right'), north, 10, 16)).toEqual({ x: 0, z: 0 });
	});

	it('snaps to the next 45 degrees, from on or between them', () => {
		const s = Math.PI / 4;
		expect(snapAzimuth(0, 1)).toBeCloseTo(s);
		expect(snapAzimuth(0, -1)).toBeCloseTo(-s);
		expect(snapAzimuth(0.3, 1)).toBeCloseTo(s);
		expect(snapAzimuth(0.3, -1)).toBeCloseTo(0);
		expect(snapAzimuth(s, 1)).toBeCloseTo(2 * s);
	});
});
