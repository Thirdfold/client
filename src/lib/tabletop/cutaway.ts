// The walls' cutaway (#282), as The Sims does it: a wall that faces the camera and stands near
// the line from the camera to the focus lowers to a stub, so a room reads from any angle. Pure:
// `wallTop` is what picking (#291) and the specs use; materials/cutaway-node.ts is the same rule
// in the kit pieces' vertex shader, from these constants. docs/RENDERING.md, "Wall cutaway (#282)".

import { WALL_HEIGHT } from './ground';

/** The Graphics menu's walls: always up, the cutaway, or always down to stubs. */
export type WallsSetting = 'up' | 'cutaway' | 'down';
export const WALLS_SETTINGS: readonly WallsSetting[] = ['up', 'cutaway', 'down'];
/** The shader's `mode` uniform for each setting. */
export const CUTAWAY_MODE: Record<WallsSetting, number> = { up: 0, cutaway: 1, down: 2 };

/** A saved setting, if it is one (for `loadGraphics`): spread into the prefs. */
export const readWalls = (raw: unknown): { walls?: WallsSetting } =>
	WALLS_SETTINGS.includes(raw as WallsSetting) ? { walls: raw as WallsSetting } : {};

/**
 * The rule's sizes, in cells: the stub (a fraction of WALL_HEIGHT), how far from the camera-focus
 * line a wall starts and ends lowering, how far either side of its plane the focus eases it, and
 * how far from its plane the camera must be before it lowers fully. Starting values (#282's art
 * review tunes them).
 */
export const CUTAWAY = { stub: 0.25, near: 2, far: 3, side: 0.2, away: 0.5 } as const;

/** A wall piece as the shader sees it: its edge's centre, its axis and the floor it stands on. */
export interface WallSpot {
	x: number;
	z: number;
	/** 0: the wall runs along x (it faces ±z); 1: along z (it faces ±x). */
	axis: 0 | 1;
	/** World height of its lower floor. */
	base: number;
}

export interface XZ {
	x: number;
	z: number;
}

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/** How far a wall is lowered, 0 (up) to 1 (a stub), for the camera at `cam` and the focus. */
export function cutawayOf(
	wall: WallSpot,
	cam: XZ,
	focus: XZ,
	setting: WallsSetting,
	cellSize: number
): number {
	if (setting !== 'cutaway') return setting === 'down' ? 1 : 0;
	const [nx, nz] = wall.axis ? [1, 0] : [0, 1];
	const a = (cam.x - wall.x) * nx + (cam.z - wall.z) * nz;
	const b = (focus.x - wall.x) * nx + (focus.z - wall.z) * nz;
	// The camera on the far side of the wall's plane from the focus.
	const side = CUTAWAY.side * cellSize;
	const faces =
		smoothstep(-side, side, -b * Math.sign(a)) *
		smoothstep(0, CUTAWAY.away * cellSize, Math.abs(a));
	// Its centre near the camera-to-focus segment, on the ground.
	const [sx, sz] = [focus.x - cam.x, focus.z - cam.z];
	const len = sx * sx + sz * sz;
	const t =
		len > 0 ? Math.min(1, Math.max(0, ((wall.x - cam.x) * sx + (wall.z - cam.z) * sz) / len)) : 0;
	const d = Math.hypot(wall.x - (cam.x + sx * t), wall.z - (cam.z + sz * t));
	const near = 1 - smoothstep(CUTAWAY.near * cellSize, CUTAWAY.far * cellSize, d);
	return faces * near;
}

/** The world height of a wall's top as drawn: its full height over `base`, lowered to the stub. */
export function wallTop(
	wall: WallSpot,
	cam: XZ,
	focus: XZ,
	setting: WallsSetting,
	cellSize: number
): number {
	const full = WALL_HEIGHT * cellSize;
	const drop = cutawayOf(wall, cam, focus, setting, cellSize) * full * (1 - CUTAWAY.stub);
	return wall.base + full - drop;
}
