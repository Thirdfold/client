// The cut plane (#281): everything above a storey's floor hidden, so a viewer sees into
// multi-storey places. Pure (no three.js): the room page steps a locked cut with it, the
// renderer's cut layer (cut-layer.ts) works out the auto cut, and its specs run in Node.
// docs/RENDERING.md, "Cut plane (#281)".

import type { GridPos, SquareGrid } from '../game/grid';
import { roomAround } from '../game/rooms';
import { MAX_LEVEL } from '../game/terrain';
import { WALL_LEVELS } from '../game/visibility';
import { STEP_HEIGHT } from './ground';

/** The storey a level is on: a storey is a wall's height, WALL_LEVELS levels. */
export const storeyOf = (level: number): number => Math.floor(level / WALL_LEVELS);

/** The cut one storey above the storey of `level`. */
const above = (level: number) => (storeyOf(level) + 1) * WALL_LEVELS;

export interface AutoCutInput {
	grid: SquareGrid;
	/** Every wall, window and door edge (`roomBoundary(objects)`). */
	boundary: ReadonlySet<string>;
	/** The camera's pivot: its cell and its level (its floor plus any storeys it was raised). */
	pivot: GridPos;
	pivotLevel: number;
	/** The floors of the selected token and the viewer's own tokens in view: never cut. */
	keep: readonly number[];
}

/**
 * The auto cut's level: one storey above the pivot's storey, never under one storey above a kept
 * token's floor; null (no cut) when the pivot is in no room of known walls (open ground keeps its
 * heights), or when the cut would be above every level there is.
 */
export function autoCut({ grid, boundary, pivot, pivotLevel, keep }: AutoCutInput): number | null {
	if (!roomAround(grid, boundary, pivot)) return null;
	const level = Math.max(above(pivotLevel), ...keep.map(above));
	return level > MAX_LEVEL ? null : level;
}

/**
 * A locked cut stepped `by` storeys from `level` (null: none): up past the top is none, down from
 * none the highest storey, and never below the first storey's ceiling (a cut at 0 hides the floor).
 */
export function stepCut(level: number | null, by: number): number | null {
	const top = Math.floor(MAX_LEVEL / WALL_LEVELS) * WALL_LEVELS;
	const next = (level ?? top + WALL_LEVELS) + by * WALL_LEVELS;
	return next > top ? null : Math.max(WALL_LEVELS, next);
}

/** How far under a storey's floor the cut sits, a fraction of a cell: that floor caps the storey below. */
export const CUT_EPSILON = 0.02;

/** The world height of a cut at `level`: just under that level's floor. */
export const cutHeight = (level: number, cellSize: number): number =>
	(level * STEP_HEIGHT - CUT_EPSILON) * cellSize;

/** The level of a world height, to the nearest (the pivot's, a floor's). */
export const levelAt = (y: number, cellSize: number): number =>
	Math.round(y / (STEP_HEIGHT * cellSize));
