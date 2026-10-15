// The particles' graph (#311), in the lazy `vfx` chunk: the overlay kind's `sheet` variant (an
// atlas is a sheet), registered over the kind's own graphs when the chunk loads, as the decals'
// is on the decal kind (decals.ts). Both pools draw with it, one draw each: an
// InstancedBufferGeometry of one quad whose instances carry only what a spawn wrote once (vfx.ts,
// vfx-state.ts): the origin and seed (`aVfxA`), the birth, recipe, loop ring size and index
// (`aVfxB`). Everything else is a closed form of those and `vfxNow`, the layer's clock: the life
// so far (a loop's wraps its period), the particle's heading, speed, spawn point and wobble from a
// hash of its seed and index, its flight under drag and gravity, its size, spin, colour, fade and
// flipbook frame from its recipe's row in one uniform array (vfx-recipes.ts), so a recipe added,
// a burst or a loop compiles nothing. A dead slot (before its birth or past its end) is size 0.
//
// The quad faces the camera (the camera's own axes, `cameraWorldMatrix`) in world space (the mesh
// stands at the origin), so `worldModify` reads the cells the particle is over: `lit` ones (dust,
// smoke) are lit and darkened as any surface there, emissive ones (sparks, embers) keep their
// glow, and both are fogged, so nothing shows over a player's unexplored cell. Reduced motion (`still`) holds a burst
// at its recipe's still frame, fading over `STILL_MS`, and a loop at its stagger; Reduce flashing
// caps the colour (`flashCap`), so nothing blooms. The air's recipes (#374-#376: the fog-of-war
// cloud, ground mist, halos) take their density from the fog factor at the fragment (`airDensity`),
// a branch on the recipe's row, so they add no program.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { cellUniforms, visibilityAt } from '../cell-maps';
import { LOW_THICK, MIST_STEPS } from '../veil-plan';
import {
	ATLAS_ACROSS,
	HUES,
	HUE_SEEDS,
	MAX_COUNT,
	MAX_RECIPES,
	PHASES,
	RECIPE_VEC4S,
	packRecipes
} from '../vfx-recipes';
import { STILL_MS } from '../vfx-state';
import { slotDefault } from './defaults';
import { flickerNode } from './flicker';
import { lazyGraphs, type Graph } from './kinds';
import { mipBias } from './texture-quality';
import { pick, tsl, type N } from './tsl';
import { weatherGraph } from './weather';
import { worldEmissive, worldFog, worldHidden, worldModify } from './world-modify';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** Per instance: the origin's x, y, z and the seed. */
export const VFX_A = 'aVfxA';
/** Per instance: birth (s), the recipe's index, its loop's ring size (0 a burst), its index. */
export const VFX_B = 'aVfxB';
/** No cap on a particle's colour: Reduce flashing sets 1. */
export const NO_CAP = 1e4;

/** How far (world units) a soft particle takes to fade out against what it meets. */
const SOFT_DISTANCE = 0.5;
/**
 * The prepass's depth, which soft particles and the haze fade against (#326): a sample at the
 * fragment's screen position, pointed at the pipeline's by `VfxLayer.tick`. Always a depth
 * texture, so the graph never changes; a blank one until a pipeline with a prepass is up.
 */
export const blankDepth = new THREE.DepthTexture(1, 1);
export const softDepth = T.texture(blankDepth, T.screenUV) as unknown as N & {
	value: THREE.Texture;
};
/** 1 on medium and up (a prepass to read): the pools that fade (`params.opacity` 1) read the depth. */
export const softOn = T.uniform(0);
/** How far (world units) a soft particle takes to fade out against what it meets (a uniform). */
export const softDistance = T.uniform(SOFT_DISTANCE);

/**
 * The soft-particle fade (NVIDIA's white paper, as three's `softParticles`, which is not imported:
 * its default argument would pull the viewport depth node into the shared chunk): 1 well in front of
 * the opaque scene's depth at this fragment, 0 where the particle meets it, over `distance` world
 * units, on a symmetric contrast curve of power 2.
 */
export function softFade(distance: N | number): N {
	const sceneZ = t.perspectiveDepthToViewZ(softDepth, t.cameraNear, t.cameraFar);
	const delta = tsl.positionView.z.sub(sceneZ).div(distance).saturate();
	const above = delta.greaterThan(0.5);
	const folded = pick(above, delta.oneMinus(), delta).mul(2).saturate().pow(2).mul(0.5);
	return pick(above, folded.oneMinus(), folded);
}

const packed = packRecipes();
/** The layer's clock in seconds (vfx-state.ts `seconds`), set once a frame from the injected clock. */
export const vfxNow = T.uniform(0);
export const vfxUniforms = {
	now: vfxNow,
	/** 1 under reduced motion: bursts hold their still frame, loops their stagger. */
	still: T.uniform(0),
	/** The most a particle's colour may be (Reduce flashing: 1, nothing over it blooms). */
	flashCap: T.uniform(NO_CAP),
	/** The wind on the ground (x, z), world units a second at full carry (#318); 0 in still air. */
	wind: T.uniform(new THREE.Vector2()),
	/** The air's strengths (#374-#376, veil.ts): the fog-of-war cloud, the mist, the halos; 0 off. */
	air: T.uniform(new THREE.Vector3()),
	/**
	 * The fog-of-war cloud's own colour (#374): a fog bank over unexplored ground is drawn in this,
	 * not shaded by the cells (which a player never saw), and writes "shown" to `hidden` (vfxHidden).
	 */
	bank: T.uniform(new THREE.Color(0.3, 0.33, 0.4)),
	recipes: T.uniformArray(
		Array.from({ length: MAX_RECIPES * RECIPE_VEC4S }, (_, i) =>
			new THREE.Vector4().fromArray(packed, i * 4)
		),
		'vec4'
	)
};

/** The drawn material's albedo slot (the atlas) at `at`, with the tier's mip bias (decals.ts's way). */
function atlas(at: N): N {
	const ref = tsl.materialReference('albedoSlot', 'texture') as N & { node: unknown };
	ref.node = tsl.texture(slotDefault('albedo'), at, null, mipBias).setUpdateMatrix(false);
	return ref;
}

/**
 * The air's density at the fragment (#374-#376), from the fog factor `worldModify` works out from the
 * cell maps the viewer was sent (soft edges, reveal fades and all), never from anything on a cell:
 * a fog bank is how hidden the ground is (1 hidden, 0 from the explored level up: black on black),
 * a low cloud thin over explored ground out of sight, mist and halos gone over hidden ground. The
 * GM's levels are the GM's (`fogMode`), and none draws in front of unexplored ground. veil-plan.ts
 * `bankDensity`/`lowDensity` mirror it. Read only for the air's recipes (`code` 16 and up).
 */
function airDensity(code: N): N {
	const c = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
	const { kind, step } = airKind(code);
	const fog = worldFog();
	const e = t.mix(c.exploredLevel, c.gmExploredLevel, c.fogMode);
	const h = t.mix(t.float(0), c.gmHiddenLevel, c.fogMode);
	const bank = e.sub(fog).div(e.sub(h)).saturate();
	const below = fog.sub(h).div(e.sub(h));
	const above = t.float(1).sub(fog).div(t.float(1).sub(e));
	const low = pick(fog.lessThan(e), below, above).saturate().mul(LOW_THICK);
	const veiled = fog.mul(4).saturate();
	// What the ground behind the puff is (the prepass's depth, along the view ray): no mist, low cloud or halo
	// draws in front of a cell a player never explored, so none can lift it off black. Without a depth to
	// read (the low tier, where the air is off anyway) no air draws at all.
	const sceneZ = t.perspectiveDepthToViewZ(softDepth, t.cameraNear, t.cameraFar);
	const view = tsl.positionView.xyz.mul(sceneZ.div(tsl.positionView.z));
	const behind = visibilityAt(
		t.cameraWorldMatrix.mul(t.vec4(view, 1)).xyz as never
	) as unknown as N;
	const shown = t.mix(behind.y, t.float(1), t.max(c.fogMode, t.float(1).sub(c.fogOn)));
	const g = (vfxUniforms.air as unknown as N).mul(shown.mul(softOn));
	// A bank is the cloud over unexplored ground itself: drawn in its own colour (vfxHidden), it
	// is not held back by the ground behind it, only by having a depth to read.
	return pick(
		kind.lessThan(1.5),
		bank.mul((vfxUniforms.air as unknown as N).x.mul(softOn)),
		pick(
			kind.lessThan(2.5),
			low.mul(g.x),
			pick(kind.lessThan(3.5), veiled.mul(step.div(MIST_STEPS)).mul(g.y), veiled.mul(g.z))
		)
	);
}

/** A packed air code's kind (vfx-recipes.ts `AIR`) and mist step; a per-instance integer, interpolated. */
function airKind(code: N): { kind: N; step: N } {
	const whole = t.floor(code.add(0.5));
	const kind = t.floor(whole.div(16));
	return { kind, step: whole.sub(kind.mul(16)) };
}

let built: Graph | null = null;
let bankShown: N | null = null;

/**
 * What the soft pool writes to the scene pass's `hidden` attachment: a fog bank "shown" (0), so
 * the output stage keeps the cloud over the black it covers (the ground under it stays exactly
 * black, its colour 0 by worldModify); every other particle its cell's, as any material.
 */
export function vfxHidden(): N {
	vfxGraph();
	const h = pick(bankShown!, t.float(0), worldHidden());
	return t.mrt({ output: tsl.output, hidden: t.vec4(h, h, h, (tsl.output as N).w) });
}

function vfxGraph(): Graph {
	if (built) return built;
	const u = vfxUniforms as unknown as Record<keyof typeof vfxUniforms, N>;
	const [a, b] = [tsl.attribute(VFX_A, 'vec4'), tsl.attribute(VFX_B, 'vec4')];
	const row = (k: number) => u.recipes.element(t.int(b.y.mul(RECIPE_VEC4S).add(k)));
	// vfx-recipes.ts `packRecipes`: lifetime, speed, gravity, drag; sizes, spin, spread; the colours
	// at birth and death; frame, frames, lit, still; radius, drift, fade-in; wind, tinted.
	const [motion, shape, from, to, look, more, extra] = [0, 1, 2, 3, 4, 5, 6].map(row);
	const lifetime = motion.x;
	const age = u.now.sub(b.x);
	const looping = b.z.greaterThan(0.5);
	const stillFor = STILL_MS / 1000;
	// Seconds into its life: a loop's wraps its period (births staggered over it); held still.
	const loopAge = t.mod(t.mix(age, b.x.negate(), u.still), lifetime);
	const sec = pick(looping, loopAge, t.mix(age, look.w.mul(lifetime), u.still));
	const x = sec.div(lifetime).clamp(0, 1);
	// A burst lives from its birth to its end (its still frame's STILL_MS, fading, when still).
	const end = t.mix(lifetime, t.float(stillFor), u.still);
	const alive = pick(looping, t.float(1), t.step(0, age).mul(t.step(age, end)));
	const stillFade = t.float(1).sub(age.div(stillFor)).clamp(0, 1);
	const fade = pick(looping, t.float(1), t.mix(t.float(1), stillFade, u.still));
	// Recipe flags (vfx-recipes.ts `packRecipes`): bit 0 breathes with its light's flicker (the seed
	// carries profile and phase, `flameSeed`), bit 1 lies on the floor.
	const flags = more.w;
	const flat = t.floor(flags.div(2));
	const breathes = flags.sub(flat.mul(2));
	const profile = t.min(t.floor(a.w.div(PHASES)), 5);
	const breath = t.mix(
		t.float(1),
		flickerNode(profile, a.w.sub(profile.mul(PHASES)).div(PHASES)),
		breathes.mul(4)
	);
	// Its own random streams: seeds below SEEDS and indices below MAX_COUNT stay exact in a float.
	const base = a.w.mul(MAX_COUNT * 16).add(b.w.mul(16));
	const h = (j: number) => t.hash(base.add(j));
	// Heading: round the vertical, up to `spread` of the way down; speed 50-100% of the recipe's.
	const turn = h(0).mul(2 * Math.PI);
	const rise = t.float(1).sub(shape.w.mul(2).mul(h(1)));
	const side = t.sqrt(t.max(t.float(1).sub(rise.mul(rise)), 0));
	const heading = t.vec3(side.mul(t.cos(turn)), rise, side.mul(t.sin(turn)));
	const speed = motion.y.mul(t.mix(0.5, 1, h(2)));
	// Under drag d the distance flown is v (1 - e^-dt) / d, written so that d = 0 gives v t.
	const dt = t.max(motion.w.mul(sec), 1e-4);
	const flown = sec.mul(t.float(1).sub(t.exp(dt.negate())).div(dt));
	const disc = more.x.mul(t.sqrt(h(3)));
	const round = h(4).mul(2 * Math.PI);
	const wobble = t
		.vec2(
			t.sin(sec.mul(1.7).add(h(5).mul(2 * Math.PI))),
			t.cos(sec.mul(1.3).add(h(6).mul(2 * Math.PI)))
		)
		.mul(more.y);
	const fall = sec.mul(sec).mul(motion.z).mul(-0.5);
	const centre = a.xyz
		.add(t.vec3(disc.mul(t.cos(round)).add(wobble.x), fall, disc.mul(t.sin(round)).add(wobble.y)))
		.add(heading.mul(speed.mul(flown)))
		.add(t.vec3(u.wind.x, 0, u.wind.y).mul(extra.x.mul(sec)));
	// The quad, sized, turned and facing the camera (its own right and up, in world space).
	const size = t
		.mix(shape.x, shape.y, x)
		.mul(t.mix(0.7, 1.3, h(7)))
		.mul(alive)
		.mul(breath);
	const angle = h(8)
		.mul(2 * Math.PI)
		.add(shape.z.mul(sec));
	const corner = tsl.positionGeometry.xy.mul(size);
	const [c, s] = [t.cos(angle), t.sin(angle)];
	const turned = t.vec4(
		corner.x.mul(c).sub(corner.y.mul(s)),
		corner.x.mul(s).add(corner.y.mul(c)),
		0,
		0
	);
	const position = pick(
		flat.greaterThan(0.5),
		centre.add(t.vec3(turned.x, 0, turned.y)),
		centre.add(t.cameraWorldMatrix.mul(turned).xyz)
	);
	// Colour, fade and flipbook frame, once a vertex.
	const colour = t.mix(from, to, x);
	// A tinted effect turns its hue by the step its seed carries (vfx-recipes.ts `HUES`).
	const turnBy = t
		.floor(a.w.div(HUE_SEEDS))
		.mul((2 * Math.PI) / HUES)
		.mul(extra.y);
	const hued = t.mix(colour.xyz, t.hue(colour.xyz, turnBy), extra.y);
	const alpha = colour.w.mul(t.smoothstep(0, t.max(more.z, 1e-3), x)).mul(fade);
	const frame = look.x.add(t.min(t.floor(x.mul(look.y)), look.y.sub(1)));
	const cell = t.vec2(t.mod(frame, ATLAS_ACROSS), t.floor(frame.div(ATLAS_ACROSS)));
	const tone = tsl.varying(t.vec4(t.min(hued, u.flashCap), alpha), 'vVfxColour');
	// The air's kind and a mist's density step (its seed above HUE_SEEDS), packed: kind x 16 + step.
	const airCode = extra.z.mul(16).add(t.floor(a.w.div(HUE_SEEDS)));
	const sheet = tsl.varying(t.vec4(cell, look.z, airCode), 'vVfxCell');
	const sprite = atlas(sheet.xy.add(tsl.uv()).div(ATLAS_ACROSS));
	// The flash scattering through the cloud and the mist (#376): Reduce flashing dims the flash
	// itself (cellUniforms.flash, flash.ts `flashPolicy`) and caps the colour.
	const { kind } = airKind(sheet.w);
	const scatters = pick(kind.greaterThan(0.5).and(kind.lessThan(3.5)), t.float(0.6), t.float(0));
	const scatter = scatters.mul((cellUniforms as unknown as Record<'flash', N>).flash);
	const glow = t.min(tone.xyz.mul(sprite.xyz).add(t.vec3(0.75, 0.85, 1).mul(scatter)), u.flashCap);
	// Soft particles (#326): a pool whose material's `opacity` param is 1 (smoke, dust, motes) fades
	// out where it meets the opaque scene, on medium and up. A branch on uniforms, so the tier
	// switches it without a recompile and low reads no depth (the additive pool never does).
	const seen = tone.w.mul(sprite.w);
	const fades = tsl.materialReference('params.opacity', 'float').mul(softOn);
	const Fn = t.Fn as unknown as (f: () => N) => () => N;
	const opacity = Fn(() => {
		const o = seen.toVar();
		t.If(fades.greaterThan(0.5), () => {
			o.assign(seen.mul(softFade(softDistance as unknown as N)));
		});
		// The air's recipes (#374-#376): their density from the cell maps, only for them.
		t.If(sheet.w.greaterThan(15.5), () => {
			o.assign(o.mul(airDensity(sheet.w)));
		});
		return o;
	})();
	// A fog bank (#374) is the cloud over ground the viewer never saw: its own colour, never the
	// cells' (worldModify would make it black on black), scattering the flash like the rest.
	const isBank = kind.greaterThan(0.5).and(kind.lessThan(1.5));
	bankShown = isBank;
	const bankColour = (u.bank as N).mul(sprite.xyz).add(t.vec3(0.75, 0.85, 1).mul(scatter));
	const out = tsl.output as N;
	built = {
		colorNode: t.vec4(glow, 1),
		opacityNode: opacity,
		alphaTestNode: null,
		positionNode: position,
		castShadowPositionNode: null,
		// Lit: shaded by its cell's light; emissive: its glow kept. Fogged either way; a bank is not.
		outputNode: pick(
			isBank,
			t.vec4(t.min(bankColour, u.flashCap), out.w),
			worldModify(tsl.output, worldEmissive(glow.mul(t.float(1).sub(sheet.z))))
		),
		lit: null
	};
	return built;
}

// The sheet variant of the overlay kind, and the weather's (#320); its others fall through to
// kinds.ts (`??`).
lazyGraphs.overlay = (variant) =>
	variant.sheet ? vfxGraph() : variant.weather ? weatherGraph() : (undefined as unknown as Graph);
