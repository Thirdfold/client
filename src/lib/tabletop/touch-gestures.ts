// Touch and pen gestures (#288): pure maths and thresholds, no DOM. camera-input.ts turns two
// fingers' twist into a turn, picking.ts tells taps, double-taps and long-presses, and
// token-drag.ts takes its slop from here.

/** A mouse press that moves less than this is a click (picking.ts, #279). */
export const MOUSE_SLOP_PX = 6;
/** A finger or pen wobbles more. */
export const TOUCH_SLOP_PX = 12;
/** A press held this long without passing the slop inspects (hover that sticks). */
export const LONG_PRESS_MS = 450;
/** Two taps within this time and `DOUBLE_TAP_PX` focus. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;
/** Two clicks of a mouse (#279). */
export const DOUBLE_CLICK_MS = 350;
/** Two fingers must twist this far (radians, about 4 degrees) before the camera turns. */
export const TWIST_DEAD_RAD = 0.07;

export interface Point {
	x: number;
	y: number;
}

/** Click and drag slop by `PointerEvent.pointerType`: 6 px for a mouse, 12 for touch and pen. */
export function slopFor(pointerType: string): number {
	return pointerType === 'touch' || pointerType === 'pen' ? TOUCH_SLOP_PX : MOUSE_SLOP_PX;
}

export function pinchDistance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The angle from a to b on screen (y down, so positive turns clockwise). */
export function fingerAngle(a: Point, b: Point): number {
	return Math.atan2(b.y - a.y, b.x - a.x);
}

/** An angle difference folded into (-PI, PI]. */
export function wrapAngle(angle: number): number {
	const tau = 2 * Math.PI;
	const w = ((((angle + Math.PI) % tau) + tau) % tau) - Math.PI;
	return w === -Math.PI ? Math.PI : w;
}

/** Whether a tap at `to` at `toAt` ms follows a tap `from` as a double-tap (a mouse: double-click). */
export function isDoubleTap(
	from: Point & { at: number },
	to: Point,
	toAt: number,
	pointerType: string
): boolean {
	const mouse = pointerType === 'mouse';
	return (
		toAt - from.at < (mouse ? DOUBLE_CLICK_MS : DOUBLE_TAP_MS) &&
		Math.hypot(to.x - from.x, to.y - from.y) <= (mouse ? MOUSE_SLOP_PX : DOUBLE_TAP_PX)
	);
}

/**
 * The twist of two fingers: `move` gets their new positions and returns the angle (radians, clockwise
 * positive) to turn by now. Nothing until the total passes `TWIST_DEAD_RAD`, so a pinch's wobble
 * doesn't turn; after that every change passes, including the part that crossed the dead zone.
 */
export class Twist {
	private last = 0;
	private total = 0;
	private live = false;

	start(a: Point, b: Point): void {
		this.last = fingerAngle(a, b);
		this.total = 0;
		this.live = false;
	}

	move(a: Point, b: Point): number {
		const now = fingerAngle(a, b);
		const delta = wrapAngle(now - this.last);
		this.last = now;
		if (this.live) return delta;
		this.total += delta;
		if (Math.abs(this.total) <= TWIST_DEAD_RAD) return 0;
		this.live = true;
		return this.total;
	}
}
