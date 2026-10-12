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
import { voronoi2d } from 'three/addons/tsl/math/voronoiNoise.js';
import type { WaterLook } from '$lib/assets/manifest';
import { cellUniforms } from '../cell-maps';
import { MAP_SIDE } from '../cell-maps-kept';
import { STEP_HEIGHT } from '../ground';
import { SHORE_MAX, SHORE_TEXELS } from '../world/shore-scale';
import { SWELL_GRAVITY, SWELL_RAMP_CELLS, WAVES } from '../world/swell';
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
const cells = tsl.positionWorld.xz
	.div(loose(cellUniforms.cellSize))
	.add(loose(cellUniforms.gridSize).mul(0.5));
const texels = min(tsl.max(cells.mul(SHORE_TEXELS), 0.5), across.sub(0.5));
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
/**
 * The ripples' blank, flat, sampled as the normal slot's textures are (defaults.ts `SLOTS.normal`:
 * linear, repeating, mipmapped), so the loaded map takes its place without a new program.
 */
const ripple = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
ripple.minFilter = THREE.LinearMipmapLinearFilter;
ripple.generateMipmaps = ripple.needsUpdate = true;

function waterGraph(variant: Variant): Graph {
	const u = waterUniforms as unknown as Record<string, N>;
	// Distance to the shore in cells, and how deep that reads.
	// Past the grid (the sea ring, #296) the border's distance runs on.
	const d = maps.shore.x.mul(SHORE_MAX).add(beyond(tsl.positionWorld.xz));
	const depth = tsl.smoothstep(0, u.ramp, d);
	// The ripples: world-space samples drifting on the world's clock, the first down the flow (#295).
	const at = tsl.positionWorld.xz.div(loose(cellUniforms.cellSize).mul(RIPPLE_CELLS));
	const drift = loose(worldTime).mul(u.flowSpeed);
	const first = flowed(at.add(tsl.vec2(drift, drift.mul(0.6))));
	const second = tsl.texture(
		ripple,
		at.mul(FINER).add(tsl.vec2(drift.mul(-0.7), drift))
	) as Sampled;
	maps.ripples.push(second);
	const tilt = variant.antiTiled ? first.xy.add(second.xy).sub(1) : first.xy.mul(2).sub(1);
	const height = variant.antiTiled ? first.w.add(second.w).mul(0.5) : first.w;
	const relief = tsl.mix(RELIEF.shore, RELIEF.open, tsl.smoothstep(0, 1, d));
	const slope = swellSlope(tsl.positionWorld.xz, variant); // the swell's (#296), 0 in the grid
	const n = tsl
		.vec3(tilt.x.mul(relief).sub(slope.x), 1, tilt.y.mul(relief).sub(slope.y))
		.normalize();
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
		positionNode: swellPosition(variant),
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

lazyGraphs.water = (variant) =>
	variant.fall ? fallGraph(variant) : variant.lava ? lavaGraph(variant) : waterGraph(variant);

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

// ---- Flow (#295): the `flow` cell map and two-phase sampling --------------------------------

/**
 * The flow map's blank: no flow (128, 128), sampled as the kept map is (shore-map.ts `flow`: RG8,
 * linear, clamped), so putting a table's flow in compiles nothing. Never disposed.
 */
export const BLANK_FLOW = new THREE.DataTexture(
	new Uint8Array([128, 128]),
	1,
	1,
	THREE.RGFormat,
	THREE.UnsignedByteType,
	undefined,
	undefined,
	undefined,
	THREE.LinearFilter,
	THREE.LinearFilter
);
BLANK_FLOW.needsUpdate = true;
/** The flow map, a texel a cell, its sample held inside the grid (as the shore's). */
const flowMap = tsl.texture(
	BLANK_FLOW,
	min(tsl.max(cells, 0.5), loose(cellUniforms.gridSize).sub(0.5)).div(MAP_SIDE)
) as Sampled;
/** A flow byte's zero and scale (world/flow.ts `FLOW_ZERO`, `flowOf`). */
const [ZERO, SCALE] = [128 / 255, 127 / 255];
/** Flow cycles a second: 900 whole cycles before `worldTime` wraps (an hour), so none jumps. */
const FLOW_RATE = 0.25;
/** How far a full flow carries a sample in a cycle, in the sample's repeats. */
const FLOW_REACH = 0.5;

/** Puts a table's flow map in, or with null takes `was` out (if it is still in). Compiles nothing. */
export function setFlow(texture: THREE.Texture | null, was?: THREE.Texture): void {
	if (texture) flowMap.value = texture;
	else if (flowMap.value === was) flowMap.value = BLANK_FLOW;
}

/** Cells beyond the grid's rectangle at `xz` (world units): 0 on and inside it. */
function beyond(xz: N): N {
	const half = loose(cellUniforms.gridSize).mul(loose(cellUniforms.cellSize)).mul(0.5);
	return xz.abs().sub(half).max(0).length().div(loose(cellUniforms.cellSize));
}

/** The flow here, in cells a cycle at full flow; it dies away over the sea ring's first cells. */
function flowVector(): N {
	const out = tsl.smoothstep(0, SWELL_RAMP_CELLS, beyond(tsl.positionWorld.xz)).oneMinus();
	return flowMap.xy.sub(ZERO).div(SCALE).mul(out);
}

/**
 * `sample(offset)` twice, offset down the flow by `fract(phase)` and `fract(phase + 0.5)` of a
 * cycle and weighted as world/flow.ts `flowWeights`: each weight is 0 as its offset wraps, so no
 * reset shows. Stateless on the world's clock (still under reduced motion).
 */
function twoPhase(sample: (offset: N) => N, reach = FLOW_REACH): N {
	const phase = loose(worldTime).mul(FLOW_RATE);
	const [f0, f1] = [phase.fract(), phase.add(0.5).fract()];
	const v = flowVector().mul(reach);
	return tsl.mix(sample(v.mul(f0)), sample(v.mul(f1)), f0.mul(2).oneMinus().abs());
}

/** The ripple map at `at`, carried down the flow (two samples). */
function flowed(at: N): N {
	return twoPhase((o) => {
		const node = tsl.texture(ripple, at.sub(o)) as Sampled;
		maps.ripples.push(node);
		return node;
	});
}

// ---- Swell (#296): Gerstner waves on the sea ring, from world/swell.ts -----------------------

/** The swell's haze (where it flattens) and the tier's fourth wave (medium 0, high and up 1). */
const swell = { fade: T.uniform(new THREE.Vector2(1e6, 2e6)), fourth: T.uniform(1) };

/** The haze's range the swell flattens over (the span's), and whether the fourth wave runs. */
export function setSwell(fadeNear: number, fadeFar: number, fourth: boolean): void {
	swell.fade.value.set(fadeNear, Math.max(fadeFar, fadeNear + 1));
	swell.fourth.value = fourth ? 1 : 0;
}

/** `worldTime` wraps every hour: each wave's speed is rounded to whole turns an hour. */
const omega = (k: number) =>
	(2 * Math.PI * Math.round((Math.sqrt(SWELL_GRAVITY * k) * 3600) / (2 * Math.PI))) / 3600;

/**
 * The waves at `xz` (world units), as world/swell.ts `swellAt` (its ramp times the haze's fade):
 * the displacement and the height's slope. Two waves on low, four on medium and up (the fourth
 * `swell.fourth`).
 */
function waves(xz: N, variant: Variant): { lift: N; slope: N } {
	const cs = loose(cellUniforms.cellSize);
	const fade = loose(swell.fade);
	const ramp = tsl
		.smoothstep(0, SWELL_RAMP_CELLS, beyond(xz))
		.mul(tsl.smoothstep(fade.x, fade.y, xz.length()).oneMinus());
	const rise = cs.mul(STEP_HEIGHT).mul(ramp);
	let lift = tsl.vec3(0, 0, 0);
	let slope = tsl.vec2(0, 0);
	WAVES.slice(0, variant.antiTiled ? 4 : 2).forEach((w, i) => {
		const [dx, dz] = [Math.cos(w.angle), Math.sin(w.angle)];
		const k = (2 * Math.PI) / w.wavelength;
		const along = xz.x.mul(dx).add(xz.y.mul(dz)).div(cs);
		const theta = along
			.mul(k)
			.sub(loose(worldTime).mul(omega(k)))
			.add(w.phase);
		const a = rise.mul(w.amplitude).mul(i === 3 ? loose(swell.fourth) : 1);
		const [sin, cos] = [theta.sin(), theta.cos()];
		const pull = a.mul(w.steepness).mul(cos);
		lift = lift.add(tsl.vec3(pull.mul(dx), a.mul(sin), pull.mul(dz)));
		slope = slope.add(tsl.vec2(dx, dz).mul(a.mul(k).mul(cos).div(cs)));
	});
	return { lift, slope };
}

/** Where a vertex goes: lifted by the swell, which is 0 on the grid and its border. */
function swellPosition(variant: Variant): N {
	return tsl.positionLocal.add(waves(tsl.positionLocal.xz, variant).lift);
}

/** The swell's slope at a fragment, for its normal (0 in the grid). */
function swellSlope(xz: N, variant: Variant): N {
	return waves(xz, variant).slope;
}

// ---- Falls (#295): the drop edges' quads (world/water.ts `chunkFalls`) ------------------------

/** Streaks' and churn's fall, in the ripples' repeats a second: whole turns an hour. */
const FALL_SPEED = 0.5;

/**
 * A waterfall: the water's colour streaked by the ripples' height stretched down the drop and
 * scrolling, a white churn band over the bottom fifth (broken by a second, faster sample on
 * medium and up), a fresnel sheen, soft sides. Blended, lit, never displaced.
 */
function fallGraph(variant: Variant): Graph {
	const u = waterUniforms as unknown as Record<string, N>;
	const cs = loose(cellUniforms.cellSize);
	const p = tsl.positionWorld;
	const along = p.x.add(p.z).div(cs); // one of x and z is constant on a quad
	const down = p.y.div(cs);
	const t = loose(worldTime).mul(FALL_SPEED);
	const at = (x: number, y: number, speed: number) => {
		const node = tsl.texture(ripple, tsl.vec2(along.mul(x), down.mul(y).add(t.mul(speed))));
		maps.ripples.push(node as Sampled);
		return node;
	};
	const streak = at(0.6, 0.15, 1).w;
	const where = tsl.uv();
	const band = tsl.smoothstep(0.78, 1, where.y);
	const churn = variant.antiTiled
		? band.mul(at(1.7, 0.9, 2).w.mul(0.6).add(0.55)).saturate()
		: band;
	const foam = tsl.max(churn, tsl.smoothstep(0.6, 0.85, streak).mul(0.45));
	const facing = tsl.normalView.dot(tsl.positionView.normalize().negate()).abs();
	const fresnel = facing.oneMinus().pow(3);
	const sides = tsl
		.smoothstep(0, 0.08, where.x)
		.mul(tsl.smoothstep(0, 0.08, where.x.oneMinus()))
		.mul(tsl.smoothstep(0, 0.04, where.y));
	const albedo = tsl.mix(tsl.mix(u.shallow, u.deep, 0.4), u.foam, foam);
	const alpha = tsl.max(streak.mul(0.35).add(0.45).add(fresnel.mul(0.3)), foam).mul(sides);
	const flash = loose(cellUniforms.flash);
	const emissive = worldEmissive(u.rim.mul(foam).mul(u.rimGlow.add(flash.mul(u.flashRim))));
	return {
		colorNode: tsl.vec4(albedo, 1),
		opacityNode: alpha.saturate(),
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, emissive, true),
		lit: {
			roughnessNode: u.roughness.add(foam.mul(0.5)),
			metalnessNode: loose(T.float(0)),
			aoNode: loose(T.float(1)),
			normalNode: tsl.normalView,
			emissiveNode: emissive,
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}

// ---- Lava (#297): a voronoi crust over molten seams --------------------------------------------

/** A crust plate is about this many cells across. */
const LAVA_CELLS = 1.4;
/** The crust, and the molten glow, HDR on the seams (3 to 6) so bloom takes them. */
const LAVA = { crust: '#1c0a06', molten: '#ff5a1f', glow: [3, 6] } as const;
/** The plates' slow churn, radians a second: whole turns an hour. */
const MORPH = (2 * Math.PI * 360) / 3600;
const voronoi = voronoi2d as unknown as (p: N, time: N) => N;

/**
 * Lava: dark plates from `voronoi2d` on world x-z (one octave on low, a finer second on medium
 * and up), each carried down the flow in two phases, glowing between them at 3 to 6 and brighter
 * still along its bank (the shore field: `params.opacity` is the rim's strength, 0 under the
 * molten chasm, where there is no bank). Opaque (`deep`), lit; `worldEmissive` dims it where the
 * rules keep a cell dark.
 */
function lavaGraph(variant: Variant): Graph {
	const cs = loose(cellUniforms.cellSize);
	const p = tsl.positionWorld.xz.div(cs.mul(LAVA_CELLS));
	const morph = loose(worldTime).mul(MORPH);
	let crust = twoPhase((o) => voronoi(p.sub(o), morph));
	if (variant.antiTiled)
		crust = tsl.mix(
			crust,
			twoPhase((o) => voronoi(p.sub(o).mul(2.3), morph.mul(1.3))),
			0.35
		);
	const seam = tsl.smoothstep(0.3, 0.7, crust);
	const bank = maps.shore.x.mul(SHORE_MAX).div(0.9).oneMinus().saturate();
	const rim = bank.mul(bank).mul(tsl.materialReference('params.opacity', 'float'));
	const heat = tsl.max(seam, rim);
	const molten = loose(T.color(LAVA.molten));
	const albedo = tsl.mix(loose(T.color(LAVA.crust)), molten.mul(0.35), heat);
	const glow = molten.mul(tsl.mix(LAVA.glow[0], LAVA.glow[1], seam)).mul(heat);
	const emissive = worldEmissive(glow);
	return {
		colorNode: tsl.vec4(albedo, 1),
		opacityNode: null,
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, emissive, true),
		lit: {
			roughnessNode: tsl.mix(0.92, 0.45, heat),
			metalnessNode: loose(T.float(0)),
			aoNode: loose(T.float(1)),
			normalNode: tsl.vec3(0, 1, 0).transformDirection(tsl.cameraViewMatrix).normalize(),
			emissiveNode: emissive,
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}
