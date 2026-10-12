// Reading a walk back from `stepsFrom`'s distances (#286); its own file so the pages that only
// need `objects.ts` (the shell) do not carry it.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { canStep, type Blockers } from './objects';

/**
 * A shortest walk to `to` read back from `stepsFrom`'s distances (#286): the cells stepped onto in
 * order, not the start, as `findPath` returns them, so its length is `steps[to]`. Each cell back
 * takes the first neighbour one step closer (in `findPath`'s neighbour order) that may step onto
 * it. Null where `steps` has no way there.
 */
export function pathFromSteps(
	steps: Int16Array,
	grid: SquareGrid,
	blocked: Blockers,
	to: GridPos
): GridPos[] | null {
	if (!inBounds(grid, to) || steps[to.y * grid.width + to.x] < 0) return null;
	const path: GridPos[] = [];
	for (let cur = to, d = steps[to.y * grid.width + to.x]; d > 0; d--) {
		path.unshift(cur);
		let back: GridPos | null = null;
		for (let dy = -1; dy <= 1 && !back; dy++) {
			for (let dx = -1; dx <= 1 && !back; dx++) {
				const n = { x: cur.x + dx, y: cur.y + dy };
				if ((dx || dy) && inBounds(grid, n) && steps[n.y * grid.width + n.x] === d - 1)
					if (canStep(blocked, n, cur)) back = n;
			}
		}
		if (!back) return null;
		cur = back;
	}
	return path;
}
