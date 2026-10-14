import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { anyInView, PLANT_VARIETY, varietyFor } from './plants';

const ids = Array.from({ length: 200 }, (_, i) => `hb-tree-${i}`);

describe('varietyFor', () => {
	it('is the same for the same id', () => {
		for (const id of ids.slice(0, 20)) expect(varietyFor(id, true)).toEqual(varietyFor(id, true));
	});

	it('keeps the size and hue within their limits, and spreads them', () => {
		const all = ids.map((id) => varietyFor(id, true));
		for (const v of all) {
			expect(Math.abs(v.scale - 1)).toBeLessThanOrEqual(PLANT_VARIETY.scale);
			expect(Math.abs(v.hue)).toBeLessThanOrEqual(PLANT_VARIETY.hue);
			expect(Math.abs(v.yaw)).toBeLessThanOrEqual(Math.PI);
		}
		expect(Math.min(...all.map((v) => v.scale))).toBeLessThan(0.95);
		expect(Math.max(...all.map((v) => v.scale))).toBeGreaterThan(1.05);
		expect(Math.min(...all.map((v) => v.yaw))).toBeLessThan(-2);
		expect(Math.max(...all.map((v) => v.yaw))).toBeGreaterThan(2);
	});

	it('leaves the turn to the catalogue jitter when the yaw is not free, changing nothing else', () => {
		for (const id of ids.slice(0, 20)) {
			const [free, bound] = [varietyFor(id, true), varietyFor(id, false)];
			expect(bound.yaw).toBe(0);
			expect({ ...bound, yaw: 0 }).toEqual({ ...free, yaw: 0 });
		}
	});
});

describe('anyInView', () => {
	const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
	camera.position.set(0, 5, 10);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();
	const vp = new THREE.Matrix4().multiplyMatrices(
		camera.projectionMatrix,
		camera.matrixWorldInverse
	);

	/** A bucket of one plant mesh with a bounding sphere. */
	const plant = (
		x: number,
		y: number,
		z: number,
		radius: number,
		kind = 'foliage',
		visible = true
	) => ({
		model: { entry: { kind } },
		parts: [{ mesh: { visible, boundingSphere: { center: { x, y, z }, radius } } }]
	});

	it('sees a plant ahead, and not one behind or far to the side', () => {
		expect(anyInView([plant(0, 1, 0, 1)], vp.elements)).toBe(true);
		expect(anyInView([plant(0, 5, 30, 1)], vp.elements)).toBe(false);
		expect(anyInView([plant(80, 0, 0, 1)], vp.elements)).toBe(false);
		expect(anyInView([], vp.elements)).toBe(false);
	});

	it('counts a plant whose edge reaches into the view, and any of several', () => {
		expect(anyInView([plant(20, 0, 0, 1)], vp.elements)).toBe(false);
		expect(anyInView([plant(20, 0, 0, 15)], vp.elements)).toBe(true);
		expect(anyInView([plant(20, 0, 0, 1), plant(0, 0, 0, 1)], vp.elements)).toBe(true);
	});

	it('ignores what is not a plant, a hidden mesh and a model not yet loaded', () => {
		expect(anyInView([plant(0, 1, 0, 1, 'prop')], vp.elements)).toBe(false);
		expect(anyInView([plant(0, 1, 0, 1, 'foliage', false)], vp.elements)).toBe(false);
		expect(anyInView([{ model: null, parts: [] }], vp.elements)).toBe(false);
	});
});
