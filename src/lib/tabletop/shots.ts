// Cinematic camera moves: the story points the camera at something for a
// moment (the monastery on the mountain, the bell in its tower, a door that
// wasn't there, the size of the Hollow) and then gives it back. Pure maths on
// plain vectors, so it is tested without three.js; the renderer plays it.
// A shot never takes the camera away for long, and any drag or scroll by the
// viewer ends it where it is: the player keeps control.

import type { Shot } from '../game/chat';

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Pose {
	position: Vec3;
	target: Vec3;
}

/** How long a shot takes to get there, stays, and comes back (ms). */
export const SHOT_MS = { go: 1400, hold: 2600, back: 1200 } as const;
export const SHOT_TOTAL = SHOT_MS.go + SHOT_MS.hold + SHOT_MS.back;

/**
 * How each framing stands, for the world's scale (1 cell = 1 u, a wall 2 u, an eye 1.2 u) and the
 * rig's diorama field of view (#152, #280): `cells` the distance from the target, `elevation` the
 * camera's angle above the horizontal (radians) and `lift` the target's height above the floor, in
 * cells. A close shot aims at what stands on the floor (a bell, a door, a pit's rim), so it takes
 * in the thing and not the tiles under it; a wide one aims higher at a low angle, so the horizon
 * and the sky come into the top of the frame (the monastery on its mountain, the tendrils rising
 * against the cavern). `overview` pulls back over the whole table, `extent` times `spread`.
 */
export const FRAMES = {
	close: { cells: 6.5, elevation: 0.38, lift: 1.1 },
	wide: { cells: 13, elevation: 0.08, lift: 3.4 }
} as const;
export const OVERVIEW = { spread: 1.05, elevation: 0.85, lift: 0 } as const;

/** How far (radians) a framed shot may swing the viewer's direction to look out over the table's edge. */
export const OUTWARD_TURN = 0.9;

/**
 * A framed shot's camera direction (from the target to the camera, unit, on the ground): the
 * viewer's own, turned by at most OUTWARD_TURN toward the one that looks from the table's middle
 * out past the focus, where the landscape and the sky stand (a focus in the middle: no turn).
 */
function lookOut(dx: number, dz: number, focus: Vec3, cell: number): [number, number] {
	if (Math.hypot(focus.x, focus.z) < 2 * cell) return [dx, dz];
	const want = Math.atan2(-focus.z, -focus.x);
	const have = Math.atan2(dz, dx);
	const diff = Math.atan2(Math.sin(want - have), Math.cos(want - have));
	const turn = Math.max(-OUTWARD_TURN, Math.min(OUTWARD_TURN, diff));
	return [Math.cos(have + turn), Math.sin(have + turn)];
}

/**
 * Where the camera goes for a shot, seen from where it is now (keeping its
 * direction round the table, so the move reads as a turn of the head).
 * `focus` is the world point to look at, on the floor (null: the table's centre);
 * `extent` the table's size and `cell` a cell's size, in world units.
 */
export function shotPose(
	from: Pose,
	focus: Vec3 | null,
	frame: Shot['frame'],
	extent: number,
	cell: number
): Pose {
	// 'table' is the old name of 'overview' and is accepted for good (saved logs, adventure files).
	const framed = frame === 'close' || frame === 'wide' ? FRAMES[frame] : null;
	const target =
		framed && focus
			? { ...focus, y: focus.y + framed.lift * cell }
			: { x: 0, y: (framed?.lift ?? OVERVIEW.lift) * cell, z: 0 };
	let dx = from.position.x - from.target.x;
	let dz = from.position.z - from.target.z;
	const flat = Math.hypot(dx, dz);
	if (flat < 1e-6) {
		dx = 0;
		dz = 1;
	} else {
		dx /= flat;
		dz /= flat;
	}
	if (framed && focus) [dx, dz] = lookOut(dx, dz, focus, cell);
	const distance = framed ? framed.cells * cell : extent * OVERVIEW.spread;
	const elevation = framed ? framed.elevation : OVERVIEW.elevation;
	return {
		target,
		position: {
			x: target.x + dx * Math.cos(elevation) * distance,
			y: target.y + Math.sin(elevation) * distance,
			z: target.z + dz * Math.cos(elevation) * distance
		}
	};
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function lerp(a: Vec3, b: Vec3, k: number): Vec3 {
	return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

function mix(a: Pose, b: Pose, k: number): Pose {
	return { position: lerp(a.position, b.position, k), target: lerp(a.target, b.target, k) };
}

/** The camera `elapsed` ms into a shot from `home` to `shot` and back; `done` once it is home. */
export function shotAt(home: Pose, shot: Pose, elapsed: number): { pose: Pose; done: boolean } {
	if (elapsed < SHOT_MS.go)
		return { pose: mix(home, shot, ease(elapsed / SHOT_MS.go)), done: false };
	if (elapsed < SHOT_MS.go + SHOT_MS.hold) return { pose: shot, done: false };
	const back = (elapsed - SHOT_MS.go - SHOT_MS.hold) / SHOT_MS.back;
	if (back >= 1) return { pose: home, done: true };
	return { pose: mix(shot, home, ease(back)), done: false };
}

/**
 * How much of a shot's depth of field shows `elapsed` ms in (#165): it eases in as the camera
 * goes, holds, and eases out as it comes back; 0 outside the shot.
 */
export function shotFocus(elapsed: number): number {
	if (elapsed <= 0 || elapsed >= SHOT_TOTAL) return 0;
	if (elapsed < SHOT_MS.go) return ease(elapsed / SHOT_MS.go);
	if (elapsed < SHOT_MS.go + SHOT_MS.hold) return 1;
	return 1 - ease((elapsed - SHOT_MS.go - SHOT_MS.hold) / SHOT_MS.back);
}
