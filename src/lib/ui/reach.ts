// What the cell overlay shows (#285), pure: the cells the selected character can walk to with the
// movement it has left, the cells its aimed action reaches, a path and an area, packed into the
// overlay's RGBA texels (tabletop/cell-overlay.ts). Everything is limited to the cells the viewer
// has explored, so a preview never routes over or lights up unseen ground; the server still
// decides every move and action.

import { inActionRange } from '$lib/adventure/adventure';
import { inBounds, type GridPos, type SquareGrid } from '$lib/game/grid';
import { stepsFrom, type Blockers } from '$lib/game/objects';
import type { CellMask } from '$lib/game/visibility';
import type { Channel, OverlayCells } from '$lib/tabletop/cell-overlay';

/** How far a walk is previewed outside a fight, where movement is not counted. */
export const FREE_REACH = 12;

const OFFSET: Record<Channel, number> = { reach: 0, range: 1, path: 2, area: 3 };

export interface ReachInput {
	grid: SquareGrid;
	blocked: Blockers;
	/** Cells the viewer has explored, or null when everything counts (the GM, or no fog). */
	explored: CellMask | null;
	/** Where the selected character stands, to show its walk (players' own characters only). */
	walkFrom?: GridPos | null;
	/** Cells it may still move, or null outside a fight (`FREE_REACH`). */
	movesLeft?: number | null;
	/** Where its aimed action starts, and the action. */
	aimFrom?: GridPos | null;
	aim?: { range: number; target: 'enemy' | 'ally' | 'self' } | null;
	/** The previewed path's cells (#286) and areas (placement footprints). */
	path?: readonly GridPos[];
	area?: readonly GridPos[];
}

/** The overlay for `input`, or null when no channel has a cell (nothing to draw). */
export function overlayCells(input: ReachInput): OverlayCells | null {
	const { grid, explored } = input;
	const { width, height } = grid;
	const data = new Uint8Array(width * height * 4);
	let any = false;
	const known = (c: GridPos) =>
		inBounds(grid, c) && (!explored || explored[c.y * width + c.x] === 1);
	const mark = (channel: Channel, c: GridPos) => {
		if (!known(c)) return;
		data[(c.y * width + c.x) * 4 + OFFSET[channel]] = 255;
		any = true;
	};

	const from = input.walkFrom;
	if (from && known(from)) {
		const max = input.movesLeft ?? FREE_REACH;
		if (max > 0) {
			const steps = stepsFrom(grid, input.blocked, from, max, known);
			for (let i = 0; i < steps.length; i++)
				if (steps[i] > 0) mark('reach', { x: i % width, y: Math.floor(i / width) });
		}
	}
	const { aimFrom, aim } = input;
	if (aimFrom && aim && aim.target !== 'self') {
		const r = Math.max(1, aim.range);
		for (let y = aimFrom.y - r; y <= aimFrom.y + r; y++)
			for (let x = aimFrom.x - r; x <= aimFrom.x + r; x++) {
				const c = { x, y };
				if (
					(x !== aimFrom.x || y !== aimFrom.y) &&
					known(c) &&
					inActionRange(input.blocked, aimFrom, c, aim)
				)
					mark('range', c);
			}
	}
	for (const c of input.path ?? []) mark('path', c);
	for (const c of input.area ?? []) mark('area', c);
	return any ? { width, height, data } : null;
}
