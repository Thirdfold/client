// What cloud shadows look like under a weather and a sun (#323). Pure, so the server project
// tests it. The shadows are the sun's direct light times a drifting noise (materials/clouds.ts):
// `strength` is how dark the shadowed part is (0 is off), `threshold` how much of the ground is
// shadowed (a lower one is more). Coverage rises with rain, storm, snow and fog; the shadows are
// off on the low tier, with the sun down (the moon casts none) and under an enclosed sky, which
// has no sun at all.

import type { Weather } from '../game/world';

/** Cover at full intensity of each weather, 0-1; none (clear weather) keeps scattered cloud. */
const COVER: Record<Weather, number> = {
	none: 0.3,
	rain: 0.75,
	storm: 1,
	snow: 0.8,
	fog: 0.9,
	ash: 0.7,
	dust: 0.5
};
const CLEAR = COVER.none;
/** The sun's height (degrees) by which the shadows are at full strength. */
const FULL_AT_DEG = 12;

export interface CloudLook {
	strength: number;
	threshold: number;
}

/** `sunElevation` is -90 under an enclosed sky (atmosphere-curve.ts). */
export function cloudLook(
	weather: { kind: Weather; intensity: number },
	sunElevation: number,
	low: boolean
): CloudLook {
	const i = Math.min(1, Math.max(0, weather.intensity));
	const cover = CLEAR + ((COVER[weather.kind] ?? CLEAR) - CLEAR) * i;
	const up = Math.min(1, Math.max(0, sunElevation / FULL_AT_DEG));
	return {
		strength: low || sunElevation <= 0 ? 0 : (0.35 + 0.25 * cover) * up * up * (3 - 2 * up),
		threshold: 0.75 - 0.4 * cover
	};
}
