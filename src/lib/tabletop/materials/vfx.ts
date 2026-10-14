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
// caps the colour (`flashCap`), so nothing blooms.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import {
	ATLAS_ACROSS,
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
import { worldEmissive, worldModify } from './world-modify';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** Per instance: the origin's x, y, z and the seed. */
export const VFX_A = 'aVfxA';
/** Per instance: birth (s), the recipe's index, its loop's ring size (0 a burst), its index. */
export const VFX_B = 'aVfxB';
/** No cap on a particle's colour: Reduce flashing sets 1. */
export const NO_CAP = 1e4;

const packed = packRecipes();
/** The layer's clock in seconds (vfx-state.ts `seconds`), set once a frame from the injected clock. */
export const vfxNow = T.uniform(0);
export const vfxUniforms = {
	now: vfxNow,
	/** 1 under reduced motion: bursts hold their still frame, loops their stagger. */
	still: T.uniform(0),
	/** The most a particle's colour may be (Reduce flashing: 1, nothing over it blooms). */
	flashCap: T.uniform(NO_CAP),
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

let built: Graph | null = null;

function vfxGraph(): Graph {
	if (built) return built;
	const u = vfxUniforms as unknown as Record<keyof typeof vfxUniforms, N>;
	const [a, b] = [tsl.attribute(VFX_A, 'vec4'), tsl.attribute(VFX_B, 'vec4')];
	const row = (k: number) => u.recipes.element(t.int(b.y.mul(RECIPE_VEC4S).add(k)));
	// vfx-recipes.ts `packRecipes`: lifetime, speed, gravity, drag; sizes, spin, spread; the colours
	// at birth and death; frame, frames, lit, still; radius, drift, fade-in.
	const [motion, shape, from, to, look, more] = [0, 1, 2, 3, 4, 5].map(row);
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
		.add(heading.mul(speed.mul(flown)));
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
	const alpha = colour.w.mul(t.smoothstep(0, t.max(more.z, 1e-3), x)).mul(fade);
	const frame = look.x.add(t.min(t.floor(x.mul(look.y)), look.y.sub(1)));
	const cell = t.vec2(t.mod(frame, ATLAS_ACROSS), t.floor(frame.div(ATLAS_ACROSS)));
	const tone = tsl.varying(t.vec4(t.min(colour.xyz, u.flashCap), alpha), 'vVfxColour');
	const sheet = tsl.varying(t.vec3(cell, look.z), 'vVfxCell');
	const sprite = atlas(sheet.xy.add(tsl.uv()).div(ATLAS_ACROSS));
	const glow = tone.xyz.mul(sprite.xyz);
	built = {
		colorNode: t.vec4(glow, 1),
		opacityNode: tone.w.mul(sprite.w),
		alphaTestNode: null,
		positionNode: position,
		castShadowPositionNode: null,
		// Lit: shaded by its cell's light; emissive: its glow kept. Fogged either way.
		outputNode: worldModify(tsl.output, worldEmissive(glow.mul(t.float(1).sub(sheet.z)))),
		lit: null
	};
	return built;
}

// The sheet variant of the overlay kind, and the weather's (#320); its others fall through to
// kinds.ts (`??`).
lazyGraphs.overlay = (variant) =>
	variant.sheet ? vfxGraph() : variant.weather ? weatherGraph() : (undefined as unknown as Graph);
