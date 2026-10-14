// The server's clock as a client sees it (#322). Client clocks differ by seconds, so anything that
// must agree across clients (the running clock, lightning, wetness) runs from server time:
// each welcome carries the server's `Date.now()`, one sample of the offset, and the median of the
// last few is used. Pure, so it is tested in Node.

/** How many welcomes (the first, then one per resume) the offset is estimated from. */
export const OFFSET_SAMPLES = 5;

/**
 * One sample: the server's time when it sent the welcome, taken to be half the round trip ago
 * (`sentAt` when the entry message left, `receivedAt` when the welcome arrived, both local).
 * Add the result to a local time to get server time.
 */
export function sampleOffset(serverNow: number, sentAt: number, receivedAt: number): number {
	return serverNow + (receivedAt - sentAt) / 2 - receivedAt;
}

/** `samples` with `sample` added, keeping the last `OFFSET_SAMPLES`. */
export function withSample(samples: readonly number[], sample: number): number[] {
	return [...samples, sample].slice(-OFFSET_SAMPLES);
}

/** The median of the samples (a slow round trip is an outlier it ignores); 0 with none. */
export function offsetFrom(samples: readonly number[]): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Server time (ms since epoch) at local time `now`. */
export function serverTimeAt(now: number, offset: number): number {
	return now + offset;
}
