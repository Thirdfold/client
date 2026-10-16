import { describe, expect, it } from 'vitest';
import {
	DOUBLE_TAP_MS,
	TWIST_DEAD_RAD,
	Twist,
	fingerAngle,
	isDoubleTap,
	pinchDistance,
	slopFor,
	wrapAngle
} from './touch-gestures';

const at = (angle: number) => ({ x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
const origin = { x: 0, y: 0 };

describe('touch gestures (#288)', () => {
	it('slop is 6 px for a mouse and 12 for touch and pen', () => {
		expect(slopFor('mouse')).toBe(6);
		expect(slopFor('touch')).toBe(12);
		expect(slopFor('pen')).toBe(12);
	});

	it('measures the pinch and the finger angle', () => {
		expect(pinchDistance(origin, { x: 3, y: 4 })).toBe(5);
		expect(fingerAngle(origin, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
	});

	it('wraps angles', () => {
		expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
		expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
		expect(wrapAngle(0.3)).toBeCloseTo(0.3);
	});

	it('tells a double-tap by time and distance', () => {
		const first = { x: 100, y: 100, at: 1000 };
		expect(isDoubleTap(first, { x: 120, y: 110 }, 1000 + DOUBLE_TAP_MS - 1, 'touch')).toBe(true);
		expect(isDoubleTap(first, { x: 120, y: 110 }, 1000 + DOUBLE_TAP_MS, 'touch')).toBe(false);
		expect(isDoubleTap(first, { x: 130, y: 100 }, 1100, 'touch')).toBe(false);
		// A mouse keeps its 6 px.
		expect(isDoubleTap(first, { x: 110, y: 100 }, 1100, 'mouse')).toBe(false);
	});

	it('twists only past the dead zone, then passes every change', () => {
		const twist = new Twist();
		twist.start(origin, at(0));
		expect(twist.move(origin, at(TWIST_DEAD_RAD / 2))).toBe(0);
		expect(twist.move(origin, at(TWIST_DEAD_RAD * 0.9))).toBe(0);
		// Crossing the dead zone hands over everything so far, then deltas.
		expect(twist.move(origin, at(0.2))).toBeCloseTo(0.2);
		expect(twist.move(origin, at(0.25))).toBeCloseTo(0.05);
		expect(twist.move(origin, at(0.2))).toBeCloseTo(-0.05);
	});

	it('twists across the +-PI seam without a jump', () => {
		const twist = new Twist();
		twist.start(origin, at(Math.PI - 0.1));
		expect(twist.move(origin, at(-Math.PI + 0.1))).toBeCloseTo(0.2);
	});
});
