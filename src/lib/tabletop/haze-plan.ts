// Where heat haze hangs (M75 #326), pure and Node-tested (haze-plan.ts is the planner of haze.ts,
// in the lazy `vfx` chunk). Every source comes from what the viewer was sent: the fires the lights
// layer burns (fire.ts), the lava cells the viewer has explored, and the Heart prop. A haze is a
// camera-facing quad standing on its source, `size` wide; nothing is planned over a cell the viewer
// has not explored (the output stage would black it anyway).

import { FLOOR_IDS } from '../game/floor';
import { gridToWorld, type SquareGrid } from '../game/grid';
import type { LightKind } from '../game/lights';
import { footprintCells, type Prop } from '../game/props';
import type { Fire } from './fire';
import type { WorldShape } from './world/shape';

/** The most hazes at once: the size of the instance buffer, and so of the one draw. */
export const HAZE_MAX = 48;
/** The most lava hazes: the cells nearest the camera's target. */
export const LAVA_MAX = 24;
/** Quad height over its width. */
export const HAZE_TALL = 1.6;
const LAVA = FLOOR_IDS.indexOf('lava');
/** Lights whose flame is hot enough to shimmer: the open fires, not a torch, candle or lantern. */
const HOT: ReadonlySet<LightKind> = new Set<LightKind>(['brazier', 'fire']);

/** A haze: the middle of its base in world units, and its width. */
export interface Heat {
	x: number;
	y: number;
	z: number;
	size: number;
}

/** The hazes over a table's fires: braziers and floor fires, not a carried light. */
export function fireHeat(fires: readonly Fire[]): Heat[] {
	return fires
		.filter((f) => HOT.has(f.kind) && !f.carried)
		.map((f) => ({ x: f.x, y: f.y - 0.1, z: f.z, size: f.kind === 'fire' ? 1.1 : 0.8 }));
}

/**
 * The hazes the ground and props hold: over the lava cells the viewer has explored, the `LAVA_MAX`
 * nearest `target` (the camera's pivot), and over each Heart prop.
 */
export function terrainHeat(
	grid: SquareGrid,
	shape: WorldShape,
	props: readonly Pick<Prop, 'assetId' | 'pos' | 'rotation'>[],
	target: { x: number; z: number }
): Heat[] {
	const out: Heat[] = [];
	const { floor, known, ground } = shape;
	const near: { d: number; x: number; y: number; z: number }[] = [];
	if (LAVA >= 0)
		for (let y = 0; y < grid.height; y++)
			for (let x = 0; x < grid.width; x++) {
				const i = y * grid.width + x;
				if (floor[i] !== LAVA || (known && !known[i])) continue;
				const w = gridToWorld(grid, { x, y });
				near.push({
					d: (w.x - target.x) ** 2 + (w.z - target.z) ** 2,
					x: w.x,
					y: ground.floorY({ x, y }),
					z: w.z
				});
			}
	near.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
	for (const c of near.slice(0, LAVA_MAX))
		out.push({ x: c.x, y: c.y, z: c.z, size: 1.6 * grid.cellSize });
	for (const p of props) {
		if (p.assetId !== 'heart') continue;
		const cells = footprintCells(p);
		const at = cells.map((c) => gridToWorld(grid, c));
		const n = at.length;
		const side = Math.sqrt(n) * grid.cellSize;
		out.push({
			x: at.reduce((s, w) => s + w.x, 0) / n,
			y: Math.max(...cells.map((c) => ground.floorY(c))) + 0.4,
			z: at.reduce((s, w) => s + w.z, 0) / n,
			size: side * 0.9
		});
	}
	return out;
}

/** `lists` merged into at most `HAZE_MAX` hazes (the earlier lists keep theirs). */
export const mergeHeat = (lists: Iterable<readonly Heat[]>): Heat[] =>
	[...lists].flat().slice(0, HAZE_MAX);
