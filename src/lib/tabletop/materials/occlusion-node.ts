// The occluder dither in the shaders (#283, occlusion.ts): the prop, foliage, terrain and rock
// kinds and roofs keep a fragment only where its fade (the most of the four capsules') is under
// the screen's interleaved gradient noise, as the roofs' fade dithers (roof-fade.ts), as their
// mask: the shadow pass never masks (`maskShadowNode` true), so dithered geometry keeps casting
// and the cached sun shadow is never touched. Four slots always run, parked ones fade nothing, so
// filling them compiles nothing; the camera is three's `cameraPosition`, and the fade is spatial,
// not a tween, so idle draws nothing once the camera stops.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { cellUniforms } from '../cell-maps';
import { OCCLUSION, PARKED, type Occluder } from '../occlusion';
import { tsl, type N } from './tsl';

/** Each slot's mini: xyz its chest, w its floor (`PARKED` for none). Written by the token layer. */
const points = T.uniformArray(
	Array.from({ length: OCCLUSION.slots }, () => new THREE.Vector4(0, 0, 0, PARKED)),
	'vec4'
);

/** The slots as last written, for picking (picking.ts): null where parked. */
export const occludersNow: (Occluder | null)[] = Array(OCCLUSION.slots).fill(null);

/** Fills the slots with `minis` (at most `OCCLUSION.slots`; the rest parked). */
export function setOccluders(minis: readonly Occluder[]): void {
	for (let i = 0; i < OCCLUSION.slots; i++) {
		const o = minis[i] ?? null;
		occludersNow[i] = o;
		const v = (points.array as THREE.Vector4[])[i];
		if (o) v.set(o.x, o.y, o.z, o.floor);
		else v.set(0, 0, 0, PARKED);
	}
}

const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
const { clamp, float, max, smoothstep, step } = T as unknown as Record<
	string,
	(...args: unknown[]) => N
>;
const loose = (node: unknown) => node as N;

/** How far the edge wanders, world noise in cells, and the noise's scale (per cell). */
const EDGE_NOISE = 0.08;
const NOISE_SCALE = 3;

let built: N | null = null;

/** The fade at the fragment: 0 drawn, 1 gone (occlusion.ts `occlusionAt`). Built once, shared. */
function fade(): N {
	if (built) return built;
	const p = tsl.positionWorld;
	const cam = loose(T.cameraPosition);
	const cs = u.cellSize;
	const up = step(OCCLUSION.up, tsl.normalWorldGeometry.y);
	const noise = tsl.mx_noise_float(p.div(cs).mul(NOISE_SCALE)).mul(cs.mul(EDGE_NOISE));
	const r = cs.mul(OCCLUSION.radius);
	let most = float(0);
	for (let i = 0; i < OCCLUSION.slots; i++) {
		const o = loose(points).element(i);
		const seg = o.xyz.sub(cam);
		const len2 = seg.dot(seg).max(1e-6);
		const t = clamp(p.sub(cam).dot(seg).div(len2), 0, 1);
		const d = p.sub(cam.add(seg.mul(t))).length();
		const inside = float(1).sub(smoothstep(r.mul(OCCLUSION.inner), r, d.add(noise)));
		const before = smoothstep(0, cs.mul(OCCLUSION.margin), float(1).sub(t).mul(len2.sqrt()));
		const ground = up.mul(step(p.y, o.w.add(cs.mul(OCCLUSION.floorEps))));
		const used = step(o.w, PARKED / 2);
		most = max(most, inside.mul(before).mul(ground.oneMinus()).mul(used));
	}
	return (built = most);
}

/** The mask: true where the fragment is kept, its fade under the pixel's dither noise (0 to under 1). */
export const occlusionKeep = (): N =>
	loose(T.interleavedGradientNoise(T.screenCoordinate.xy)).greaterThanEqual(fade());
