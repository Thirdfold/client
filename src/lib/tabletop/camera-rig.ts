// The camera rig (#280): where the camera may be, as pure maths on plain
// vectors (no three.js, like shots.ts and ground.ts), so it is tested in Node.
// The pivot sits on the floor under it (plus storeys the viewer raised it by)
// and stays over the play area; the camera never goes into the ground; pitch
// follows zoom like a diorama (low and close, higher as it pulls back), each
// mode has its own field of view, and damping is per second, not per frame.
// camera.ts applies it to the orbit controls after every update.

import { gridToWorld, type GridPos, type SquareGrid } from '../game/grid';
import { WALL_LEVELS } from '../game/visibility';
import { STEP_HEIGHT, type Ground } from './ground';
import type { Pose, Vec3 } from './shots';
import { GROUND_CLEARANCE } from './world-ground';

/** The two ways of looking (#289 turns modes into data): the whole place, or close on the party. */
export type CameraMode = 'overview' | 'explore';

/** Vertical field of view per mode, in degrees. */
export const FOV: Record<CameraMode, number> = { overview: 30, explore: 40 };
/** At eye level (#289). */
export const EYE_LEVEL_FOV = 55;
/** A pose set from outside (tests, fixtures, photo mode): the field of view before the rig. */
export const POSED_FOV = 45;

const DEG = Math.PI / 180;
/**
 * Pitch (degrees above the ground) by distance (cells): `low` up to `near`, rising smoothly to
 * `high` at `far`. Explore frames minis from 25-35 degrees and whole places from 50-60;
 * overview starts higher.
 */
const PITCH: Record<CameraMode, { near: number; far: number; low: number; high: number }> = {
	explore: { near: 6, far: 40, low: 30, high: 55 },
	overview: { near: 6, far: 60, low: 50, high: 72 }
};
/** How far the viewer may tilt off the curve (MMB vertical); zooming keeps the tilt. */
export const TILT = 10 * DEG;
/** Never flatter than this (85 degrees from straight down, #220), never quite straight down. */
const MIN_PITCH = 5 * DEG;
const MAX_PITCH = 89 * DEG;
/** The orbit controls' damping at 60 Hz (their default). */
export const DAMPING = 0.05;
/** Cells round the camera whose floors it keeps above. */
export const CLEARANCE_CELLS = 1;
/** Cells the pivot may go past the grid's edge. */
export const PIVOT_MARGIN = 3;
/** The storeys PageUp and PageDown may raise or lower the pivot by. */
export const MAX_STOREYS = 3;
/** Explore's closest framing of the party, in cells (about 30 degrees up). */
const CLOSE = 8;
/** Where each mode frames the whole play area from, in play frames (`PlayExtent.frame`). */
const WHOLE: Record<CameraMode, number> = { overview: 1.5, explore: 0.95 };
/** Round the pivot from the south-east in explore, from the south in overview. */
const YAW: Record<CameraMode, number> = { overview: 0, explore: 0.5 };

/** The rig's own terms: what it looks at, from how far (world units), from which direction. */
export interface RigPose {
	pivot: Vec3;
	distance: number;
	/** Radians round the pivot: 0 looks north from the south (+z), as poses.ts's azimuth. */
	yaw: number;
	/** Radians above the ground. */
	pitch: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The cell under a world point, on the grid or not (`Ground.floorY` gives 0 off it). */
export function cellAt(grid: SquareGrid, x: number, z: number): GridPos {
	return {
		x: Math.floor(x / grid.cellSize + grid.width / 2),
		y: Math.floor(z / grid.cellSize + grid.height / 2)
	};
}

/** The pivot's height over a cell: its floor plus `storeys` (a storey is a wall, WALL_LEVELS). */
export function pivotHeight(ground: Ground, cell: GridPos, storeys: number, cellSize = 1): number {
	return ground.floorY(cell) + storeys * WALL_LEVELS * STEP_HEIGHT * cellSize;
}

/** Half the area the pivot may roam: the play area and `PIVOT_MARGIN` cells round it. */
export interface PivotBounds {
	halfX: number;
	halfZ: number;
}

export function pivotBounds(play: { width: number; depth: number; cellSize: number }): PivotBounds {
	const margin = PIVOT_MARGIN * play.cellSize;
	return { halfX: play.width / 2 + margin, halfZ: play.depth / 2 + margin };
}

/** The pivot kept over the play area (x and z; its height is `pivotHeight`'s). */
export function clampPivot(bounds: PivotBounds, target: Vec3): Vec3 {
	return {
		x: clamp(target.x, -bounds.halfX, bounds.halfX),
		y: target.y,
		z: clamp(target.z, -bounds.halfZ, bounds.halfZ)
	};
}

/**
 * The lowest the camera may stand at `cam`: the highest floor within `radiusCells` of it, and off
 * the grid the land beyond (`beyond`, world-ground.ts's scene-level height, #244; level 0
 * without), plus the ground clearance (which covers the near plane).
 */
export function minCameraY(
	ground: Ground,
	grid: SquareGrid,
	cam: { x: number; z: number },
	radiusCells: number,
	beyond?: (x: number, z: number) => number | null
): number {
	const c = cellAt(grid, cam.x, cam.z);
	const on = c.x >= 0 && c.y >= 0 && c.x < grid.width && c.y < grid.height;
	let high = on ? ground.floorY(c) : (beyond?.(cam.x, cam.z) ?? 0);
	const r = Math.ceil(radiusCells);
	for (let dy = -r; dy <= r; dy++)
		for (let dx = -r; dx <= r; dx++) {
			if (dx * dx + dy * dy > radiusCells * radiusCells) continue;
			const x = c.x + dx;
			const y = c.y + dy;
			if (x >= 0 && y >= 0 && x < grid.width && y < grid.height)
				high = Math.max(high, ground.floorY({ x, y }));
		}
	return high + GROUND_CLEARANCE * grid.cellSize;
}

/** The camera's pitch (radians) at `cells` from the pivot: never lower as it pulls back. */
export function pitchForDistance(cells: number, mode: CameraMode): number {
	const { near, far, low, high } = PITCH[mode];
	const t = clamp((cells - near) / (far - near), 0, 1);
	return (low + (high - low) * t * t * (3 - 2 * t)) * DEG;
}

/**
 * The damping factor for a frame `dtMs` long, so the camera settles in the same time at any frame
 * rate: `base` is the factor at 60 Hz. The applied motion still sums to the input.
 */
export function dampingFor(dtMs: number, base: number): number {
	return 1 - (1 - base) ** (dtMs / 16.67);
}

/**
 * Pitch after a frame: zooming keeps the viewer's tilt off the curve (`base`); otherwise the pitch
 * stays within `TILT` of it, eased back by `k` when something left it outside (a shot, a pose).
 */
export function steerPitch(
	pitch: number,
	base: number,
	tilt: number,
	zoomed: boolean,
	k: number
): { pitch: number; tilt: number } {
	if (zoomed) return { pitch: clamp(base + tilt, MIN_PITCH, MAX_PITCH), tilt };
	const wanted = clamp(clamp(pitch, base - TILT, base + TILT), MIN_PITCH, MAX_PITCH);
	const next = pitch + (wanted - pitch) * k;
	return { pitch: next, tilt: clamp(next - base, -TILT, TILT) };
}

/** A rig pose as a camera position and target. */
export function poseOf(r: RigPose): Pose {
	const flat = Math.cos(r.pitch) * r.distance;
	return {
		target: { ...r.pivot },
		position: {
			x: r.pivot.x + flat * Math.sin(r.yaw),
			y: r.pivot.y + Math.sin(r.pitch) * r.distance,
			z: r.pivot.z + flat * Math.cos(r.yaw)
		}
	};
}

/** A camera position and target in the rig's terms. */
export function rigOf(pose: Pose): RigPose {
	const { position: p, target: t } = pose;
	const [dx, dy, dz] = [p.x - t.x, p.y - t.y, p.z - t.z];
	const distance = Math.hypot(dx, dy, dz) || 1e-6;
	return {
		pivot: { ...t },
		distance,
		yaw: Math.atan2(dx, dz),
		pitch: Math.asin(clamp(dy / distance, -1, 1))
	};
}

/** The whole play area `frame` across (world units), seen from the mode's height. */
export function wholeView(mode: CameraMode, frame: number, cellSize = 1): RigPose {
	const distance = WHOLE[mode] * frame;
	const pitch = pitchForDistance(distance / cellSize, mode);
	return { pivot: { x: 0, y: 0, z: 0 }, distance, yaw: YAW[mode], pitch };
}

/** Where each mode stands to see a table `frame` across (the default views), as a pose. */
export function viewPose(mode: CameraMode, frame: number, cellSize = 1): Pose {
	return poseOf(wholeView(mode, frame, cellSize));
}

/** What `framePose` reads of a token: where it stands and whose it is. */
export interface FramedToken {
	id: string;
	pos: GridPos;
	ownerId: string | null;
}

/**
 * The first framing of a table. Explore: the pivot at the centre of the viewer's own tokens, else
 * of the party's (tokens a player owns: for a spectator those in view, for the GM those in play),
 * close enough to fit them; else the whole play area. Overview: the whole play area. Only the
 * tokens the viewer was sent are given, so the camera never turns toward what it can't see.
 */
export function framePose(
	tokens: readonly FramedToken[],
	own: ReadonlySet<string>,
	grid: SquareGrid,
	ground: Ground,
	mode: CameraMode,
	frame: number
): RigPose {
	const mine = tokens.filter((t) => own.has(t.id));
	const chosen = mine.length ? mine : tokens.filter((t) => t.ownerId !== null);
	if (mode === 'overview' || !chosen.length) return wholeView(mode, frame, grid.cellSize);
	const at = chosen.map((t) => ({ ...gridToWorld(grid, t.pos), y: ground.floorY(t.pos) }));
	const mean = (k: 'x' | 'y' | 'z') => at.reduce((s, p) => s + p[k], 0) / at.length;
	const pivot = { x: mean('x'), y: mean('y'), z: mean('z') };
	const spread = Math.max(...at.map((p) => Math.hypot(p.x - pivot.x, p.z - pivot.z)));
	const cells = clamp(CLOSE + (2 * spread) / grid.cellSize, CLOSE, PITCH.explore.far);
	const pitch = pitchForDistance(cells, mode);
	return { pivot, distance: cells * grid.cellSize, yaw: YAW[mode], pitch };
}

/** The pose kept per room (`thirdfold:camera:<roomId>`), in cells and radians. */
export interface SavedCamera {
	width: number;
	height: number;
	cell: GridPos;
	storeys: number;
	distance: number;
	yaw: number;
	tilt: number;
}

export function savedCamera(
	grid: SquareGrid,
	r: RigPose,
	storeys: number,
	tilt: number
): SavedCamera {
	const { width, height } = grid;
	const c = cellAt(grid, r.pivot.x, r.pivot.z);
	const cell = { x: clamp(c.x, 0, width - 1), y: clamp(c.y, 0, height - 1) };
	return { width, height, cell, storeys, distance: r.distance / grid.cellSize, yaw: r.yaw, tilt };
}

/** A stored pose if it is well formed and for a grid this size, else null. */
export function parseSavedCamera(raw: unknown, grid: SquareGrid): SavedCamera | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const s = raw as Record<string, unknown>;
	const num = (v: unknown, lo: number, hi: number) =>
		typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
	const cell = s.cell as Record<string, unknown> | null;
	if (s.width !== grid.width || s.height !== grid.height || typeof cell !== 'object' || !cell)
		return null;
	if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) return null;
	if (!num(cell.x, 0, grid.width - 1) || !num(cell.y, 0, grid.height - 1)) return null;
	if (!Number.isInteger(s.storeys) || !num(s.storeys, -MAX_STOREYS, MAX_STOREYS)) return null;
	if (!num(s.distance, 0.1, 1e4) || !num(s.yaw, -10, 10) || !num(s.tilt, -TILT, TILT)) return null;
	const { storeys, distance, yaw, tilt } = s as unknown as SavedCamera;
	return {
		width: grid.width,
		height: grid.height,
		cell: { x: cell.x as number, y: cell.y as number },
		storeys,
		distance,
		yaw,
		tilt
	};
}

/** A stored pose back in the rig's terms, its pitch on the mode's curve plus the tilt. */
export function restorePose(
	saved: SavedCamera,
	grid: SquareGrid,
	ground: Ground,
	mode: CameraMode
): RigPose {
	const at = gridToWorld(grid, saved.cell);
	const y = pivotHeight(ground, saved.cell, saved.storeys, grid.cellSize);
	const pitch = clamp(pitchForDistance(saved.distance, mode) + saved.tilt, MIN_PITCH, MAX_PITCH);
	return {
		pivot: { x: at.x, y, z: at.z },
		distance: saved.distance * grid.cellSize,
		yaw: saved.yaw,
		pitch
	};
}
