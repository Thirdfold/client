import { describe, expect, it } from 'vitest';
import { CLICK_SLOP_PX } from './picking';
import { dragged, slopFor } from './token-drag';

describe('drag slop (#287)', () => {
	it('is 6 px for a mouse and 12 for a finger or pen', () => {
		expect(slopFor('mouse')).toBe(6);
		expect(slopFor('pen')).toBe(12);
		expect(slopFor('touch')).toBe(12);
		// A mouse drag starts exactly where a click stops being one.
		expect(slopFor('mouse')).toBe(CLICK_SLOP_PX);
	});

	it('is a drag only past the slop', () => {
		const from = { x: 100, y: 100 };
		expect(dragged(from, { x: 106, y: 100 }, 'mouse')).toBe(false);
		expect(dragged(from, { x: 107, y: 100 }, 'mouse')).toBe(true);
		expect(dragged(from, { x: 108, y: 106 }, 'touch')).toBe(false);
		expect(dragged(from, { x: 109, y: 109 }, 'touch')).toBe(true);
	});
});
