// The vegetation rows by tier (#308): they rise with the tier, and foliage never discards.

import { describe, expect, it } from 'vitest';
import { KINDS } from '../materials/kinds';
import { settingsFor, TIERS } from '../quality';
import { VEGETATION } from './vegetation-tiers';

const rows = TIERS.map((t) => settingsFor(t, 'webgpu').vegetation);

describe('vegetation rows', () => {
	it('are the issue table', () => {
		expect(rows.map((r) => r.blades)).toEqual([10, 24, 40, 40]);
		expect(rows.map((r) => r.segments)).toEqual([3, 4, 5, 5]);
		expect(rows.map((r) => r.scatter)).toEqual([0.35, 0.7, 1, 1]);
		expect(rows.map((r) => r.decalCap)).toEqual([256, 1024, 2048, 2048]);
	});

	it('never fall from one tier to the next, and rise from low to high', () => {
		for (const key of ['blades', 'segments', 'scatter', 'decalCap'] as const) {
			for (let i = 1; i < rows.length; i++)
				expect(rows[i][key]).toBeGreaterThanOrEqual(rows[i - 1][key]);
			expect(rows[2][key]).toBeGreaterThan(rows[0][key]);
		}
	});

	it('come from the one table', () => {
		expect(rows).toEqual(TIERS.map((t) => VEGETATION[t]));
	});

	it('leave foliage opaque: no blending and no alpha cut, so nothing discards on any tier', () => {
		expect(KINDS.foliage.transparent).toBe(false);
		expect(KINDS.foliage.alphaTested).toBe(false);
	});
});
