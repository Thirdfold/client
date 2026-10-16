// The cut plane in the shaders (#281, cut.ts): the terrain and rock kinds' chunks and the surface
// kind's kit pieces clamp their vertices under the cut (`cutClamp`, in `positionNode` only: the
// shadow pass draws `castShadowPositionNode`, never clamped), so a cut storey is solid, and the
// faces that end up lying on the cut are its caps: dark and hatched (`capped`, in worldModify).
// Everything else on the grid is discarded above it (worldModify). All of it reads the cut's
// height, a uniform (`cellUniforms.cutY`), so moving the cut compiles nothing.

import * as T from 'three/tsl';
import { cellUniforms, onGrid } from '../cell-maps';
import { tsl, type N } from './tsl';

const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
const { float, min, smoothstep } = T as unknown as Record<string, (...args: unknown[]) => N>;

/** How close to the cut a fragment lies on its cap, and how far above it is still kept, in cells. */
const CAP_BAND = 0.002;
/** The caps' colour, and between their stripes; stripes a cell, across the world's diagonal. */
const CAP_DARK = [0.035, 0.032, 0.03] as const;
const CAP_LIGHT = [0.11, 0.1, 0.09] as const;
const CAP_STRIPES = 6;

/** A position (in world space: the chunks' and pools' meshes stand at the origin) under the cut. */
export const cutClamp = (p: N): N => tsl.vec3(p.x, min(p.y, u.cutY), p.z);

/** 1 above the cut on the grid (worldModify discards it), else 0. Off the grid nothing is cut. */
export const cutAbove = (): N =>
	float(tsl.positionWorld.y.greaterThan(u.cutY.add(u.cellSize.mul(CAP_BAND)))).mul(onGrid);

/**
 * `rgb`, or the cap's hatch where the fragment lies on the cut: the faces clamped there, and the
 * rim of anything discarded above it. No normal is read, so every kind (lines too) may use it.
 */
export function capped(rgb: N): N {
	const w = tsl.positionWorld;
	const near = float(w.y.sub(u.cutY).abs().lessThan(u.cellSize.mul(CAP_BAND)));
	const across = w.x.add(w.z).div(u.cellSize).mul(CAP_STRIPES);
	const hatch = smoothstep(0.4, 0.6, across.fract().sub(0.5).abs().mul(2));
	const cap = tsl.mix(tsl.vec3(...CAP_LIGHT), tsl.vec3(...CAP_DARK), hatch);
	return tsl.mix(rgb, cap, near.mul(onGrid));
}
