// The path preview's ribbon (#286), pure: the points a walk's line passes through, split at the
// movement left. A point sits at each cell's centre a little above its floor; where two cells'
// floors differ, two more at the shared edge (one at each floor) make the line climb the riser or
// the stairs instead of cutting through them. Everything comes from the cells the viewer was sent.

import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';

/** How far the ribbon floats above a floor, in cells. */
export const RIBBON_LIFT = 0.06;
/** The ribbon's width and the tether's, in cells; dashes and gaps along the part beyond. */
export const RIBBON_WIDTH = 0.1;
export const TETHER_WIDTH = 0.035;
export const DASH = 0.22;
export const GAP = 0.16;
/** The reach blue of the cell overlay (cell-overlay.ts) and a neutral for the part beyond it. */
export const LINE_COLOURS = { reach: 0x0072b2, beyond: 0xe8e0d0, tether: 0xf2e6d0 } as const;

export interface Ribbon {
	/** x, y, z triples: from the start through `within` steps; empty when there is no line to draw. */
	solid: number[];
	/** From where `solid` ends to the destination; empty when everything is within reach. */
	beyond: number[];
	/** The arrowhead: at the destination, pointing the way the last step went (a unit xz vector). */
	tip: { x: number; y: number; z: number; dx: number; dz: number } | null;
}

/**
 * The ribbon for `cells` (the start first, then each cell stepped onto), solid for the first
 * `within` steps and dashed after. `floorY` is the drawn ground's height at a cell.
 */
export function ribbonOf(
	cells: readonly GridPos[],
	within: number,
	grid: SquareGrid,
	floorY: (cell: GridPos) => number
): Ribbon {
	const lift = RIBBON_LIFT * grid.cellSize;
	const at = (c: GridPos) => {
		const w = gridToWorld(grid, c);
		return { x: w.x, y: floorY(c) + lift, z: w.z };
	};
	// Every point, tagged with the step it ends (0 for the start).
	const nodes: { x: number; y: number; z: number; step: number }[] = [];
	cells.forEach((c, i) => {
		const here = at(c);
		if (i > 0 && floorY(c) !== floorY(cells[i - 1])) {
			const there = at(cells[i - 1]);
			const [mx, mz] = [(here.x + there.x) / 2, (here.z + there.z) / 2];
			const [low, high] = [Math.min(here.y, there.y), Math.max(here.y, there.y)];
			const climbing = here.y > there.y;
			nodes.push(
				{ x: mx, y: climbing ? low : high, z: mz, step: i },
				{ x: mx, y: climbing ? high : low, z: mz, step: i }
			);
		}
		nodes.push({ ...here, step: i });
	});
	const flat = (list: typeof nodes) => list.flatMap((n) => [n.x, n.y, n.z]);
	const solid = nodes.filter((n) => n.step <= within);
	// The dashes start at the last point of step `within`, the cell where the solid part ends.
	const beyond = nodes.slice(nodes.findLastIndex((n) => n.step <= within));
	const last = cells.length - 1;
	let tip: Ribbon['tip'] = null;
	if (last > 0) {
		const [a, b] = [at(cells[last - 1]), at(cells[last])];
		const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
		tip = { ...b, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length };
	}
	return {
		solid: solid.length > 1 ? flat(solid) : [],
		beyond: beyond.length > 1 && within < last ? flat(beyond) : [],
		tip
	};
}
