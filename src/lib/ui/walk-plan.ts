// The walk a hovered cell would cost (#286), pure: the path the server's `findPath` would charge for,
// read back from `stepsFrom`'s distances over the cells the viewer has explored (no second search),
// split at the movement left, and the step count to show. A preview only: the server decides.

import { inBounds, type GridPos, type SquareGrid } from '$lib/game/grid';
import { stepsFrom, type Blockers } from '$lib/game/objects';
import { pathFromSteps } from '$lib/game/path-steps';
import type { CellMask } from '$lib/game/visibility';

export interface WalkPlan {
	/** From the mover's own cell to the hovered one: the ribbon's points. */
	cells: GridPos[];
	/** Steps within the movement left (all of them outside a fight). */
	within: number;
	/** 'n steps' outside a fight, 'n / left' in one. */
	label: string;
}

export interface WalkInput {
	grid: SquareGrid;
	blocked: Blockers;
	/** Cells the viewer has explored, or null when everything counts (fog off). */
	explored: CellMask | null;
	from: GridPos;
	to: GridPos;
	/** Cells the mover may still move this round, or null outside a fight. */
	movesLeft: number | null;
}

/** The plan for walking `from` to `to`, or null when there is no known way (or nowhere to go). */
export function walkPlan({
	grid,
	blocked,
	explored,
	from,
	to,
	movesLeft
}: WalkInput): WalkPlan | null {
	const known = (c: GridPos) =>
		inBounds(grid, c) && (!explored || explored[c.y * grid.width + c.x] === 1);
	if (!known(from) || !known(to) || (from.x === to.x && from.y === to.y)) return null;
	const steps = stepsFrom(grid, blocked, from, grid.width * grid.height, known);
	const path = pathFromSteps(steps, grid, blocked, to);
	if (!path?.length) return null;
	const n = path.length;
	return {
		cells: [from, ...path],
		within: movesLeft === null ? n : Math.min(n, movesLeft),
		label: movesLeft === null ? `${n} ${n === 1 ? 'step' : 'steps'}` : `${n} / ${movesLeft}`
	};
}
