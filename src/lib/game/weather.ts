// Weather's cover (#321): how wet the ground is and how much snow lies on it, as pure functions of
// the world's weather, a cover anchor the server sets, and server time (src/lib/net/server-clock.ts),
// so every client draws the same wet and white at the same moment with no traffic. Presentation
// only: nothing here touches the rules. Relative imports only.

import type { WorldLook } from './world';

type Weather = WorldLook['weather'];

/**
 * The cover held at server time `at`: each 0..1. The server re-anchors it whenever the weather's
 * kind or intensity changes, so cover never jumps.
 */
export interface Cover {
	wet: number;
	snow: number;
	at: number;
}

/** Heavy rain soaks the ground in about this long, and the ground dries in about this long. */
export const SOAK_MS = 3 * 60_000;
export const DRY_MS = 12 * 60_000;
/** Snow builds in about this long and melts more slowly than rain dries. */
export const BUILD_MS = 10 * 60_000;
export const MELT_MS = 30 * 60_000;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Where wetness is heading: the rain's intensity, else dry. */
export function wetTarget(weather: Weather): number {
	return weather.kind === 'rain' || weather.kind === 'storm' ? clamp01(weather.intensity) : 0;
}

/** Where snow cover is heading: the snow's intensity, else bare. */
export function snowTarget(weather: Weather): number {
	return weather.kind === 'snow' ? clamp01(weather.intensity) : 0;
}

function toward(from: number, target: number, ms: number, upMs: number, downMs: number): number {
	const step = Math.max(0, ms) / (target > from ? upMs : downMs);
	return clamp01(target > from ? Math.min(target, from + step) : Math.max(target, from - step));
}

/** Wetness 0..1 at `serverNow`: it moves from the anchor toward the weather's target. */
export function wetnessAt(weather: Weather, cover: Cover, serverNow: number): number {
	return toward(cover.wet, wetTarget(weather), serverNow - cover.at, SOAK_MS, DRY_MS);
}

/** Snow cover 0..1 at `serverNow`. */
export function snowAt(weather: Weather, cover: Cover, serverNow: number): number {
	return toward(cover.snow, snowTarget(weather), serverNow - cover.at, BUILD_MS, MELT_MS);
}

/** The cover as it stands at `now`, anchored there (the next anchor, when the weather changes). */
export function coverAt(weather: Weather, cover: Cover, now: number): Cover {
	return { wet: wetnessAt(weather, cover, now), snow: snowAt(weather, cover, now), at: now };
}

/** A table with this weather long since: a load or a restore (a table saved in rain loads wet). */
export function settledCover(weather: Weather, now: number): Cover {
	return { wet: wetTarget(weather), snow: snowTarget(weather), at: now };
}

/** True while the cover is still moving toward its target (the renderer updates at 1 Hz while it is). */
export function coverChanging(weather: Weather, cover: Cover, serverNow: number): boolean {
	return (
		wetnessAt(weather, cover, serverNow) !== wetTarget(weather) ||
		snowAt(weather, cover, serverNow) !== snowTarget(weather)
	);
}

export const NO_COVER: Cover = { wet: 0, snow: 0, at: 0 };

type WithWeather = { weather: Weather & { cover?: Cover } };

/**
 * How wet the ground is at server time `serverNow`, from a world as a view carries it (its
 * weather's cover anchor; a world without one reads as long settled). The lightning and the
 * weather audio read this beside the renderer.
 */
export function wetnessOf(world: WithWeather, serverNow: number): number {
	return wetnessAt(world.weather, world.weather.cover ?? NO_COVER, serverNow);
}

/** Snow cover 0..1 at `serverNow`, from a world as a view carries it. */
export function snowOf(world: WithWeather, serverNow: number): number {
	return snowAt(world.weather, world.weather.cover ?? NO_COVER, serverNow);
}
