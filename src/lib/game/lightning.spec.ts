import { describe, expect, it } from 'vitest';
import { countFlashes, type FrameSample } from '../tabletop/flash';
import {
	LIGHTNING_SLOT_MS,
	MAX_ENVELOPE_MS,
	PULSE_GAP_MS,
	THUNDER_MAX_MS,
	THUNDER_MIN_MS,
	lightningAt,
	nextStrike,
	strikeLight,
	strikeMs,
	strikeOfSlot,
	thunderBetween,
	type Strike,
	type WeatherNow
} from './lightning';
import type { Weather } from './world';

const storm = (seed: number, intensity = 1, since = 1_700_000_000_000): WeatherNow => ({
	kind: 'storm',
	intensity,
	seed,
	since
});
const strikes = (w: WeatherNow, slots: number): Strike[] =>
	Array.from({ length: slots }, (_, i) => strikeOfSlot(w, i)).filter((s): s is Strike => !!s);

describe('lightning schedule', () => {
	it('is deterministic for the same seed and time', () => {
		const w = storm(1234);
		const t = w.since + 123_456;
		expect(lightningAt(w, t)).toEqual(lightningAt({ ...w }, t));
		expect(strikes(w, 200)).toEqual(strikes({ ...w }, 200));
	});

	it('strikes at least 4 s apart, over 10k slots and many seeds', () => {
		for (const seed of [0, 1, 7, 99, 0xffffffff, 123456789, 42424242]) {
			for (const intensity of [0.3, 0.7, 1]) {
				const list = strikes(storm(seed, intensity), 10_000);
				expect(list.length).toBeGreaterThan(0);
				for (let i = 1; i < list.length; i++) {
					expect(list[i].at - list[i - 1].at).toBeGreaterThanOrEqual(4000);
				}
			}
		}
	});

	it('never has more than 3 pulses in any second', () => {
		for (const seed of [3, 55, 9001]) {
			const times = strikes(storm(seed), 5000).flatMap((s) =>
				Array.from({ length: s.pulses }, (_, i) => s.at + i * PULSE_GAP_MS)
			);
			let most = 0;
			for (let i = 0, j = 0; i < times.length; i++) {
				while (times[i] - times[j] >= 1000) j++;
				most = Math.max(most, i - j + 1);
			}
			expect(most).toBeLessThanOrEqual(3);
		}
	});

	it('keeps thunder 1-4 s behind and strikes in their slot', () => {
		const w = storm(77);
		for (let i = 0; i < 500; i++) {
			const s = strikeOfSlot(w, i);
			if (!s) continue;
			expect(s.thunderDelayMs).toBeGreaterThanOrEqual(THUNDER_MIN_MS);
			expect(s.thunderDelayMs).toBeLessThanOrEqual(THUNDER_MAX_MS);
			expect(s.at).toBeGreaterThanOrEqual(w.since + i * LIGHTNING_SLOT_MS);
			expect(s.at).toBeLessThan(w.since + i * LIGHTNING_SLOT_MS + 4000);
			expect(lightningAt(w, w.since + i * LIGHTNING_SLOT_MS + 7000)).toEqual(s);
		}
	});

	it('strikes only in a storm, and in rain above 0.8', () => {
		const kinds: Weather[] = ['none', 'snow', 'fog', 'ash', 'dust'];
		for (const kind of kinds)
			expect(strikes({ kind, intensity: 1, seed: 5, since: 0 }, 2000)).toEqual([]);
		expect(strikes({ kind: 'rain', intensity: 0.8, seed: 5, since: 0 }, 2000)).toEqual([]);
		expect(strikes({ kind: 'rain', intensity: 0.95, seed: 5, since: 0 }, 2000).length).toBeGreaterThan(
			0
		);
		expect(strikes(storm(5, 0), 2000)).toEqual([]);
	});

	it('strikes more often with more intensity', () => {
		expect(strikes(storm(9, 1), 4000).length).toBeGreaterThan(strikes(storm(9, 0.2), 4000).length);
	});

	it('finds the next strike and the thunder in a window', () => {
		const w = storm(11);
		const s = strikeOfSlot(w, 3) ?? strikeOfSlot(w, 4)!;
		expect(nextStrike(w, s.at - 1)!.at).toBeLessThanOrEqual(s.at);
		expect(nextStrike(w, s.at + strikeMs(s) - 1)).not.toBeNull();
		const heard = thunderBetween(w, s.at, s.at + 5000 + 1).filter((x) => x.at === s.at);
		expect(heard).toHaveLength(1);
		expect(thunderBetween(w, s.at + s.thunderDelayMs + 1, s.at + s.thunderDelayMs + 2)).toEqual([]);
		// Windows tile: every strike's thunder falls in exactly one.
		const all = strikes(w, 60).length;
		let sum = 0;
		for (let t = w.since; t < w.since + 60 * LIGHTNING_SLOT_MS + 6000; t += 3000)
			sum += thunderBetween(w, t, t + 3000).length;
		expect(sum).toBe(all);
	});
});

describe('lightning light and photosensitivity', () => {
	/** Frames at 120 Hz of a dim scene lit by the storm, luminance 0.05 + 0.4 × strength. */
	const frames = (w: WeatherNow, slow: boolean, ms: number): FrameSample[] => {
		const list = strikes(w, Math.ceil(ms / LIGHTNING_SLOT_MS) + 1);
		const out: FrameSample[] = [];
		for (let t = 0; t < ms; t += 1000 / 120) {
			const now = w.since + t;
			let k = 0;
			for (const s of list) k = Math.max(k, strikeLight(s, now - s.at, slow));
			out.push({ t, luminance: 0.05 + 0.4 * k, red: 0.33 });
		}
		return out;
	};

	it('shows at most 3 flashes in any second, normal or reduced', () => {
		for (const seed of [1, 2, 3]) {
			for (const slow of [false, true]) {
				const { flashes } = countFlashes(frames(storm(seed), slow, 120_000));
				expect(flashes).toBeLessThanOrEqual(3);
			}
		}
	});

	it('Reduce flashing is one slow, dim pulse', () => {
		const s: Strike = { at: 0, pulses: 2, azimuth: 0, thunderDelayMs: 2000 };
		let peak = 0;
		for (let t = -10; t < MAX_ENVELOPE_MS + 10; t += 5)
			peak = Math.max(peak, strikeLight(s, t, true));
		expect(peak).toBeLessThanOrEqual(0.25);
		expect(strikeLight(s, MAX_ENVELOPE_MS + 1, true)).toBe(0);
		const { fastestMs } = countFlashes(frames(storm(4), true, 60_000));
		expect(fastestMs).toBeGreaterThanOrEqual(500);
	});

	it('normal pulses rise and fall inside their gap', () => {
		const s: Strike = { at: 0, pulses: 2, azimuth: 0, thunderDelayMs: 2000 };
		expect(strikeLight(s, 0, false)).toBe(0);
		expect(strikeLight(s, PULSE_GAP_MS - 1, false)).toBeLessThan(0.05);
		expect(strikeLight(s, 15, false)).toBeGreaterThan(0.6);
		expect(strikeLight(s, PULSE_GAP_MS + 15, false)).toBeGreaterThan(0.6);
		expect(strikeLight(s, strikeMs(s) + 1, false)).toBe(0);
	});
});
