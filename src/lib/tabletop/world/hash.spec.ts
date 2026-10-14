import { describe, expect, it } from 'vitest';
import { keyHash, seededRandom } from './hash';

describe('keyHash', () => {
	it('is FNV-1a, unsigned', () => {
		expect(keyHash('')).toBe(0x811c9dc5);
		expect(keyHash('a')).toBe(0xe40c292c);
		expect(keyHash('foobar')).toBe(0xbf9cf968);
	});

	it('tells ids apart', () => {
		expect(keyHash('prop-1')).not.toBe(keyHash('prop-2'));
	});
});

describe('seededRandom', () => {
	it('repeats for a seed and stays in [0, 1)', () => {
		const a = seededRandom(7);
		const b = seededRandom(7);
		for (let i = 0; i < 50; i++) {
			const v = a();
			expect(v).toBe(b());
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});
