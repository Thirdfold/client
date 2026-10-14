import { describe, expect, it } from 'vitest';
import { WEATHERS } from '../game/world';
import { LEVEL_GAIN, bedOf, levelOf, thunderLook, weatherSoundFor } from './weather';

const rain = (intensity: number) => ({ kind: 'rain' as const, intensity });

describe('the weather beds', () => {
	it('gives rain in the village a rain bed', () => {
		expect(weatherSoundFor(rain(0.5), true, 'bellweather').bed).toBe('rain');
		expect(weatherSoundFor({ kind: 'storm', intensity: 0.5 }, true, 'bellweather').bed).toBe(
			'storm'
		);
	});

	it('gives none in the Hollow, the Heart and under an enclosed sky', () => {
		expect(weatherSoundFor(rain(1), true, 'hollow')).toEqual({ bed: 'none', level: 0 });
		expect(weatherSoundFor(rain(1), true, 'heart')).toEqual({ bed: 'none', level: 0 });
		expect(weatherSoundFor(rain(1), false, 'train').bed).toBe('none'); // the railcar's interior
	});

	it('gives snow, ash and dust the wind bed and fog and clear none', () => {
		for (const kind of ['snow', 'ash', 'dust'] as const)
			expect(weatherSoundFor({ kind, intensity: 0.4 }, true, 'bellweather').bed).toBe('wind');
		expect(weatherSoundFor({ kind: 'fog', intensity: 1 }, true, 'bellweather').bed).toBe('none');
		expect(weatherSoundFor({ kind: 'none', intensity: 1 }, true, 'bellweather').bed).toBe('none');
	});

	it('keeps the bed (so no crossfade) when only the intensity changes', () => {
		const beds = [0.05, 0.3, 0.6, 1].map((i) => weatherSoundFor(rain(i), true, 'bellweather'));
		expect(new Set(beds.map((b) => b.bed)).size).toBe(1);
		expect(beds.map((b) => b.level)).toEqual([1, 1, 2, 3]);
	});

	it('changes the bed when a kind changes the bed, and not otherwise', () => {
		const bed = (kind: (typeof WEATHERS)[number]) => bedOf(kind);
		expect(bed('rain')).not.toBe(bed('storm'));
		expect(bed('snow')).toBe(bed('ash'));
		expect(bed('rain')).not.toBe(bed('snow'));
	});

	it('is quiet at level 0 and louder with each level', () => {
		expect(levelOf(0)).toBe(0);
		expect(LEVEL_GAIN[0]).toBe(0);
		for (let i = 1; i < LEVEL_GAIN.length; i++)
			expect(LEVEL_GAIN[i]).toBeGreaterThan(LEVEL_GAIN[i - 1]);
	});

	it('makes thunder quieter and duller the later it comes', () => {
		const near = thunderLook(1000);
		const far = thunderLook(4000);
		expect(far.gain).toBeLessThan(near.gain);
		expect(far.crack).toBeLessThan(near.crack);
		expect(far.gain).toBeGreaterThan(0);
	});
});
