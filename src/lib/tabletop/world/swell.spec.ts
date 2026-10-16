// The sea's swell (#296): flat on the grid's border at any time, bounded by the waves'
// amplitudes everywhere, and the constants the shader is built from stay within the issue's.

import { describe, expect, it } from 'vitest';
import { STEP_HEIGHT } from '../ground';
import {
	MAX_AMPLITUDE,
	MAX_STEEPNESS,
	MAX_WAVELENGTH,
	MIN_WAVELENGTH,
	SWELL_RAMP_CELLS,
	swellAt,
	swellOf,
	swellStrength,
	WAVE_COUNT,
	WAVES,
	type SeaTier
} from './swell';

const span = { halfX: 16, halfZ: 10, cellSize: 1, fogNear: 60, fogFar: 160 };
const TIERS = Object.keys(WAVE_COUNT) as SeaTier[];

/** A deterministic scatter of points and times. */
function samples(n: number) {
	const out: { x: number; z: number; t: number }[] = [];
	let s = 12345;
	const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296) * 2 - 1;
	for (let i = 0; i < n; i++) out.push({ x: rand() * 100, z: rand() * 100, t: rand() * 500 });
	return out;
}

describe('the swell', () => {
	it('keeps the waves within the issue: 6-20 cell lengths, steepness 0.25, amplitude 0.15 levels', () => {
		for (const w of WAVES) {
			expect(w.wavelength).toBeGreaterThanOrEqual(MIN_WAVELENGTH);
			expect(w.wavelength).toBeLessThanOrEqual(MAX_WAVELENGTH);
			expect(w.steepness).toBeLessThanOrEqual(MAX_STEEPNESS);
			expect(w.amplitude).toBeLessThanOrEqual(MAX_AMPLITUDE);
		}
	});

	it('runs 2, 3 and 4 waves on low, medium and high, each tier a prefix of the next', () => {
		expect(TIERS.map((t) => swellOf(t, span).waves.length)).toEqual([2, 3, 4]);
		expect(swellOf('high', span).waves.slice(0, 2)).toEqual(swellOf('low', span).waves);
	});

	it.each(TIERS)('is 0 on the grid border and inside it, at any time, on %s', (tier) => {
		const s = swellOf(tier, span);
		const { halfX: hw, halfZ: hd } = span;
		for (const t of [0, 0.37, 12.5, 1e4]) {
			for (let i = 0; i <= 20; i++) {
				const [u, v] = [(i / 10 - 1) * hw, (i / 10 - 1) * hd];
				for (const [x, z] of [
					[u, -hd],
					[u, hd],
					[-hw, v],
					[hw, v],
					[u * 0.5, v * 0.5]
				]) {
					const d = swellAt(s, x, z, t);
					expect([Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)]).toEqual([0, 0, 0]);
				}
			}
		}
	});

	it.each(TIERS)('stays within the amplitudes everywhere on %s', (tier) => {
		const s = swellOf(tier, span);
		const rise = STEP_HEIGHT * span.cellSize;
		const lift = s.waves.reduce((sum, w) => sum + w.amplitude, 0) * rise;
		const pull = s.waves.reduce((sum, w) => sum + w.steepness * w.amplitude, 0) * rise;
		let moved = 0;
		for (const { x, z, t } of samples(2000)) {
			const d = swellAt(s, x, z, t);
			expect(Math.abs(d.y)).toBeLessThanOrEqual(lift + 1e-12);
			expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(pull + 1e-12);
			if (d.y !== 0) moved++;
		}
		expect(moved).toBeGreaterThan(100); // it does move somewhere
	});

	it('grows over eight cells from the border and flattens into the haze', () => {
		const s = swellOf('high', span);
		const at = (d: number) => swellStrength(s, span.halfX + d, 0);
		expect(at(0)).toBe(0);
		expect(at(SWELL_RAMP_CELLS / 2)).toBeCloseTo(0.5, 5);
		expect(at(SWELL_RAMP_CELLS)).toBeGreaterThan(0.99);
		expect(swellStrength(s, span.fogFar + 1, 0)).toBe(0);
		// The cell size scales the ramp with the table.
		const big = swellOf('high', { ...span, cellSize: 2, halfX: 32 });
		expect(swellStrength(big, 32 + SWELL_RAMP_CELLS, 0)).toBeCloseTo(0.5, 5);
	});

	it('is the same on every call', () => {
		const s = swellOf('high', span);
		expect(swellAt(s, 40, -33, 7.5)).toEqual(swellAt(s, 40, -33, 7.5));
	});
});
