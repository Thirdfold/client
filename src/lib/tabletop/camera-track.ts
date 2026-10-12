// Where eye level and follow put the camera (#289): the pivot over a mini, the framing behind
// it, and one frame of following. Pure (no three.js), tested in Node. The data (camera-modes.ts)
// is light enough for the room page; this is the renderer's.

import { gridToWorld, type SquareGrid } from '../game/grid';
import { EYE_LEVELS } from '../game/visibility';
import { CLOSE, dampingFor, pitchForDistance, yawOf, type RigPose } from './camera-rig';
import { CAMERA_MODES, type CameraView, type Subject } from './camera-modes';
import { STEP_HEIGHT, type Ground } from './ground';

/** Eye level's usual distance behind the pivot, in cells. */
export const EYE_DISTANCE = 4;

/** The pivot's height over a mini's floor at eye level: the rules' eye, in world units. */
export const eyeLift = (cellSize = 1) => EYE_LEVELS * STEP_HEIGHT * cellSize;

/** Where the pivot goes for a subject: eye level above its floor, or on the floor (follow). */
export function subjectPivot(view: CameraView, s: Subject, grid: SquareGrid, ground: Ground) {
	const at = gridToWorld(grid, s.pos);
	const lift = view === 'eye' ? eyeLift(grid.cellSize) : 0;
	return { x: at.x, y: ground.floorY(s.pos) + lift, z: at.z };
}

/**
 * The framing a view has on a subject: eye level a few cells behind it, looking toward the
 * horizon; follow, explore's closest framing centred on it. Null for the views that do not
 * track, or with no subject (eye level then falls back to explore, `effectiveCurve`).
 */
export function subjectRig(
	view: CameraView,
	s: Subject | null,
	grid: SquareGrid,
	ground: Ground,
	yaw: number
): RigPose | null {
	if (!s || !CAMERA_MODES[view].tracks) return null;
	const cells = view === 'eye' ? EYE_DISTANCE : CLOSE;
	const curve = CAMERA_MODES[view].curve;
	return {
		pivot: subjectPivot(view, s, grid, ground),
		distance: cells * grid.cellSize,
		yaw: Number.isFinite(yaw) ? yaw : yawOf(curve),
		pitch: pitchForDistance(cells, curve)
	};
}

/** How quickly the pivot follows a mini: a factor at 60 Hz (the rig's EASE). */
export const FOLLOW_EASE = 0.15;
/** The pivot this far (world units) from where following left it means the viewer panned. */
export const PAN_CANCEL = 0.02;

/**
 * One frame of following: how far the pivot moves toward `goal` (all the way under reduced
 * motion), whether the viewer panned it since last frame (it is not where following left it,
 * `expect`) and so cancels following, and whether it is still on its way.
 */
export function trackStep(
	pivot: { x: number; z: number },
	goal: { x: number; z: number },
	expect: { x: number; z: number } | null,
	dtMs: number,
	reduced: boolean
): { dx: number; dz: number; panned: boolean; easing: boolean } {
	if (expect && Math.hypot(pivot.x - expect.x, pivot.z - expect.z) > PAN_CANCEL)
		return { dx: 0, dz: 0, panned: true, easing: false };
	const k = reduced ? 1 : dampingFor(dtMs, FOLLOW_EASE);
	const [dx, dz] = [(goal.x - pivot.x) * k, (goal.z - pivot.z) * k];
	return {
		dx,
		dz,
		panned: false,
		easing: Math.hypot(goal.x - pivot.x - dx, goal.z - pivot.z - dz) > 1e-4
	};
}
