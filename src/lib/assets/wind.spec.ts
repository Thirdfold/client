import { describe, expect, it } from 'vitest';
import { readWind, windParams } from './wind';

const village = { wind: { direction: 90, strength: 0.45, gust: 0.5 } };

describe('the wind field`s values (#300)', () => {
	it('blow the environment`s way, as strong as it says', () => {
		const p = windParams(village, 1, false, false);
		expect(p.direction[0]).toBeCloseTo(1); // east: +x
		expect(p.direction[1]).toBeCloseTo(0);
		expect(p).toMatchObject({ strength: 0.45, gust: 0.5 });
		expect(
			windParams({ wind: { ...village.wind, direction: 0 } }, 1, false, false).direction
		).toEqual([0, -1]); // north: the grid's -y, -z on the ground
	});

	it('are still air for an unknown or windless environment', () => {
		for (const env of [undefined, null, {}])
			expect(windParams(env, 1, false, false)).toMatchObject({ strength: 0, gust: 0 });
	});

	it('are exactly 0 under reduced motion or power saver', () => {
		expect(windParams(village, 1, true, false)).toMatchObject({ strength: 0, gust: 0 });
		expect(windParams(village, 1, false, true)).toMatchObject({ strength: 0, gust: 0 });
	});

	it('scale by the weather, clamped to 0..2 and the result to 1', () => {
		expect(windParams(village, 2, false, false)).toMatchObject({ strength: 0.9, gust: 1 });
		expect(windParams(village, 9, false, false)).toMatchObject({ strength: 0.9, gust: 1 });
		expect(windParams(village, -1, false, false)).toMatchObject({ strength: 0, gust: 0 });
		expect(windParams(village, NaN, false, false)).toMatchObject({ strength: 0.45 });
	});

	it('read from an environment only when every field is in range', () => {
		expect(readWind({ direction: 360, strength: 1, gust: 0 })).toEqual({
			direction: 360,
			strength: 1,
			gust: 0
		});
		for (const bad of [
			null,
			[],
			{ direction: 90, strength: 0.5 },
			{ direction: -1, strength: 0.5, gust: 0 },
			{ direction: 90, strength: 1.5, gust: 0 },
			{ direction: 90, strength: 0.5, gust: '1' },
			{ direction: Infinity, strength: 0, gust: 0 }
		])
			expect(readWind(bad)).toBeNull();
	});
});
