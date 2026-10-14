import { describe, expect, it } from 'vitest';
import { FLOOR_IDS } from '../game/floor';
import { TIERS } from './quality';
import {
	dropCount,
	FALLING,
	LOOKS,
	MAX_DROPS,
	phaseAt,
	porosityTable,
	seedOffsets,
	weatherVisible
} from './weather-look';

describe('weatherVisible', () => {
	it('shows a falling kind under an open sky, and nothing else', () => {
		const rain = { kind: 'rain', intensity: 0.5 } as const;
		expect(weatherVisible('open', rain)).toBe(true);
		expect(weatherVisible('enclosed', rain)).toBe(false);
		expect(weatherVisible('open', { ...rain, intensity: 0 })).toBe(false);
		expect(weatherVisible('open', { kind: 'fog', intensity: 1 })).toBe(false);
		expect(weatherVisible('open', { kind: 'none', intensity: 1 })).toBe(false);
		for (const kind of FALLING) expect(weatherVisible('open', { kind, intensity: 1 })).toBe(true);
	});
});

describe('dropCount', () => {
	it("is the tier's at full rain, scales with strength, and is none on software GL", () => {
		expect(dropCount('low', 1)).toBe(3000);
		expect(dropCount('medium', 1)).toBe(8000);
		expect(dropCount('high', 1)).toBe(20000);
		expect(dropCount('ultra', 1)).toBe(MAX_DROPS);
		expect(dropCount('high', 0.5)).toBe(10000);
		expect(dropCount('high', 5)).toBe(MAX_DROPS);
		expect(dropCount('high', 1, 'rain', true)).toBe(0);
		expect(dropCount('high', 0)).toBe(0);
		expect(dropCount('high', 1, 'fog')).toBe(0);
		expect(dropCount('high', 1, 'none')).toBe(0);
		for (const tier of TIERS) expect(dropCount(tier, 1, 'snow')).toBeLessThanOrEqual(MAX_DROPS);
	});
});

describe("the storm's clock", () => {
	it('is a phase in [0, 1) the same for the same server time, before and after `since`', () => {
		expect(phaseAt(10_000, 0, 10)).toBeCloseTo(0);
		expect(phaseAt(12_500, 0, 10)).toBeCloseTo(0.25);
		expect(phaseAt(500, 1000, 1)).toBeCloseTo(0.5); // a clock a little behind `since`
		for (const ms of [-1e6, 0, 123456789]) {
			const p = phaseAt(ms, 99, LOOKS.rain.cycle);
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThan(1);
		}
	});

	it('turns a seed into offsets in [0, 1)', () => {
		for (const seed of [0, 1, 4294967295]) {
			const [x, z, phase] = seedOffsets(seed);
			for (const v of [x, z, phase]) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThan(1);
			}
		}
		expect(seedOffsets(7)).toEqual(seedOffsets(7));
		expect(seedOffsets(7)).not.toEqual(seedOffsets(8));
	});
});

describe('porosity', () => {
	it('has an entry for every floor, none for water and void', () => {
		const table = porosityTable();
		expect(table).toHaveLength(FLOOR_IDS.length);
		expect(table[FLOOR_IDS.indexOf('grass')]).toBeGreaterThan(table[FLOOR_IDS.indexOf('stone')]);
		expect(table[FLOOR_IDS.indexOf('water')]).toBe(0);
		expect(table[FLOOR_IDS.indexOf('void')]).toBe(0);
	});
});
