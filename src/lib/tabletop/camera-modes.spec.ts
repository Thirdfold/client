import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { EYE_LEVELS } from '../game/visibility';
import { monasteryScene } from '../../../server/adventures/hollow-bell/monastery';
import { decodeLevels } from '../game/terrain';
import { FOV, EYE_LEVEL_FOV } from './camera-rig';
import {
	CAMERA_MODES,
	CAMERA_VIEWS,
	cameraSubject,
	effectiveCurve,
	parseView,
	type SubjectChoice
} from './camera-modes';
import { EYE_DISTANCE, eyeLift, subjectPivot, subjectRig, trackStep } from './camera-track';
import { groundFor, STEP_HEIGHT } from './ground';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 30, height: 20 };
const scene = monasteryScene();
const ground = groundFor(grid, scene.terrain ? decodeLevels(scene.terrain, 600) : null);

describe('the camera modes (#289)', () => {
	it('has four modes with sane ranges, fields of view and policies', () => {
		expect(CAMERA_VIEWS).toEqual(['overview', 'explore', 'eye', 'follow']);
		for (const v of CAMERA_VIEWS) {
			const { distance, curve } = CAMERA_MODES[v];
			expect(distance.min).toBeGreaterThan(0);
			expect(distance.max ?? Infinity).toBeGreaterThan(distance.min);
			expect(FOV[curve]).toBeGreaterThan(20);
		}
		expect(FOV[CAMERA_MODES.eye.curve]).toBe(EYE_LEVEL_FOV);
		expect(FOV[CAMERA_MODES.overview.curve]).toBe(30);
		expect(FOV[CAMERA_MODES.explore.curve]).toBe(40);
		expect(CAMERA_MODES.eye.grid).toBe('off');
		expect(CAMERA_MODES.eye.labels).toBe('hover');
		expect(CAMERA_MODES.overview.labels).toBe('own');
		// The spring arm holds the modes that stand low or follow; the cutaway the others.
		expect(CAMERA_VIEWS.filter((v) => CAMERA_MODES[v].arm)).toEqual(['eye', 'follow']);
	});

	it('migrates the stored view', () => {
		for (const v of CAMERA_VIEWS) expect(parseView(v)).toBe(v);
		expect(parseView('tabletop')).toBe('explore');
		expect(parseView('tactical')).toBe('overview');
		for (const junk of [null, undefined, '', 'Eye', 7, {}, 'follow '])
			expect(parseView(junk)).toBe('overview');
	});

	it('stands the eye pivot EYE_LEVELS above the floor of the mini, and falls back without one', () => {
		const belfry = { id: 'a', pos: { x: 26, y: 4 } };
		const floor = ground.floorY(belfry.pos);
		expect(floor).toBeGreaterThan(0);
		expect(eyeLift()).toBeCloseTo(EYE_LEVELS * STEP_HEIGHT);
		expect(subjectPivot('eye', belfry, grid, ground).y).toBeCloseTo(
			floor + EYE_LEVELS * STEP_HEIGHT
		);
		expect(subjectPivot('follow', belfry, grid, ground).y).toBeCloseTo(floor);
		const rig = subjectRig('eye', belfry, grid, ground, 1)!;
		expect(rig.distance).toBe(EYE_DISTANCE * grid.cellSize);
		expect(rig.pitch).toBeLessThan(0.3); // toward the horizon
		expect(subjectRig('eye', null, grid, ground, 1)).toBeNull();
		expect(subjectRig('explore', belfry, grid, ground, 1)).toBeNull();
		expect(effectiveCurve('eye', null)).toBe('explore');
		expect(effectiveCurve('eye', belfry)).toBe('eye');
		expect(effectiveCurve('follow', null)).toBe('explore');
	});

	it('attaches only to minis the viewer was sent', () => {
		const c: SubjectChoice = {
			selectedId: 'hidden',
			activeId: 'turn',
			followTurns: true,
			visible: new Set(['mine', 'turn']),
			own: ['mine']
		};
		expect(cameraSubject('overview', c)).toBeNull();
		expect(cameraSubject('explore', c)).toBeNull();
		expect(cameraSubject('eye', c)).toBe('mine'); // the selected one is not in the view
		expect(cameraSubject('eye', { ...c, selectedId: 'turn' })).toBe('turn');
		expect(cameraSubject('eye', { ...c, own: ['gone'], selectedId: null })).toBeNull();
		expect(cameraSubject('follow', c)).toBe('turn');
		expect(cameraSubject('follow', { ...c, activeId: 'hidden', selectedId: 'mine' })).toBe('mine');
		expect(cameraSubject('follow', { ...c, followTurns: false, selectedId: null })).toBeNull();
		expect(cameraSubject('follow', { ...c, activeId: 'hidden', selectedId: 'hidden' })).toBeNull();
	});

	it('follows by easing, instantly under reduced motion, and stops when the viewer pans', () => {
		const goal = { x: 10, z: 0 };
		const eased = trackStep({ x: 0, z: 0 }, goal, null, 16.67, false);
		expect(eased.dx).toBeGreaterThan(0);
		expect(eased.dx).toBeLessThan(10);
		expect(eased.easing).toBe(true);
		expect(trackStep({ x: 9.99999, z: 0 }, goal, null, 16.67, false).easing).toBe(false);
		expect(trackStep({ x: 0, z: 0 }, goal, null, 16.67, true)).toMatchObject({
			dx: 10,
			dz: 0,
			easing: false
		});
		// The pivot is where following left it: still following; moved off it: a pan.
		const left = { x: 3, z: 3 };
		expect(trackStep(left, goal, left, 16.67, false).panned).toBe(false);
		expect(trackStep({ x: 3.5, z: 3 }, goal, left, 16.67, false)).toMatchObject({
			panned: true,
			dx: 0
		});
	});
});
