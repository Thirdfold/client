// The grass's blades (#302): counts per tier, the strip, insets and the distance thinning.

import { describe, expect, it } from 'vitest';
import { bladesInView, bladeStrip, FADE, INSET_MARGIN, margins, rootIn } from './grass-blades';
import { INSET } from './grass-cells';
import { MAX_ROUND } from './shape';

describe('bladeStrip', () => {
	it('has 2S + 1 vertices from root to tip and 2S - 1 triangles', () => {
		for (const s of [3, 4, 5]) {
			const { positions, indices } = bladeStrip(s);
			expect(positions.length).toBe((2 * s + 1) * 3);
			expect(indices.length).toBe((2 * s - 1) * 3);
			expect(Array.from(positions.slice(-3))).toEqual([0, 1, 0]); // the tip
			expect(Math.max(...indices)).toBe(2 * s);
		}
	});
});

describe('insets', () => {
	it('keeps blades off walls by the wall margin and off drops by the wide one', () => {
		expect(INSET_MARGIN.wide).toBe(MAX_ROUND);
		expect(margins(0)).toEqual([0, 0, 0, 0]);
		expect(margins(INSET.wall << 1)).toEqual([0, INSET_MARGIN.wall, 0, 0]);
		expect(margins((INSET.wide << 3) | (INSET.wall << 3))).toEqual([0, 0, 0, INSET_MARGIN.wide]);
	});

	it('roots every blade inside the cell less its margins', () => {
		const bits = (INSET.wall << 0) | (INSET.wide << 1);
		for (const [a, b] of [
			[0, 0],
			[1, 1],
			[0.5, 0.25]
		]) {
			const { x, y } = rootIn(bits, a, b);
			expect(x).toBeLessThanOrEqual(1 - INSET_MARGIN.wide + 1e-9);
			expect(x).toBeGreaterThanOrEqual(0);
			expect(y).toBeGreaterThanOrEqual(INSET_MARGIN.wall - 1e-9);
			expect(y).toBeLessThanOrEqual(1);
		}
	});
});

describe('bladesInView', () => {
	it('draws them all up close, fewer further out, none past the fade', () => {
		expect(bladesInView(40, 0)).toBe(40);
		expect(bladesInView(40, FADE.far * 0.5)).toBe(34);
		expect(bladesInView(40, FADE.far * 0.9)).toBe(7);
		expect(bladesInView(40, FADE.far)).toBe(0);
	});

	it('never drops a blade that could still show', () => {
		for (const share of [0, 0.1, 0.35, 0.7, 0.95]) {
			const near = FADE.far * share;
			const kept = bladesInView(40, near);
			for (let b = kept; b < 40; b++)
				expect(FADE.far * (1 - (FADE.keep * b) / 40)).toBeLessThanOrEqual(near + 1e-9);
		}
	});
});
