// The particle layer's recipes (#311): what a burst or a loop looks like, as data. Every recipe is
// packed into one uniform array (`packRecipes`, `RECIPE_VEC4S` vec4s each) that the particle graph
// indexes by the instance's recipe number (materials/vfx.ts), so adding a recipe here adds a row,
// never a program. Pure: no three.js, tested in vfx-state.spec.ts. Units are world units (a cell is
// `cellSize`, 1 on every shipped table) and seconds; colours linear RGB, above 1 blooming.
//
// To add a recipe: append an entry to `RECIPES` (never reorder: the index is the instance's data)
// with an atlas cell from `ATLAS` (the `vfx-sprites` texture, server/assets/vfx-art.ts), keeping
// within `MAX_RECIPES`. Fire's and the toll's are vfx-recipes-fire.ts (the file's size).

import { fireRecipes } from './vfx-recipes-fire';

/** The two pools (vfx.ts): one draw each. */
export type PoolName = 'additive' | 'soft';
export const POOLS: readonly PoolName[] = ['additive', 'soft'];

/** The `vfx-sprites` atlas: `ATLAS_ACROSS` cells a side, row-major from the bottom (decal-art.ts's layout). */
export const ATLAS_ACROSS = 4;
/** Each sprite's cell; the puff is a flipbook of `PUFF_FRAMES` cells. */
export const ATLAS = { disc: 0, spark: 1, puff: 2, ring: 6, shield: 7, plus: 8, flame: 9 } as const;
export const PUFF_FRAMES = 4;

export interface VfxRecipe {
	/** The pool that draws it: additive (sparks, embers, glints; unsorted) or soft (smoke, dust, motes). */
	pool: PoolName;
	/** Particles in a burst, or in a loop's ring (1 to `MAX_COUNT`). */
	count: number;
	/** Seconds a particle lives (a loop's period). */
	lifetime: number;
	/** World units a second at birth, each particle 50% to 100% of it. */
	speed: number;
	/** World units a second², downward; negative rises (heat). */
	gravity: number;
	/** Per second: how fast the speed dies away (0 keeps it). */
	drag: number;
	/** Where particles head: 0 straight up, 0.5 a hemisphere, 1 every way. */
	spread: number;
	/** The disc particles are born in, world units across its radius. */
	radius: number;
	/** World units across, at birth and at death (each particle 70% to 130% of it). */
	size: [number, number];
	/** Radians a second (each particle starts turned at random). */
	spin: number;
	/** Linear RGB and alpha at birth and at death. */
	from: [number, number, number, number];
	to: [number, number, number, number];
	/** The atlas cell of its first frame, and how many frames play over a life (a flipbook). */
	frame: number;
	frames: number;
	/** 1 lit by its cell's light (dust, smoke, motes in lamplight), 0 emissive (sparks, embers). */
	lit: number;
	/** The fraction of a life drawn, still, under reduced motion (a burst's static frame). */
	still: number;
	/** A sideways wobble, world units. */
	drift: number;
	/** The fraction of a life it fades in over. */
	fadeIn: number;
	/**
	 * 1 breathes with its light (#312): the loop's seed carries a flicker profile and phase
	 * (`flameSeed`), and size follows that light's shader flicker (materials/flicker.ts).
	 */
	breathe: 0 | 1;
	/** 1 lies on the floor (a shockwave, a wave), turned about the vertical, not facing the camera. */
	flat: 0 | 1;
}

/** Most particles in one burst or loop; the shader's random streams are spaced by it. */
export const MAX_COUNT = 256;
/** A flicker profile's share of a seed (`FLICKERS` has 6, so 6 x 682 fits `SEEDS`). */
export const PHASES = 682;
/** A seed that carries a light's flicker profile and its 0-1 phase, for a `breathe` recipe. */
export const flameSeed = (profile: number, phase: number): number =>
	profile * PHASES + Math.min(PHASES - 1, Math.floor(phase * PHASES));

/** Rows the uniform array holds (an ample fixed size: its length is part of the program). */
export const MAX_RECIPES = 32;
/** Vec4s per recipe in the uniform array. */
export const RECIPE_VEC4S = 6;

const recipe = (r: Partial<VfxRecipe> & Pick<VfxRecipe, 'pool' | 'lifetime'>): VfxRecipe => ({
	count: 24,
	speed: 1,
	gravity: 0,
	drag: 0,
	spread: 0.5,
	radius: 0.1,
	size: [0.1, 0.1],
	spin: 0,
	from: [1, 1, 1, 1],
	to: [1, 1, 1, 0],
	frame: ATLAS.disc,
	frames: 1,
	lit: 0,
	still: 0.3,
	drift: 0,
	fadeIn: 0.05,
	breathe: 0,
	flat: 0,
	...r
});

/**
 * The recipes later effects start from (#312-#320 tune and add their own). The order is the
 * index the instances carry: append only.
 */
export const RECIPES = {
	/** Fine dust sifting down, lit (the toll's, #317). */
	dust: recipe({
		pool: 'soft',
		count: 120,
		lifetime: 4,
		speed: 0.05,
		gravity: 0.08,
		drag: 0.5,
		spread: 1,
		radius: 2,
		size: [0.04, 0.06],
		from: [0.85, 0.8, 0.7, 0.8],
		to: [0.85, 0.8, 0.7, 0],
		lit: 1,
		drift: 0.15,
		fadeIn: 0.1
	}),
	/** A shower of hot sparks (a hit, a strike on stone). */
	sparks: recipe({
		pool: 'additive',
		count: 32,
		lifetime: 0.6,
		speed: 3,
		gravity: 6,
		drag: 2,
		spread: 0.6,
		radius: 0.05,
		size: [0.05, 0.02],
		from: [4, 2.2, 0.8, 1],
		to: [2, 0.5, 0.1, 0],
		frame: ATLAS.spark,
		still: 0.2,
		fadeIn: 0
	}),
	/** Embers rising off a fire: a loop. */
	embers: recipe({
		pool: 'additive',
		count: 12,
		lifetime: 1.8,
		speed: 0.4,
		gravity: -0.4,
		drag: 0.8,
		spread: 0.25,
		radius: 0.12,
		size: [0.035, 0.015],
		from: [3, 1.4, 0.4, 1],
		to: [1.5, 0.3, 0.05, 0],
		drift: 0.08
	}),
	/** A rising puff of smoke, lit: a flipbook. */
	smoke: recipe({
		pool: 'soft',
		count: 10,
		lifetime: 3,
		speed: 0.3,
		gravity: -0.1,
		drag: 0.6,
		spread: 0.2,
		radius: 0.15,
		size: [0.3, 0.9],
		spin: 0.4,
		from: [0.35, 0.33, 0.32, 0.55],
		to: [0.45, 0.44, 0.43, 0],
		frame: ATLAS.puff,
		frames: PUFF_FRAMES,
		lit: 1,
		drift: 0.1,
		fadeIn: 0.15
	}),
	/** A ring flashing out from its origin (a shockwave, a ward). */
	ring: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 0.7,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.3, 3],
		from: [1.2, 1.1, 0.9, 1],
		to: [1.2, 1.1, 0.9, 0],
		frame: ATLAS.ring,
		fadeIn: 0
	}),
	/** Healing: green plus glyphs drifting up. */
	heal: recipe({
		pool: 'additive',
		count: 8,
		lifetime: 1.4,
		speed: 0.5,
		drag: 1.5,
		spread: 0.15,
		radius: 0.25,
		size: [0.14, 0.1],
		from: [0.6, 1.8, 0.7, 1],
		to: [0.3, 1.2, 0.4, 0],
		frame: ATLAS.plus,
		still: 0.4,
		fadeIn: 0.1
	}),
	/** A guard: a shield glyph rising and fading. */
	guard: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 1.2,
		speed: 0.3,
		drag: 2,
		spread: 0,
		radius: 0,
		size: [0.5, 0.6],
		from: [0.7, 1, 1.6, 0.9],
		to: [0.7, 1, 1.6, 0],
		frame: ATLAS.shield,
		still: 0.4,
		fadeIn: 0.15
	}),
	...fireRecipes(recipe, ATLAS, PUFF_FRAMES),
	// Combat (#315) and statuses (#316): appended after the particle layer's own.
	/** Debris chips knocked loose by a heavy blow, falling. */
	chips: recipe({
		pool: 'soft',
		count: 6,
		lifetime: 0.7,
		speed: 2.2,
		gravity: 9,
		drag: 0.5,
		spread: 0.55,
		radius: 0.08,
		size: [0.07, 0.05],
		from: [0.5, 0.42, 0.32, 1],
		to: [0.5, 0.42, 0.32, 0],
		lit: 1,
		still: 0.2,
		fadeIn: 0
	}),
	/** A miss: curved pale streaks whistling past. */
	whiff: recipe({
		pool: 'additive',
		count: 3,
		lifetime: 0.35,
		speed: 3.5,
		drag: 5,
		spread: 0.45,
		radius: 0.2,
		size: [0.35, 0.06],
		from: [1.4, 1.4, 1.5, 0.8],
		to: [0.8, 0.8, 0.9, 0],
		frame: ATLAS.spark,
		drift: 0.12,
		fadeIn: 0.1
	}),
	/** A small puff of dust at the feet: a fall, a miss landing, a spawn or a despawn. */
	dustpuff: recipe({
		pool: 'soft',
		count: 5,
		lifetime: 0.7,
		speed: 0.6,
		gravity: -0.1,
		drag: 3,
		spread: 0.5,
		radius: 0.15,
		size: [0.12, 0.4],
		from: [0.55, 0.5, 0.42, 0.6],
		to: [0.55, 0.5, 0.42, 0],
		frame: ATLAS.puff,
		frames: PUFF_FRAMES,
		lit: 1,
		fadeIn: 0.1
	}),
	/** A short lick of flame. */
	lick: recipe({
		pool: 'additive',
		count: 3,
		lifetime: 0.8,
		speed: 0.25,
		gravity: -1.2,
		spread: 0.15,
		radius: 0.1,
		size: [0.3, 0.06],
		from: [4, 1.6, 0.3, 0.9],
		to: [2, 0.3, 0.05, 0],
		drift: 0.06,
		fadeIn: 0.15
	}),
	/** One slice of a flying shot: placed along its arc, each a moment (vfx-play.ts). */
	bolt: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 0.14,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.16, 0.08],
		from: [2.5, 2.2, 1.6, 1],
		to: [1.5, 1.2, 0.8, 0],
		frame: ATLAS.spark,
		fadeIn: 0
	}),
	/** Dark wisps curling up (an enemy's fall; the shadow status, looped). */
	wisp: recipe({
		pool: 'soft',
		count: 5,
		lifetime: 1.3,
		speed: 0.2,
		gravity: -0.35,
		drag: 1,
		spread: 0.2,
		radius: 0.2,
		size: [0.15, 0.45],
		from: [0.08, 0.06, 0.1, 0.6],
		to: [0.04, 0.03, 0.06, 0],
		frame: ATLAS.puff,
		frames: PUFF_FRAMES,
		drift: 0.1,
		fadeIn: 0.2
	}),
	/** A shockwave: a ring spreading 1.2 cells across the ground. */
	shock: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 0.5,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.2, 2.4],
		from: [1.4, 1.2, 0.9, 0.9],
		to: [1.4, 1.2, 0.9, 0],
		frame: ATLAS.ring,
		fadeIn: 0
	}),
	/** A guard: shield glyphs around the base, fading. */
	ward: recipe({
		pool: 'additive',
		count: 5,
		lifetime: 0.8,
		speed: 0.15,
		drag: 1,
		spread: 0,
		radius: 0.42,
		size: [0.2, 0.26],
		from: [0.7, 1, 1.6, 0.9],
		to: [0.7, 1, 1.6, 0],
		frame: ATLAS.shield,
		still: 0.4,
		fadeIn: 0.15
	}),
	/** Guarded, looped on the base: slowly turning shield glyphs. */
	shimmer: recipe({
		pool: 'additive',
		count: 5,
		lifetime: 2.4,
		speed: 0.05,
		spread: 0,
		radius: 0.42,
		size: [0.18, 0.2],
		spin: 0.8,
		from: [0.7, 1, 1.6, 0.7],
		to: [0.7, 1, 1.6, 0],
		frame: ATLAS.shield,
		fadeIn: 0.3
	}),
	/** Slowed, looped on the base: pale crystal spikes. */
	frost: recipe({
		pool: 'additive',
		count: 6,
		lifetime: 2,
		speed: 0.04,
		spread: 0,
		radius: 0.4,
		size: [0.2, 0.12],
		spin: 0.3,
		from: [0.6, 1.2, 1.8, 0.9],
		to: [0.5, 1, 1.6, 0],
		frame: ATLAS.spark,
		fadeIn: 0.2
	}),
	/** A status with no look of its own: a small ring pulsing on the base. */
	ringlet: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 1.6,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.7, 0.9],
		from: [0.8, 0.8, 0.8, 0.7],
		to: [0.8, 0.8, 0.8, 0],
		frame: ATLAS.ring,
		fadeIn: 0.3
	}),
	/** More statuses than a base shows: a plus pip. */
	more: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 2,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.16, 0.16],
		from: [1.4, 1.4, 1.4, 0.9],
		to: [1.4, 1.4, 1.4, 0.4],
		frame: ATLAS.plus,
		fadeIn: 0.1
	}),
	/** The sparks status, looped: hot glints thrown off and falling. */
	glints: recipe({
		pool: 'additive',
		count: 8,
		lifetime: 0.9,
		speed: 1.2,
		gravity: 3,
		drag: 1,
		spread: 0.6,
		radius: 0.3,
		size: [0.04, 0.015],
		from: [3, 2.4, 0.9, 1],
		to: [1.5, 0.6, 0.1, 0],
		frame: ATLAS.spark,
		fadeIn: 0
	})
} satisfies Record<string, VfxRecipe>;

export type RecipeId = keyof typeof RECIPES;
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

/** Every recipe's row of `RECIPE_VEC4S` vec4s, `MAX_RECIPES` rows (the unused ones zero). */
export function packRecipes(recipes: readonly VfxRecipe[] = RECIPE_IDS.map((id) => RECIPES[id])) {
	if (recipes.length > MAX_RECIPES) throw new Error(`more than ${MAX_RECIPES} particle recipes`);
	const out = new Float32Array(MAX_RECIPES * RECIPE_VEC4S * 4);
	recipes.forEach((r, i) =>
		out.set(
			[
				...[r.lifetime, r.speed, r.gravity, r.drag],
				...[r.size[0], r.size[1], r.spin, r.spread],
				...r.from,
				...r.to,
				...[r.frame, Math.max(1, r.frames), r.lit, r.still],
				...[r.radius, r.drift, r.fadeIn, r.breathe + 2 * r.flat]
			],
			i * RECIPE_VEC4S * 4
		)
	);
	return out;
}

/**
 * How far from its origin a recipe's particles can be drawn (world units): its disc, its fastest
 * flight and fall over a life, its wobble and its largest sprite. Bounds a loop for the frustum.
 */
export function reachOf(r: VfxRecipe): number {
	const t = r.lifetime;
	return (
		r.radius + r.speed * t + 0.5 * Math.abs(r.gravity) * t * t + r.drift + 1.3 * Math.max(...r.size)
	);
}
