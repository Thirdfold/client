// Named camera poses for fixture tables (tests/fixtures/scenes/*.poses.json), in the camera rig's
// terms (#280) and in grid terms, so they survive changes to the world's scale: the view the
// camera is in, the cell its pivot stands over, how far away in cells and from which direction
// and height. They are placed through the rig's own maths (camera-rig.ts): the pivot on its floor
// (an eye above it at eye level), the view's field of view, the pitch within its band; the rig then
// holds the camera from the next frame as it holds a viewer's (clearance, the spring arm), so a
// posed render shows what a player at that pose sees. Pure; the renderer's `setGridPose` takes it.

import { gridToWorld, type GridPos, type SquareGrid } from '../game/grid';
import { pitchForDistance, pivotHeight, poseOf, steerPitch, type RigPose } from './camera-rig';
import { CAMERA_MODES, type CameraView } from './camera-modes';
import { eyeLift } from './camera-track';
import { groundFor, type Ground } from './ground';
import type { Pose } from './shots';

const DEG = Math.PI / 180;

/** A named pose in the rig's terms: where a viewer in `mode` stands. */
export interface RigGridPose {
	/** The view (camera-modes.ts): its framing curve, field of view, distance range, spring arm. */
	mode: CameraView;
	/** The cell the pivot stands over, on its floor (at eye level, an eye above it). */
	pivot: GridPos;
	/** Storeys above that floor, as PageUp/PageDown raise the pivot. */
	storeys?: number;
	/** From the pivot, in cells. */
	distance: number;
	/** Degrees round the pivot: 0 looks north from the south (+z), 90 looks west from the east. */
	yaw: number;
	/** Degrees above the ground, within the view's tilt of its curve; the curve's own when absent. */
	pitch?: number;
}

/**
 * The form from before the rig (#129): the same numbers under other names (target is the pivot,
 * azimuth the yaw, elevation the pitch), standing exactly as given at `POSED_FOV`, with no view.
 * Still read for one release (M72) for anything that sends it.
 */
export interface LegacyGridPose {
	target: GridPos;
	distance: number;
	azimuth: number;
	elevation: number;
}

export type GridPose = RigGridPose | LegacyGridPose;

/** What the rig takes over with a placed rig pose (camera.ts `setPose`). */
export interface PosedRig {
	view: CameraView;
	storeys: number;
	/** Radians off the view's curve, which the rig keeps as a viewer's tilt. */
	tilt: number;
}

/** A rig pose in world terms, its pitch within the view's band, and the tilt that leaves. */
export function rigPoseFor(
	grid: SquareGrid,
	ground: Ground,
	pose: RigGridPose
): { rig: RigPose; tilt: number } {
	const base = pitchForDistance(pose.distance, CAMERA_MODES[pose.mode].curve);
	const asked = pose.pitch === undefined ? base : pose.pitch * DEG;
	const { pitch, tilt } = steerPitch(asked, base, 0, false, 1);
	const at = gridToWorld(grid, pose.pivot);
	const lift = pose.mode === 'eye' ? eyeLift(grid.cellSize) : 0;
	const y = lift + pivotHeight(ground, pose.pivot, pose.storeys ?? 0, grid.cellSize);
	const distance = pose.distance * grid.cellSize;
	return { rig: { pivot: { x: at.x, y, z: at.z }, distance, yaw: pose.yaw * DEG, pitch }, tilt };
}

/** Where a named pose puts the camera, and what the rig takes over (none for the legacy form). */
export function placePose(
	grid: SquareGrid,
	ground: Ground | null,
	pose: GridPose
): [Pose, PosedRig?] {
	const floor = ground ?? groundFor(grid, null);
	if ('target' in pose) {
		const at = gridToWorld(grid, pose.target);
		const pivot = { x: at.x, y: floor.floorY(pose.target), z: at.z };
		const distance = pose.distance * grid.cellSize;
		return [poseOf({ pivot, distance, yaw: pose.azimuth * DEG, pitch: pose.elevation * DEG })];
	}
	const { rig, tilt } = rigPoseFor(grid, floor, pose);
	return [poseOf(rig), { view: pose.mode, storeys: pose.storeys ?? 0, tilt }];
}
