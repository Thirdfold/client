import { describe, expect, it } from 'vitest';
import {
	coverAt,
	coverChanging,
	DRY_MS,
	NO_COVER,
	settledCover,
	snowAt,
	SOAK_MS,
	wetnessAt
} from './weather';
import type { WorldLook } from './world';

const w = (kind: WorldLook['weather']['kind'], intensity = 1): WorldLook['weather'] => ({
	kind,
	intensity,
	seed: 1,
	since: 0
});

describe('cover', () => {
	it('soaks in rain and dries more slowly', () => {
		expect(wetnessAt(w('rain'), NO_COVER, SOAK_MS)).toBe(1);
		expect(wetnessAt(w('rain'), NO_COVER, SOAK_MS / 2)).toBeCloseTo(0.5);
		const full = { wet: 1, snow: 0, at: 0 };
		expect(wetnessAt(w('none'), full, SOAK_MS)).toBeGreaterThan(0.5);
		expect(wetnessAt(w('none'), full, DRY_MS)).toBe(0);
	});

	it('stops at the rain intensity and builds snow only in snow', () => {
		expect(wetnessAt(w('storm', 0.4), NO_COVER, 10 * SOAK_MS)).toBe(0.4);
		expect(snowAt(w('rain'), NO_COVER, 1e9)).toBe(0);
		expect(snowAt(w('snow', 0.7), NO_COVER, 1e9)).toBe(0.7);
	});

	it('is continuous across a change of weather and bounded', () => {
		const rain = w('rain');
		const mid = coverAt(rain, NO_COVER, SOAK_MS / 3);
		expect(wetnessAt(w('none'), mid, mid.at)).toBeCloseTo(wetnessAt(rain, NO_COVER, mid.at));
		for (const t of [-5, 0, 1, 1e12]) {
			const v = wetnessAt(rain, mid, t);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	it('settles, and says when it has', () => {
		const rain = w('rain', 0.5);
		expect(settledCover(rain, 7)).toEqual({ wet: 0.5, snow: 0, at: 7 });
		expect(coverChanging(rain, NO_COVER, 1000)).toBe(true);
		expect(coverChanging(rain, settledCover(rain, 0), 1000)).toBe(false);
	});
});
