// Dragging a mini (#287): pick it up with the left button or one finger, carry it over the table and
// set it down on a cell. The press is heard before the camera controls' own (a capture listener, as
// camera-input.ts's): if the room page says the token is draggable the controls are switched off for
// this gesture and the pointer captured, so the drag keeps being heard off the canvas. Past a slop
// (6 px for a mouse, 12 for a finger or pen) the drag begins: the mini lifts (tokens.ts), the hovered cell
// is reported as in any hover (the room page draws the path and ghost, #286), and the release
// reports the cell it is over. The room page sends the move; nothing here moves anything. Escape,
// a right-button press, a second finger, a lost pointer, or a release off the canvas (over a panel)
// let go with no cell. A press and release within the slop is still a click (picking.ts).

import { pickKey, type Picker } from './picking';
import type { TabletopEvents } from './types';
import { slopFor } from './touch-gestures';

export { slopFor };

/** Whether a pointer that went down at `from` and is now at `to` has dragged. */
export function dragged(
	from: { x: number; y: number },
	to: { x: number; y: number },
	pointerType: string
): boolean {
	return Math.hypot(to.x - from.x, to.y - from.y) > slopFor(pointerType);
}

interface Press {
	tokenId: string;
	pointerId: number;
	pointerType: string;
	x: number;
	y: number;
	/** The drag has begun (past the slop). */
	carrying: boolean;
}

export class TokenDrag {
	private press: Press | null = null;
	private hoverKey = '';
	/** A right-button press let go of a drag: its context menu is not wanted either. */
	private swallowMenu = false;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly picker: Picker,
		private readonly events: TabletopEvents,
		private readonly controls: { enabled: boolean }
	) {
		// Capture: before the controls' own listener, on the same element (camera-input.ts runs first).
		canvas.addEventListener('pointerdown', this.onDown, { capture: true });
		canvas.addEventListener('pointermove', this.onMove);
		canvas.addEventListener('pointerup', this.onUp);
		canvas.addEventListener('pointercancel', this.onCancel);
		canvas.addEventListener('contextmenu', this.onMenu);
		window.addEventListener('keydown', this.onKey);
	}

	dispose(): void {
		this.finish(null);
		const { canvas } = this;
		canvas.removeEventListener('pointerdown', this.onDown, { capture: true });
		canvas.removeEventListener('pointermove', this.onMove);
		canvas.removeEventListener('pointerup', this.onUp);
		canvas.removeEventListener('pointercancel', this.onCancel);
		canvas.removeEventListener('contextmenu', this.onMenu);
		window.removeEventListener('keydown', this.onKey);
	}

	private onDown = (e: PointerEvent): void => {
		this.swallowMenu = false;
		const press = this.press;
		if (press) {
			// A right button or a second finger lets go of the drag.
			if (press.carrying && e.button === 2) {
				this.swallowMenu = true;
				e.stopImmediatePropagation(); // not a camera pan too
			}
			if (press.carrying || e.pointerId !== press.pointerId || e.button === 2) this.finish(null);
			return;
		}
		if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return;
		const pick = this.picker.at(e);
		if (!pick.tokenId || !this.events.onDragStart?.(pick)) return;
		this.controls.enabled = false;
		this.canvas.setPointerCapture(e.pointerId);
		this.press = {
			tokenId: pick.tokenId,
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			carrying: false
		};
	};

	private onMove = (e: PointerEvent): void => {
		const press = this.press;
		if (!press || e.pointerId !== press.pointerId) return;
		if (!press.carrying) {
			if (!dragged(press, { x: e.clientX, y: e.clientY }, press.pointerType)) return;
			press.carrying = true;
			this.picker.layers.tokens.api.setCarried(press.tokenId);
		}
		// The hover goes on while the button is down: the room page draws the path to this cell.
		const pick = this.picker.at(e);
		const key = pickKey(pick);
		if (key === this.hoverKey) return;
		this.hoverKey = key;
		this.events.onHover(pick);
	};

	private onUp = (e: PointerEvent): void => {
		const press = this.press;
		if (!press || e.pointerId !== press.pointerId) return;
		// Off the canvas (over a panel) is a cancel; the pointer capture keeps the events coming.
		const over = document.elementFromPoint(e.clientX, e.clientY) === this.canvas;
		this.finish(press.carrying && over ? this.picker.at(e).cell : null);
	};

	private onCancel = (e: PointerEvent): void => {
		if (this.press && e.pointerId === this.press.pointerId) this.finish(null);
	};

	private onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.press?.carrying) this.finish(null);
	};

	private onMenu = (e: Event): void => {
		if (this.press?.carrying || this.swallowMenu) e.preventDefault();
		this.swallowMenu = false;
	};

	/** Ends the gesture: the mini is set down, the controls come back, the room page is told. */
	private finish(cell: { x: number; y: number } | null): void {
		const press = this.press;
		if (!press) return;
		this.press = null;
		this.hoverKey = '';
		this.controls.enabled = true;
		try {
			this.canvas.releasePointerCapture(press.pointerId);
		} catch {
			// Already released.
		}
		if (press.carrying) this.picker.layers.tokens.api.setCarried(null);
		// A press that never dragged is a click, which picking.ts reports; this only lets go.
		this.events.onDrop?.(press.tokenId, press.carrying ? cell : null);
	}
}
