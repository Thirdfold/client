// The water kind's graph (#293), in the lazy `water-layer` chunk: registered with the kinds
// (`lazyGraphs`) when the chunk loads, which the lobby and every table wait for before making a
// water material. Wadeable water is blended, its alpha from `1 - clarity` at the shore to 1 at
// `ramp` cells out, so the bed shows through the shallows and the parts of a mini under the
// surface take its colour; deep water is the same graph in an opaque material (`deep`). Both
// read the shore field (#292, shore-map.ts) for their depth colour, a foam band cut by the
// ripples' height, and ripples damped near the shore: two world-space samples of one normal map
// scrolling on the world's clock (`worldTime`, still under reduced motion), one on the low tier
// (the variant's `antiTiled` is the tier's medium and up). Low roughness lets the sun glint and
// the sky's environment map give the fresnel. The foam's rim glows (`rimGlow`, plus `flashRim`
// times the Bell's flash, `cellUniforms.flash`), above 1 only in a flash, so bloom catches it
// then. Every preset value is a uniform (`waterUniforms`, set per environment), so nothing here
// compiles at runtime. `worldModify` comes last, emissive included: an unexplored cell's water
// is 0.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import type { WaterLook } from '$lib/assets/manifest';
import { cellUniforms, cellUV } from '../cell-maps';
import { MAP_SIDE } from '../cell-maps-kept';
import { SHORE_MAX, SHORE_TEXELS } from '../world/shore-scale';
import { slotDefault } from './defaults';
import { lazyGraphs, worldTime, type Graph, type Variant } from './kinds';
import { tsl, type N } from './tsl';
import { worldEmissive, worldModify } from './world-modify';

/** One repeat of the ripples covers this many cells; the second sample is this much finer. */
export const RIPPLE_CELLS = 3;
const FINER = 2.3;
/** How far a ripple tilts the normal in open water, and near the shore (calmer). */
const RELIEF = { open: 0.9, shore: 0.25 };

/** The village's preset: what a table shows until its environment's water arrives. */
const DEFAULT: WaterLook & { color: string; roughness: number } = {
	color: '#3f9c94',
	roughness: 0.06,
	deep: '#0d3b48',
	foam: '#e6f2ec',
	rim: '#9fe3dc',
	ramp: 1.6,
	foamWidth: 0.35,
	clarity: 0.65,
	flowSpeed: 0.03,
	rimGlow: 0,
	flashRim: 0
};

const colour = (hex: string) => T.uniform(new THREE.Color(hex));
/** The preset (`setWaterLook`): uniforms every water material reads. */
export const waterUniforms = {
	shallow: colour(DEFAULT.color),
	deep: colour(DEFAULT.deep),
	foam: colour(DEFAULT.foam),
	rim: colour(DEFAULT.rim),
	roughness: T.uniform(DEFAULT.roughness),
	ramp: T.uniform(DEFAULT.ramp),
	foamWidth: T.uniform(DEFAULT.foamWidth),
	clarity: T.uniform(DEFAULT.clarity),
	flowSpeed: T.uniform(DEFAULT.flowSpeed),
	rimGlow: T.uniform(DEFAULT.rimGlow),
	flashRim: T.uniform(DEFAULT.flashRim)
};

/**
 * Puts a preset on the water, or the default back with null. Compiles nothing. The manifest's
 * parser only checks the preset is an object (the pipeline checks it whole), so a value that is not
 * a colour or a number in its range keeps the default's.
 */
export function setWaterLook(
	look: (WaterLook & { color: string; roughness: number }) | null
): void {
	const p = look ?? DEFAULT;
	const u = waterUniforms;
	const tone = (v: unknown, d: string) =>
		typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v) ? v : d;
	const num = (v: unknown, d: number, lo = 0, hi = 8) =>
		typeof v === 'number' && v >= lo && v <= hi ? v : d;
	u.shallow.value.set(tone(p.color, DEFAULT.color));
	u.deep.value.set(tone(p.deep, DEFAULT.deep));
	u.foam.value.set(tone(p.foam, DEFAULT.foam));
	u.rim.value.set(tone(p.rim, DEFAULT.rim));
	u.roughness.value = num(p.roughness, DEFAULT.roughness, 0, 1);
	u.ramp.value = num(p.ramp, DEFAULT.ramp, 0.05);
	u.foamWidth.value = num(p.foamWidth, DEFAULT.foamWidth, 0.01);
	u.clarity.value = num(p.clarity, DEFAULT.clarity, 0, 1);
	u.flowSpeed.value = num(p.flowSpeed, DEFAULT.flowSpeed);
	u.rimGlow.value = num(p.rimGlow, DEFAULT.rimGlow);
	u.flashRim.value = num(p.flashRim, DEFAULT.flashRim);
}

const loose = (node: unknown) => node as N;
/** The kept shore texture's side (shore-map.ts `SHORE_SIDE`). */
const SIDE = MAP_SIDE * SHORE_TEXELS;
const min = T.min as unknown as (a: N, b: N) => N;
/** The fragment's place on the shore field, in texels, held inside the grid (as `visibilitySmooth`). */
const across = loose(cellUniforms.gridSize).mul(SHORE_TEXELS);
const texels = min(tsl.max(loose(cellUV).mul(across), 0.5), across.sub(0.5));
/**
 * The shore field's blank, sampled as the field is (R8, linear, clamped): 255, open water, until a
 * table's field is in. Never disposed.
 */
export const BLANK_SHORE = new THREE.DataTexture(
	new Uint8Array([255]),
	1,
	1,
	THREE.RedFormat,
	THREE.UnsignedByteType,
	undefined,
	undefined,
	undefined,
	THREE.LinearFilter,
	THREE.LinearFilter
);
BLANK_SHORE.needsUpdate = true;
/** A texture node, whose texture can change. */
type Sampled = N & { value: THREE.Texture };
/** The shore field and the ripples: the water layer puts the table's textures in. */
const maps = {
	shore: tsl.texture(BLANK_SHORE, texels.div(SIDE)) as Sampled,
	ripples: [] as Sampled[]
};
const ripple = slotDefault('normal');

function waterGraph(variant: Variant): Graph {
	const u = waterUniforms as unknown as Record<string, N>;
	// Distance to the shore in cells, and how deep that reads.
	const d = maps.shore.x.mul(SHORE_MAX);
	const depth = tsl.smoothstep(0, u.ramp, d);
	// The ripples: world-space samples drifting on the world's clock.
	const at = tsl.positionWorld.xz.div(loose(cellUniforms.cellSize).mul(RIPPLE_CELLS));
	const drift = loose(worldTime).mul(u.flowSpeed);
	const first = tsl.texture(ripple, at.add(tsl.vec2(drift, drift.mul(0.6)))) as Sampled;
	const second = tsl.texture(
		ripple,
		at.mul(FINER).add(tsl.vec2(drift.mul(-0.7), drift))
	) as Sampled;
	maps.ripples.push(first, second);
	const tilt = variant.antiTiled ? first.xy.add(second.xy).sub(1) : first.xy.mul(2).sub(1);
	const height = variant.antiTiled ? first.w.add(second.w).mul(0.5) : first.w;
	const relief = tsl.mix(RELIEF.shore, RELIEF.open, tsl.smoothstep(0, 1, d));
	const n = tsl.vec3(tilt.x.mul(relief), 1, tilt.y.mul(relief)).normalize();
	// Foam: strongest at the shore, its outer edge broken by the ripples' height.
	const band = d.div(u.foamWidth).oneMinus().saturate();
	const foam = tsl.smoothstep(0.35, 0.55, band.add(height.sub(0.5).mul(0.6)));
	const albedo = tsl.mix(tsl.mix(u.shallow, u.deep, depth), u.foam, foam);
	const alpha = tsl.max(tsl.mix(u.clarity.oneMinus(), 1, depth), foam);
	// The rim: the foam glowing, above 1 only in a flash.
	const flash = loose(cellUniforms.flash);
	const glow = u.rim.mul(foam).mul(u.rimGlow.add(flash.mul(u.flashRim)));
	const emissive = worldEmissive(glow);
	return {
		colorNode: tsl.vec4(albedo, 1),
		opacityNode: alpha, // 1 where the material is opaque: deep water (index.ts `deep`)
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, emissive, true),
		lit: {
			roughnessNode: u.roughness.add(foam.mul(0.5)),
			metalnessNode: loose(T.float(0)),
			aoNode: loose(T.float(1)),
			normalNode: n.transformDirection(tsl.cameraViewMatrix).normalize(),
			emissiveNode: emissive,
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}

lazyGraphs.water = waterGraph;

/** Puts the ripples' normal map in, or the blank back with null. Compiles nothing. */
export function setRipples(texture: THREE.Texture | null): void {
	for (const node of maps.ripples) node.value = texture ?? ripple;
}

/**
 * Puts a table's shore field in, or with null takes `was` out (if it is still in) for the blank.
 * Compiles nothing: the blank is sampled as the field is.
 */
export function setShore(texture: THREE.Texture | null, was?: THREE.Texture): void {
	if (texture) maps.shore.value = texture;
	else if (maps.shore.value === was) maps.shore.value = BLANK_SHORE;
}
