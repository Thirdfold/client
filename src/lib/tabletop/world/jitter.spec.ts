import { describe, expect, it } from 'vitest';
import { JITTER_LIMITS, JITTER_MARGIN, jitterFor, NO_JITTER, type Bounds } from './jitter';

const spec = { yaw: 20, offset: 0.15 };
const crate: Bounds = { min: [-0.4, 0, -0.4], max: [0.4, 0.8, 0.4] };
const plank: Bounds = { min: [-0.9, 0, -0.2], max: [0.9, 0.2, 0.2] };
const ids = Array.from({ length: 40 }, (_, i) => `prop-${i}`);

/** The scaled model's corners, turned like three turns them, about the footprint's centre. */
function extent(b: Bounds, rotation: number, yaw: number, scale: number) {
	const a = -rotation * (Math.PI / 2) + yaw;
	const xs: number[] = [];
	const zs: number[] = [];
	for (const x of [b.min[0], b.max[0]])
		for (const z of [b.min[2], b.max[2]]) {
			xs.push((x * Math.cos(a) + z * Math.sin(a)) * scale);
			zs.push((z * Math.cos(a) - x * Math.sin(a)) * scale);
		}
	return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
}

describe('jitterFor', () => {
	it('is the same for an id every time, and differs between ids', () => {
		const a = jitterFor('crate-1', spec, crate, { w: 1, h: 1 }, 0, 1);
		expect(jitterFor('crate-1', spec, crate, { w: 1, h: 1 }, 0, 1)).toEqual(a);
		const all = new Set(ids.map((id) => jitterFor(id, spec, crate, { w: 1, h: 1 }, 0, 1).yaw));
		expect(all.size).toBeGreaterThan(30);
	});

	it('stays within the catalogue limits', () => {
		for (const id of ids) {
			const j = jitterFor(id, { yaw: 99, offset: 9 }, crate, { w: 2, h: 2 }, 1, 0.5);
			expect(Math.abs(j.yaw)).toBeLessThanOrEqual((JITTER_LIMITS.yaw * Math.PI) / 180 + 1e-9);
			expect(Math.abs(j.dx)).toBeLessThanOrEqual(JITTER_LIMITS.offset + 1e-9);
			expect(Math.abs(j.dz)).toBeLessThanOrEqual(JITTER_LIMITS.offset + 1e-9);
		}
	});

	it('keeps the model inside its footprint at every rotation and scale', () => {
		const cases: [Bounds, { w: number; h: number }][] = [
			[crate, { w: 1, h: 1 }],
			[plank, { w: 2, h: 1 }]
		];
		let moved = 0;
		for (const [bounds, fp] of cases)
			for (const rotation of [0, 1, 2, 3])
				for (const scale of [0.5, 0.75, 1, 1.25, 2]) {
					const size = rotation % 2 ? { w: fp.h, h: fp.w } : fp;
					for (const id of ids) {
						const j = jitterFor(id, spec, bounds, size, rotation, scale);
						if (j === NO_JITTER) continue; // already overflows its footprint: left alone
						const e = extent(bounds, rotation, j.yaw, scale);
						const room = JITTER_MARGIN - 1e-9;
						expect(e.x[0] + j.dx).toBeGreaterThanOrEqual(-size.w / 2 + room);
						expect(e.x[1] + j.dx).toBeLessThanOrEqual(size.w / 2 - room);
						expect(e.z[0] + j.dz).toBeGreaterThanOrEqual(-size.h / 2 + room);
						expect(e.z[1] + j.dz).toBeLessThanOrEqual(size.h / 2 - room);
						if (j.yaw || j.dx || j.dz) moved++;
					}
				}
		expect(moved).toBeGreaterThan(100);
	});

	it('is none without a jitter entry, bounds, or room', () => {
		const fp = { w: 1, h: 1 };
		expect(jitterFor('a', undefined, crate, fp, 0, 1)).toEqual(NO_JITTER);
		expect(jitterFor('a', spec, undefined, fp, 0, 1)).toEqual(NO_JITTER);
		// Fills the footprint already, and a crate at scale 2 overflows it.
		const full: Bounds = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
		for (const id of ids) {
			expect(jitterFor(id, spec, full, fp, 0, 1)).toEqual(NO_JITTER);
			expect(jitterFor(id, spec, crate, fp, 0, 2)).toEqual(NO_JITTER);
		}
	});

	it('only turns when the offset is 0 (a leaning gravestone)', () => {
		const j = jitterFor('g', { yaw: 6, offset: 0 }, crate, { w: 1, h: 1 }, 0, 1);
		expect(j.dx).toBe(0);
		expect(j.dz).toBe(0);
		expect(Math.abs(j.yaw)).toBeLessThanOrEqual((6 * Math.PI) / 180 + 1e-9);
	});
});
