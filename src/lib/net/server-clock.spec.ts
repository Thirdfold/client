import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD, timeNow, type WorldLook } from '$lib/game/world';
import { OFFSET_SAMPLES, offsetFrom, sampleOffset, serverTimeAt, withSample } from './server-clock';

/** A client whose clock is `skew` ms ahead of the server's, with `latency` ms each way. */
function welcomeSample(serverNow: number, skew: number, latency: number): number {
	const sentAt = serverNow - latency + skew; // when the entry message left, on the client's clock
	const receivedAt = serverNow + latency + skew;
	return sampleOffset(serverNow, sentAt, receivedAt);
}

describe('the server clock offset', () => {
	it('compensates for half the round trip', () => {
		// Server at 10_000 when it sent; the client sent at 1000 and heard at 1200 on a clock far behind.
		const offset = sampleOffset(10_000, 1000, 1200);
		expect(serverTimeAt(1200, offset)).toBe(10_100);
	});

	it('is exact for a symmetric round trip whatever the skew', () => {
		for (const skew of [-5000, 0, 5000, 123_456]) {
			const offset = offsetFrom([welcomeSample(1_700_000_000_000, skew, 40)]);
			expect(serverTimeAt(1_700_000_000_040 + skew, offset)).toBe(1_700_000_000_040);
		}
	});

	it('takes the median, so a slow welcome is ignored', () => {
		const good = welcomeSample(50_000, 0, 20);
		const slow = sampleOffset(50_000, 0, 4000); // a stalled create: wildly off
		expect(offsetFrom([good, slow, good])).toBe(good);
		expect(offsetFrom([good, good, slow, good, good])).toBe(good);
		expect(offsetFrom([2, 4])).toBe(3);
		expect(offsetFrom([])).toBe(0);
	});

	it('keeps the last few samples', () => {
		let samples: number[] = [];
		for (let i = 0; i < 9; i++) samples = withSample(samples, i);
		expect(samples).toEqual([4, 5, 6, 7, 8]);
		expect(samples).toHaveLength(OFFSET_SAMPLES);
	});

	it('gives two clients 5 s apart the same schedule within 50 ms', () => {
		const server = 1_700_000_000_000;
		// A flash every 7 s from the weather's `since`, as a later effect would schedule it.
		const since = server - 20_000;
		const flashAt = (serverTime: number) => since + Math.ceil((serverTime - since) / 7000) * 7000;
		const world: WorldLook = { ...DEFAULT_WORLD, time: 1250, rate: 6 };
		const clients = [-2500, 2500].map((skew) => {
			// Each client estimates from three welcomes (create, then two resumes) with jitter.
			const offset = offsetFrom([
				welcomeSample(server, skew, 35),
				welcomeSample(server + 60_000, skew, 80),
				welcomeSample(server + 120_000, skew, 30)
			]);
			const localNow = server + 130_000 + skew; // 130 s later on this client's clock
			const serverNow = serverTimeAt(localNow, offset);
			return {
				flash: flashAt(serverNow),
				hour: timeNow(world, server + 100_000, serverNow)
			};
		});
		expect(Math.abs(clients[0].flash - clients[1].flash)).toBeLessThan(50);
		expect(Math.abs(clients[0].hour - clients[1].hour)).toBeLessThan(0.01);
	});
});
