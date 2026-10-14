// Wet ground and snow (#321), in the lazy `vfx` chunk: a uniform-driven term on the lit kinds'
// albedo, roughness and normal, registered over kinds.ts's `covers` when the chunk loads (as
// weather's graph is over the overlay kind). The values are uniforms, so wetness, snow and an
// environment's base wetness change nothing a program is made of; the weather's wetness and snow
// reach only the open sky (`skySun`: none under a roof or in a dark area, the same mask the sun
// uses), the environment's own damp reaches everywhere.
//
// After Lagarde's wet surfaces, in the cheap parts only: wet porous ground darkens
// (`albedo x mix(1, 0.2, porosity)`) and its roughness falls toward a water film; metal is
// unaffected. Puddles (the terrain kind on medium and up, the `antiTiled` graph) fill the low
// spots of a noise: a cell with higher neighbours in the level map holds them, flat, mirror-smooth,
// and rippling while it rains. Snow whitens faces that point up, patchy while thin, on every lit
// kind, minis' shoulders included. The clock (game/weather.ts) and the layer (weather.ts) set the
// uniforms; nothing here reads a cell the viewer was not sent beyond the maps worldModify reads.

import * as T from 'three/tsl';
import { cellUniforms, groundFlat } from '../cell-maps';
import { porosityTable } from '../weather-look';
import { covers } from './covers';
import { worldTime, type ShaderKind, type Variant } from './kinds';
import type { N } from './tsl';
import { skySun } from './world-modify';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;
const gid = groundFlat as unknown as N;
const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;

export const coverUniforms = {
	/** The weather's wetness, 0-1 (game/weather.ts), for the open sky only. */
	rain: T.uniform(0),
	/** The environment's own wetness, 0-1: stone halls, caves (assets/environments). */
	base: T.uniform(0),
	/** Snow cover, 0-1, for the open sky only. */
	snow: T.uniform(0),
	/** 1 while it rains: ripples move; 0 holds them (and the mirror) still. */
	rippling: T.uniform(0),
	/** Porosity by floor index (weather-look.ts `POROSITY`). */
	porosity: T.uniformArray(porosityTable(), 'float')
};
const c = coverUniforms as unknown as Record<keyof typeof coverUniforms, N>;

const SNOW = [0.9, 0.93, 0.97];
const WATER_ROUGHNESS = 0.08;
const PUDDLE_ROUGHNESS = 0.03;
const SNOW_ROUGHNESS = 0.85;

/** The cell's level (0-1 of 255) at `at`, clamped to the grid. */
const levelAt = (at: N): N => {
	const size = t.ivec2(u.gridSize);
	return gid.load(t.clamp(at, t.ivec2(0, 0), size.sub(1))).y;
};

/** How much of the fragment is a puddle, 0-1: noise blobs, larger in the low spots of the level map. */
function puddleOf(rain: N): N {
	const xz = t.positionWorld.xz;
	const cell = t.ivec2(t.floor(xz.div(u.cellSize).add(u.gridSize.mul(0.5))));
	const own = levelAt(cell);
	const higher = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1]
	].map(([x, y]) => t.step(0.5 / 255, levelAt(cell.add(t.ivec2(x, y))).sub(own)));
	const low = higher[0].add(higher[1]).add(higher[2]).add(higher[3]).mul(0.5).saturate();
	const blob = t.mx_noise_float(xz.mul(0.4)).mul(0.5).add(0.5);
	const edge = t.mix(t.float(0.68), t.float(0.42), low);
	return t.smoothstep(edge, edge.add(0.08), blob).mul(t.smoothstep(0.35, 0.7, rain));
}

function make(kind: ShaderKind, variant: Variant, metal: N) {
	const outdoor = skySun();
	const rain = c.rain.mul(outdoor);
	const wet = t.max(c.base, rain);
	const porosity =
		kind === 'terrain' ? c.porosity.element(t.int(gid.x.mul(255).add(0.5))) : t.float(0.3);
	const soak = wet.mul(t.float(1).sub(metal));
	const puddle = kind === 'terrain' && variant.antiTiled ? puddleOf(rain) : t.float(0);
	// Snow: faces that point up, patchy while thin, never under a roof.
	const xz = t.positionWorld.xz;
	const patch = t.mx_noise_float(xz.mul(2.7)).mul(0.5).add(0.5);
	const cover = c.snow.mul(outdoor).mul(1.4).sub(patch.oneMinus().mul(0.6)).saturate();
	const snow = t.smoothstep(0.5, 1, t.normalWorldGeometry.y).mul(cover);
	return {
		colour: (colour: N) => {
			const damp = t.mix(t.float(1), t.mix(t.float(1), t.float(0.2), porosity), soak);
			const wetted = colour.xyz.mul(damp).mul(t.mix(t.float(1), t.float(0.55), puddle));
			return t.vec4(t.mix(wetted, t.vec3(...SNOW), snow), colour.w);
		},
		rough: (roughness: N) => {
			const film = t.mix(
				roughness,
				t.float(WATER_ROUGHNESS),
				soak.mul(t.float(1).sub(porosity.mul(0.5)))
			);
			const pooled = t.mix(film, t.float(PUDDLE_ROUGHNESS), puddle);
			return t.mix(pooled, t.float(SNOW_ROUGHNESS), snow);
		},
		normal: (normal: N) => {
			if (kind !== 'terrain' || !variant.antiTiled) return normal;
			// A puddle is level, and ripples shiver it while it rains.
			const ripple = t.mx_noise_vec3(
				t.vec3(t.positionWorld.xz.mul(5), (worldTime as unknown as N).mul(1.4).mul(c.rippling))
			);
			const flat = t.transformNormalToView(
				t
					.vec3(ripple.x.mul(0.25).mul(c.rippling), 1, ripple.z.mul(0.25).mul(c.rippling))
					.normalize()
			);
			return t.mix(normal, flat, puddle).normalize();
		}
	};
}

covers.of = make;
