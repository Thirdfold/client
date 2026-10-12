// Camera input beyond the controls' own (#279): Alt+left-drag turns, Ctrl+right-drag
// raises the pivot a storey at a time, held keys pan and turn on the frame clock,
// snaps turn 45 degrees, and a trackpad's sideways scroll pans. Left-drag never moves
// the camera (the controls' left button is null); right pans and middle turns there.
// Maths is camera-rig.ts's (panStep, snapAzimuth), tested in Node. Touch (#288): the controls'
// one-finger pan and pinch stay; two fingers also turn by their twist (touch-gestures.ts), and a
// pen, which the controls treat as the null left button, pans empty ground through `pan`.

import { MOUSE, TOUCH } from 'three/webgpu';
import type { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import {
	panStep,
	snapAzimuth,
	SNAP_TAU_MS,
	STOREY_DRAG_PX,
	TURN_PER_SECOND,
	type CameraHold
} from './camera-rig';
import { slopFor, Twist, type Point } from './touch-gestures';

/** A press that moves less than this is a click, not a camera drag (as picking.ts). */
const DRAG_PX = 6;
/** A sideways wheel scroll under this is a mouse wheel's noise, not a trackpad. */
const WHEEL_PAN_PX = 4;

export interface InputHooks {
	/** Asks for a frame. */
	request(): void;
	/** The viewer took hold: a shot, a move or a set pose gives way. */
	hold(): void;
	/** Raises (+) or lowers (-) the pivot by storeys. */
	storey(storeys: number): void;
	/** The viewer's first pan or turn (never a shot or a programmatic move). */
	moved(): void;
	reduced(): boolean;
}

export class CameraInput {
	private held = new Set<CameraHold>();
	/** Radians of an eased snap turn still to go. */
	private snap = 0;
	private drag: { mode: 'turn' | 'height'; x: number; y: number; px: number } | null = null;
	/** A middle or right press that may become a pan or turn (reported once it drags). */
	private press: { x: number; y: number } | null = null;
	private told = false;
	/** Touch pointers down, by id, for the two-finger twist (#288). */
	private fingers = new Map<number, Point>();
	private twist = new Twist();
	/** A pen press that pans once it passes the slop (unless a mini drag took the controls). */
	private pen: { id: number; x: number; y: number; panning: boolean } | null = null;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly controls: MapControls,
		private readonly hooks: InputHooks
	) {
		controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN };
		controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
		controls.zoomToCursor = true;
		// Capture: before the controls' own listener, on the same element.
		canvas.addEventListener('pointerdown', this.onDown, { capture: true });
		canvas.addEventListener('pointermove', this.onMove);
		canvas.addEventListener('pointerup', this.onUp);
		canvas.addEventListener('pointercancel', this.onUp);
		canvas.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
	}

	/** A pan or turn key went down or up. */
	hold(key: CameraHold, down: boolean): void {
		if (!down) return void this.held.delete(key);
		this.held.add(key);
		this.hooks.hold();
		this.tell();
		this.hooks.request();
	}

	release(): void {
		this.held.clear();
	}

	/** Turns to the next 45 degrees, left (1) or right (-1): eased, or at once under reduced motion. */
	snapTurn(dir: 1 | -1): void {
		this.hooks.hold();
		this.tell();
		const theta = this.theta() + this.snap;
		this.snap = snapAzimuth(theta, dir) - this.theta();
		this.hooks.request();
	}

	/**
	 * Before the controls' update each frame: the held keys' and the snap's share of `dtMs`.
	 * Returns true while either still moves the camera (the scheduler's ACTIVE frames).
	 */
	tick(dtMs: number): boolean {
		const { object: camera, target } = this.controls;
		if (this.held.size) {
			const dx = target.x - camera.position.x;
			const dz = target.z - camera.position.z;
			const step = panStep(this.held, { x: dx, z: dz }, camera.position.distanceTo(target), dtMs);
			camera.position.x += step.x;
			camera.position.z += step.z;
			target.x += step.x;
			target.z += step.z;
			const turn = Number(this.held.has('turn_left')) - Number(this.held.has('turn_right'));
			if (turn) this.turn((turn * TURN_PER_SECOND * dtMs) / 1000);
		}
		if (this.snap !== 0) {
			const by = this.hooks.reduced() ? this.snap : this.snap * (1 - Math.exp(-dtMs / SNAP_TAU_MS));
			this.turn(by);
			this.snap = Math.abs(this.snap - by) < 1e-3 ? 0 : this.snap - by;
			if (this.snap === 0) this.hooks.request();
		}
		return this.held.size > 0 || this.snap !== 0;
	}

	dispose(): void {
		this.canvas.removeEventListener('pointerdown', this.onDown, { capture: true });
		this.canvas.removeEventListener('pointermove', this.onMove);
		this.canvas.removeEventListener('pointerup', this.onUp);
		this.canvas.removeEventListener('pointercancel', this.onUp);
		this.canvas.removeEventListener('wheel', this.onWheel, { capture: true });
	}

	/** The camera's azimuth round the pivot (`Spherical.theta`). */
	private theta(): number {
		const { object: camera, target } = this.controls;
		return Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
	}

	/** Turns the camera round the pivot by `angle` (positive: left, the camera moves right). */
	private turn(angle: number): void {
		const { object: camera, target } = this.controls;
		const x = camera.position.x - target.x;
		const z = camera.position.z - target.z;
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		camera.position.x = target.x + x * c + z * s;
		camera.position.z = target.z + z * c - x * s;
	}

	private tell(): void {
		if (this.told) return;
		this.told = true;
		this.hooks.moved();
	}

	private onDown = (e: PointerEvent): void => {
		if (e.pointerType === 'touch') {
			this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			this.startTwist();
		} else if (e.pointerType === 'pen' && e.button === 0) {
			this.pen = { id: e.pointerId, x: e.clientX, y: e.clientY, panning: false };
		}
		const turn = e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey;
		const height = e.button === 2 && e.ctrlKey;
		this.press =
			e.button === 1 || (e.button === 2 && !height) ? { x: e.clientX, y: e.clientY } : null;
		if (!turn && !height) return;
		// Ours: neither the controls nor picking see it.
		e.stopImmediatePropagation();
		e.preventDefault();
		this.hooks.hold();
		this.controls.enabled = false;
		this.canvas.setPointerCapture(e.pointerId);
		this.drag = { mode: turn ? 'turn' : 'height', x: e.clientX, y: e.clientY, px: 0 };
		this.press = turn ? { x: e.clientX, y: e.clientY } : null;
	};

	private startTwist(): void {
		const [a, b] = [...this.fingers.values()];
		if (this.fingers.size === 2) this.twist.start(a, b);
	}

	/** The twist of two fingers turns the camera (#288); a pen pans empty ground. */
	private touchMove(e: PointerEvent): void {
		const finger = this.fingers.get(e.pointerId);
		if (finger) {
			finger.x = e.clientX;
			finger.y = e.clientY;
			if (this.fingers.size !== 2) return;
			const [a, b] = [...this.fingers.values()];
			// Fingers turning clockwise carry the ground with them: the camera goes the other way.
			const turn = this.twist.move(a, b);
			if (turn) {
				this.controls.rotateLeft(-turn);
				this.hooks.request();
				this.tell();
			}
			return;
		}
		const pen = this.pen;
		if (!pen || pen.id !== e.pointerId) return;
		if (!this.controls.enabled) return void (this.pen = null); // a mini drag has it
		if (!pen.panning && Math.hypot(e.clientX - pen.x, e.clientY - pen.y) <= slopFor('pen')) return;
		this.controls.pan(e.clientX - pen.x, e.clientY - pen.y);
		pen.x = e.clientX;
		pen.y = e.clientY;
		pen.panning = true;
		this.hooks.hold();
		this.hooks.request();
		this.tell();
	}

	private onMove = (e: PointerEvent): void => {
		this.touchMove(e);
		const p = this.press;
		if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_PX) {
			this.press = null;
			this.tell();
		}
		const d = this.drag;
		if (!d) return;
		const dx = e.clientX - d.x;
		const dy = e.clientY - d.y;
		d.x = e.clientX;
		d.y = e.clientY;
		if (d.mode === 'turn') {
			const k = (2 * Math.PI) / this.canvas.clientHeight;
			this.controls.rotateLeft(dx * k);
			this.controls.rotateUp(dy * k);
			return;
		}
		// Dragging up raises the pivot, a storey for each STOREY_DRAG_PX.
		d.px -= dy;
		const whole = Math.trunc(d.px / STOREY_DRAG_PX);
		if (whole === 0) return;
		d.px -= whole * STOREY_DRAG_PX;
		this.hooks.storey(whole);
	};

	private onUp = (e: PointerEvent): void => {
		this.press = null;
		if (this.fingers.delete(e.pointerId)) this.startTwist();
		if (this.pen?.id === e.pointerId) this.pen = null;
		if (!this.drag) return;
		this.drag = null;
		this.controls.enabled = true;
		try {
			this.canvas.releasePointerCapture(e.pointerId);
		} catch {
			// Already released.
		}
	};

	/** A trackpad's two-finger scroll sends pixels with a sideways part: that pans. */
	private onWheel = (e: WheelEvent): void => {
		if (e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaX) < WHEEL_PAN_PX) return;
		e.stopImmediatePropagation();
		e.preventDefault();
		this.hooks.hold();
		this.controls.pan(-e.deltaX, -e.deltaY);
		this.tell();
		this.hooks.request();
	};
}
