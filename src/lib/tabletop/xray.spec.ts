import { describe, expect, it } from 'vitest';
import { hasFlag, MINI_FLAG, miniFlags } from './xray';

const mini = { level: 5, cutLevel: 5, kept: false, fallen: false, hidden: false };

describe('miniFlags', () => {
	it('cuts a mini whose floor is at or above the cut, unless it is kept', () => {
		expect(hasFlag(miniFlags(mini), MINI_FLAG.cut)).toBe(true);
		expect(hasFlag(miniFlags({ ...mini, level: 10 }), MINI_FLAG.cut)).toBe(true);
		expect(miniFlags({ ...mini, level: 4 })).toBe(0);
		expect(miniFlags({ ...mini, kept: true })).toBe(0);
		expect(miniFlags({ ...mini, cutLevel: null })).toBe(0);
	});

	it('gives no silhouette to a cut, fallen or GM-hidden mini', () => {
		const none = (s: Partial<typeof mini>) =>
			hasFlag(miniFlags({ ...mini, cutLevel: null, ...s }), MINI_FLAG.noXray);
		expect(none({})).toBe(false);
		expect(none({ fallen: true })).toBe(true);
		expect(none({ hidden: true })).toBe(true);
		expect(none({ cutLevel: 5 })).toBe(true);
		expect(hasFlag(miniFlags(mini), MINI_FLAG.noXray)).toBe(true);
	});

	it('reads bits as the shaders do', () => {
		expect(hasFlag(3, 1) && hasFlag(3, 2)).toBe(true);
		expect(hasFlag(2, 1)).toBe(false);
		// The bases carry them four up, over their ring's notch (1) and double (2) bits.
		expect(hasFlag(1 + 2 + 4 * 2, 4 * MINI_FLAG.noXray)).toBe(true);
		expect(hasFlag(1 + 2 + 4 * 2, 4 * MINI_FLAG.cut)).toBe(false);
	});
});
