// What the weather sounds like (#325): which bed plays under the place's ambience, how loud, and
// where there is none. Pure and Node-tested (weather.spec.ts); the Web Audio half, in a lazy chunk
// so the room page does not grow, is weather-sound.ts. Presentation only: nothing here is sent.

import type { Weather } from '../game/world';

/** The beds: rain, rain with wind (and thunder), and wind (snow's hush, ash and dust). */
export type WeatherBed = 'none' | 'rain' | 'storm' | 'wind';

/** Places the weather never reaches, whatever the sky says (the Hollow, the Heart). */
const SHUT_IN = new Set(['hollow', 'heart']);

export interface WeatherSound {
	bed: WeatherBed;
	/** Intensity bucket, 0 (none) to 3. Changes the bed's loudness only, never the bed. */
	level: 0 | 1 | 2 | 3;
}

/** The bed of a weather kind: fog is silent. */
export function bedOf(kind: Weather): WeatherBed {
	switch (kind) {
		case 'rain':
			return 'rain';
		case 'storm':
			return 'storm';
		case 'snow':
		case 'ash':
		case 'dust':
			return 'wind';
		default:
			return 'none';
	}
}

/** Intensity 0-1 as a bucket 0-3 (any intensity above 0 is at least 1). */
export const levelOf = (intensity: number): WeatherSound['level'] =>
	intensity > 0 ? (Math.min(3, Math.max(1, Math.ceil(intensity * 3))) as 1 | 2 | 3) : 0;

/**
 * The weather as heard at a place: none where the sky is enclosed (the railcar's interior, the
 * Hollow and the Heart) or the place is shut in. `open` is the table's sky being open.
 */
export function weatherSoundFor(
	weather: { kind: Weather; intensity: number },
	open: boolean,
	location: string | null | undefined
): WeatherSound {
	const bed = open && !SHUT_IN.has(location ?? '') ? bedOf(weather.kind) : 'none';
	return { bed, level: bed === 'none' ? 0 : levelOf(weather.intensity) };
}

/** A bed's loudness at each level (the ambience bus's mix applies on top). */
export const LEVEL_GAIN = [0, 0.4, 0.7, 1] as const;

/** Thunder: how loud and how dull it is `delayMs` after its strike (farther is quieter, duller). */
export function thunderLook(delayMs: number): { gain: number; crack: number } {
	const far = Math.min(1, Math.max(0, (delayMs - 1000) / 3000));
	return { gain: 0.9 - 0.5 * far, crack: 1 - 0.8 * far };
}
