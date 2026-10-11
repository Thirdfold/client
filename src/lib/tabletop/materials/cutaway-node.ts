// The walls' cutaway in the kit pieces' vertex shader (#282): cutaway.ts's rule, from the same
// constants. Every piece mesh (piece.ts) carries its edge per instance (`WALL_ATTRIBUTE`: centre
// x and z, axis, floor), written with its matrix (piece-pool.ts `putPiece`); the camera is
// three's `cameraPosition`, the focus and the setting are uniforms. Stateless: walls move only
// with the camera, nothing tweens, and the shadow pass draws `castShadowPositionNode`, the
// full wall, so orbiting never touches the sun's shadow.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { cellUniforms } from '../cell-maps';
import { CUTAWAY } from '../cutaway';
import { WALL_HEIGHT } from '../ground';
import { tsl, type N } from './tsl';

/** A piece instance's edge: centre x and z, axis (1: it faces ±x), the floor's world height. */
export const WALL_ATTRIBUTE = 'aWall';

/** The focus (the rig's pivot) and the setting (`CUTAWAY_MODE`): written by the cut layer. */
export const cutawayUniforms = {
	focus: T.uniform(new THREE.Vector3()),
	mode: T.uniform(1)
};

const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
const f = cutawayUniforms as unknown as Record<keyof typeof cutawayUniforms, N>;
const { clamp, float, sign, smoothstep } = T as unknown as Record<
	string,
	(...args: unknown[]) => N
>;

/** A piece's position (world space, after instancing) with its wall lowered toward the stub. */
export function cutaway(p: N): N {
	const wall = tsl.attribute(WALL_ATTRIBUTE, 'vec4');
	const cs = u.cellSize;
	const c = wall.xy;
	const n = tsl.vec2(wall.z, float(1).sub(wall.z));
	const cam = (T.cameraPosition as unknown as N).xz;
	const focus = f.focus.xz;
	const a = cam.sub(c).dot(n);
	const b = focus.sub(c).dot(n);
	const side = cs.mul(CUTAWAY.side);
	const faces = smoothstep(side.negate(), side, b.negate().mul(sign(a))).mul(
		smoothstep(0, cs.mul(CUTAWAY.away), a.abs())
	);
	const s = focus.sub(cam);
	const t = clamp(c.sub(cam).dot(s).div(s.dot(s).max(1e-6)), 0, 1);
	const d = c.sub(cam.add(s.mul(t))).length();
	const near = float(1).sub(smoothstep(cs.mul(CUTAWAY.near), cs.mul(CUTAWAY.far), d));
	// 0 walls up, 1 the cutaway, 2 walls down.
	const k = tsl.mix(
		faces.mul(near).mul(f.mode.min(1)),
		float(1),
		f.mode.greaterThan(1.5).select(1, 0)
	);
	// Everything over the stub slides down with the top, so a kit's cap rides down onto the stub.
	const full = cs.mul(WALL_HEIGHT);
	const stub = full.mul(CUTAWAY.stub);
	const drop = clamp(p.y.sub(wall.w).sub(stub), 0, full.sub(stub)).mul(k);
	return tsl.vec3(p.x, p.y.sub(drop), p.z);
}
