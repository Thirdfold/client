// Lightning as a pure, seeded schedule (#323). The server picks the weather's `seed` and stamps
// its `since`; every client works out the same strikes from those and the server's clock
// (`RoomConnection.serverTime()`), so they see and hear a strike together with no traffic. Time
// is cut into slots of LIGHTNING_SLOT_MS counted from `since`; a slot strikes or not by a hash of
// (seed, slot) against the weather's intensity, and a strike falls in the slot's first
// STRIKE_WINDOW_MS, so two strikes are always at least SLOT - WINDOW = 4 s apart. A strike is one
// or two pulses PULSE_GAP_MS apart (so any second holds at most 3 flashes, WCAG 2.3.1). Presentation
// only: nothing here reaches `room.flashUntil`, the rules' light, fog or what enemies detect.

import type { WorldLook } from './world';

export const LIGHTNING_SLOT_MS = 8000;
/** A strike begins within the slot's first this long. */
export const STRIKE_WINDOW_MS = 4000;
export const PULSE_GAP_MS = 120;
/** A pulse: a near-instant rise and a fall (normal flashing), both inside PULSE_GAP_MS. */
export const PULSE_RISE_MS = 15;
export const PULSE_FALL_MS = 85;
/** Thunder follows its strike by this long (the strike's distance). */
export const THUNDER_MIN_MS = 1000;
export const THUNDER_MAX_MS = 4000;
/** Plain rain strikes only above this intensity. */
export const RAIN_STRIKES_ABOVE = 0.8;

export type WeatherNow = Pick<WorldLook['weather'], 'kind' | 'intensity' | 'seed' | 'since'>;

export interface Strike {
	/** When the first pulse begins, ms since epoch (server time). */
	at: number;
	/** 1 or 2, PULSE_GAP_MS apart. */
	pulses: 1 | 2;
	/** Which way it lies, radians, 0 to 2π. */
	azimuth: number;
	/** How long after `at` thunder is heard, ms. */
	thunderDelayMs: number;
}

/** A uint32 from two ints (an integer finaliser, murmur-style). */
function hash(a: number, b: number): number {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/** The share of slots that strike, 0 when this weather never does. */
export function strikeShare(weather: WeatherNow): number {
	if (weather.kind === 'storm') return weather.intensity > 0 ? 0.25 + 0.6 * weather.intensity : 0;
	if (weather.kind === 'rain' && weather.intensity > RAIN_STRIKES_ABOVE)
		return (weather.intensity - RAIN_STRIKES_ABOVE) * 2.5;
	return 0;
}

/** The strike of slot `slot` (counted from `since`), or null if it does not strike. */
export function strikeOfSlot(weather: WeatherNow, slot: number): Strike | null {
	const share = strikeShare(weather);
	if (share <= 0 || slot < 0) return null;
	const h = hash(weather.seed, slot);
	if ((h & 0xffff) / 0x10000 >= share) return null;
	const g = hash(h, 1);
	return {
		at: weather.since + slot * LIGHTNING_SLOT_MS + (g % STRIKE_WINDOW_MS),
		pulses: (g >>> 12) & 1 ? 2 : 1,
		azimuth: ((g >>> 16) / 0x10000) * Math.PI * 2,
		thunderDelayMs: THUNDER_MIN_MS + (hash(g, 2) % (THUNDER_MAX_MS - THUNDER_MIN_MS + 1))
	};
}

/** The strike of the slot that holds `serverTime` (it may lie before or after it), or null. */
export function lightningAt(weather: WeatherNow, serverTime: number): Strike | null {
	return strikeOfSlot(weather, Math.floor((serverTime - weather.since) / LIGHTNING_SLOT_MS));
}

/** How long a strike lights the sky: its last pulse's end. */
export const strikeMs = (strike: Strike): number =>
	(strike.pulses - 1) * PULSE_GAP_MS + PULSE_RISE_MS + PULSE_FALL_MS;

/** How long a strike's light lasts: its pulses', or Reduce flashing's single slow pulse. */
export const lightMs = (strike: Strike, slow: boolean): number =>
	slow ? MAX_ENVELOPE_MS : strikeMs(strike);

/** The first strike whose light has not ended by `serverTime` (within `slots` slots), or null. */
export function nextStrike(
	weather: WeatherNow,
	serverTime: number,
	slow = false,
	slots = 12
): Strike | null {
	const first = Math.max(0, Math.floor((serverTime - weather.since) / LIGHTNING_SLOT_MS));
	for (let slot = first; slot < first + slots; slot++) {
		const s = strikeOfSlot(weather, slot);
		if (s && s.at + lightMs(s, slow) > serverTime) return s;
	}
	return null;
}

/** Whether a normal-flashing pulse of the weather's begins in [from, to) (server time). */
export function pulseBetween(weather: WeatherNow, from: number, to: number): boolean {
	const first = Math.max(0, Math.floor((from - PULSE_GAP_MS - weather.since) / LIGHTNING_SLOT_MS));
	const last = Math.floor((to - weather.since) / LIGHTNING_SLOT_MS);
	for (let slot = first; slot <= last; slot++) {
		const s = strikeOfSlot(weather, slot);
		for (let i = 0; s && i < s.pulses; i++) {
			const at = s.at + i * PULSE_GAP_MS;
			if (at >= from && at < to) return true;
		}
	}
	return false;
}

/** Strikes whose thunder is heard in [from, to) (server time), in order. */
export function thunderBetween(weather: WeatherNow, from: number, to: number): Strike[] {
	const out: Strike[] = [];
	const first = Math.floor((from - THUNDER_MAX_MS - weather.since) / LIGHTNING_SLOT_MS);
	const last = Math.floor((to - weather.since) / LIGHTNING_SLOT_MS);
	for (let slot = Math.max(0, first); slot <= last; slot++) {
		const s = strikeOfSlot(weather, slot);
		if (s && s.at + s.thunderDelayMs >= from && s.at + s.thunderDelayMs < to) out.push(s);
	}
	return out;
}

/** Reduce flashing: one slow pulse (rise 600 ms, fall 1500 ms) at a quarter of the strength. */
export const SLOW_RISE_MS = 600;
export const SLOW_FALL_MS = 1500;
export const SLOW_STRENGTH = 0.25;
/** Full strength of a normal pulse, as the flash's 0-1 strength (the Bell's flash is 1). */
export const PULSE_STRENGTH = 0.7;
/** The longest a strike's light lasts (the slow variant's). */
export const MAX_ENVELOPE_MS = SLOW_RISE_MS + SLOW_FALL_MS;

/**
 * The strike's light `t` ms after its `at`, as a flash strength (0 none): each pulse rises over
 * PULSE_RISE_MS and falls over PULSE_FALL_MS; with `slow` (Reduce flashing) a single pulse rises
 * over SLOW_RISE_MS and falls over SLOW_FALL_MS at SLOW_STRENGTH, however many pulses it has.
 */
export function strikeLight(strike: Strike, t: number, slow: boolean): number {
	if (slow) {
		if (t <= 0 || t >= SLOW_RISE_MS + SLOW_FALL_MS) return 0;
		const k = t < SLOW_RISE_MS ? t / SLOW_RISE_MS : 1 - (t - SLOW_RISE_MS) / SLOW_FALL_MS;
		return k * SLOW_STRENGTH;
	}
	let best = 0;
	for (let i = 0; i < strike.pulses; i++) {
		const p = t - i * PULSE_GAP_MS;
		if (p <= 0 || p >= PULSE_RISE_MS + PULSE_FALL_MS) continue;
		best = Math.max(
			best,
			p < PULSE_RISE_MS ? p / PULSE_RISE_MS : 1 - (p - PULSE_RISE_MS) / PULSE_FALL_MS
		);
	}
	return best * PULSE_STRENGTH;
}
