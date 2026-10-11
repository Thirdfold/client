import { describe, expect, it } from 'vitest';
import {
	capsuleFade,
	occluderOrder,
	occlusionAt,
	OCCLUSION,
	PARKED,
	PICK_THROUGH,
	type Occluder
} from './occlusion';

const CS = 2;
/** A mini standing at the origin on floor 0, the camera up and back along -z. */
const mini: Occluder = { x: 0, y: OCCLUSION.chest * CS, z: 0, floor: 0 };
const cam = { x: 0, y: 20, z: -20 };
/** A point on the camera-to-chest line, `t` of the way from the camera. */
const along = (t: number) => ({
	x: cam.x + (mini.x - cam.x) * t,
	y: cam.y + (mini.y - cam.y) * t,
	z: cam.z + (mini.z - cam.z) * t
});

describe('capsuleFade', () => {
	it('fades what stands in front of the mini on the line', () => {
		expect(capsuleFade(along(0.8), 0, cam, mini, CS)).toBe(1);
		expect(occlusionAt(along(0.8), 0, cam, [null, mini], CS)).toBeGreaterThanOrEqual(PICK_THROUGH);
	});

	it('fades nothing behind the mini or right at it', () => {
		const behind = { x: 0, y: mini.y - 0.5, z: 0.5 * CS };
		expect(capsuleFade(behind, 0, cam, mini, CS)).toBe(0);
		expect(capsuleFade(along(1), 0, cam, mini, CS)).toBe(0);
	});

	it('fades nothing off the line, softly at its edge', () => {
		const off = (d: number) => ({ ...along(0.7), x: d * CS });
		expect(capsuleFade(off(OCCLUSION.radius + 0.01), 0, cam, mini, CS)).toBe(0);
		const edge = capsuleFade(off(OCCLUSION.radius * 0.8), 0, cam, mini, CS);
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(1);
	});

	it('never fades the ground the mini stands on', () => {
		const ground = { x: 0, y: 0, z: -0.3 * CS };
		const near = { ...mini, y: 0.3 * CS }; // a low line passes through the floor in front
		expect(capsuleFade(ground, 1, cam, near, CS)).toBe(0);
		// The same point as a wall's face (not facing up) does fade.
		expect(capsuleFade(ground, 0, cam, near, CS)).toBeGreaterThan(0);
		// Raised ground in front, above the mini's floor, fades.
		const raised = along(0.9);
		expect(capsuleFade(raised, 1, cam, mini, CS)).toBeGreaterThan(0);
	});

	it('parked and empty slots fade nothing', () => {
		const parked = { x: 0, y: 0, z: 0, floor: PARKED };
		expect(capsuleFade(along(0.8), 0, cam, parked, CS)).toBe(0);
		expect(occlusionAt(along(0.8), 0, cam, [null, parked, null, null], CS)).toBe(0);
	});
});

describe('occluderOrder', () => {
	const at = (id: string, x: number) => ({ id, x, z: 0 });
	const minis = [at('a', 0), at('b', 5), at('c', 1), at('e', 2), at('f', 9), at('g', 3)];
	const pivot = { x: 0, z: 0 };

	it('takes the selected, then own nearest the pivot, then the turn, at most four', () => {
		const own = new Set(['b', 'c', 'f', 'g']);
		expect(occluderOrder(minis, 'f', own, 'e', pivot)).toEqual(['f', 'c', 'g', 'b']);
		expect(occluderOrder(minis, null, new Set(['c']), 'e', pivot)).toEqual(['c', 'e']);
	});

	it('gives the GM the selection and the turn, a spectator the turn', () => {
		expect(occluderOrder(minis, 'a', new Set(), 'e', pivot)).toEqual(['a', 'e']);
		expect(occluderOrder(minis, null, new Set(), 'e', pivot)).toEqual(['e']);
	});

	it('never picks a mini that is not a candidate', () => {
		expect(occluderOrder(minis, 'x', new Set(['y']), 'z', pivot)).toEqual([]);
	});
});
