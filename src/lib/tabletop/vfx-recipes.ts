// The particle layer's recipes (#311): what a burst or a loop looks like, as data. Every recipe is
// packed into one uniform array (`packRecipes`, `RECIPE_VEC4S` vec4s each) that the particle graph
// indexes by the instance's recipe number (materials/vfx.ts), so adding a recipe here adds a row,
// never a program. Pure: no three.js, tested in vfx-state.spec.ts. Units are world units (a cell is
// `cellSize`, 1 on every shipped table) and seconds; colours linear RGB, above 1 blooming.
//
// To add a recipe: append an entry to `RECIPES` (never reorder: the index is the instance's data)
// with an atlas cell from `ATLAS` (the `vfx-sprites` texture, server/assets/vfx-art.ts), keeping
// within `MAX_RECIPES`.

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
	/** A torch's, brazier's or floor fire's flame: teardrop cards rising and thinning (#312). */
	flame: recipe({
		pool: 'additive',
		count: 5,
		lifetime: 0.8,
		speed: 0.3,
		gravity: -0.5,
		drag: 1,
		spread: 0.05,
		radius: 0.04,
		size: [0.34, 0.08],
		from: [5, 3.4, 1.2, 0.9],
		to: [2.4, 0.7, 0.12, 0],
		frame: ATLAS.flame,
		still: 0.4,
		drift: 0.03,
		fadeIn: 0.12,
		breathe: 1
	}),
	/** A candle's, lantern's or carried torch's flame: the same, smaller. */
	flameSmall: recipe({
		pool: 'additive',
		count: 3,
		lifetime: 0.7,
		speed: 0.15,
		gravity: -0.3,
		drag: 1,
		spread: 0.05,
		radius: 0.015,
		size: [0.15, 0.04],
		from: [5, 3.4, 1.2, 0.9],
		to: [2.4, 0.7, 0.12, 0],
		frame: ATLAS.flame,
		still: 0.4,
		drift: 0.012,
		fadeIn: 0.12,
		breathe: 1
	}),
	/** Embers on the low tier (#312). */
	embersLow: recipe({
		pool: 'additive',
		count: 8,
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
	/** Embers on high and ultra. */
	embersHigh: recipe({
		pool: 'additive',
		count: 30,
		lifetime: 2.2,
		speed: 0.5,
		gravity: -0.5,
		drag: 0.8,
		spread: 0.3,
		radius: 0.15,
		size: [0.035, 0.012],
		from: [3, 1.4, 0.4, 1],
		to: [1.5, 0.3, 0.05, 0],
		drift: 0.1
	}),
	/** A few soft puffs over a brazier or floor fire (medium and up). */
	fireSmoke: recipe({
		pool: 'soft',
		count: 5,
		lifetime: 3.2,
		speed: 0.25,
		gravity: -0.15,
		drag: 0.6,
		spread: 0.15,
		radius: 0.1,
		size: [0.25, 0.8],
		spin: 0.3,
		from: [0.3, 0.28, 0.27, 0.4],
		to: [0.4, 0.39, 0.38, 0],
		frame: ATLAS.puff,
		frames: PUFF_FRAMES,
		lit: 1,
		drift: 0.1,
		fadeIn: 0.2
	}),
	/** Dust sifting from the bell when it tolls, lit, falling 1 to 3 units by 6.5 s (#317). */
	tollDust: recipe({
		pool: 'soft',
		count: 96,
		lifetime: 6.5,
		speed: 0.06,
		gravity: 0.1,
		drag: 0.4,
		spread: 1,
		radius: 1.2,
		size: [0.05, 0.07],
		from: [0.85, 0.8, 0.7, 0.8],
		to: [0.85, 0.8, 0.7, 0],
		lit: 1,
		drift: 0.2,
		fadeIn: 0.08
	}),
	/** The same from a wall top: a few specks each, one burst a point. */
	wallDust: recipe({
		pool: 'soft',
		count: 3,
		lifetime: 6.5,
		speed: 0.04,
		gravity: 0.08,
		drag: 0.4,
		spread: 1,
		radius: 0.35,
		size: [0.05, 0.07],
		from: [0.85, 0.8, 0.7, 0.75],
		to: [0.85, 0.8, 0.7, 0],
		lit: 1,
		drift: 0.15,
		fadeIn: 0.08
	}),
	/** A shockwave ring on the floor round a bell, out to about 6 cells in 1.2 s. */
	tollRing: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 1.2,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [0.8, 12],
		from: [1.6, 1.4, 1.1, 0.9],
		to: [1.2, 1, 0.8, 0],
		frame: ATLAS.ring,
		fadeIn: 0.03,
		flat: 1
	}),
	/** Chips and grit thrown off a smashed or struck thing; reused by the waking's cracks (#336). */
	debris: recipe({
		pool: 'soft',
		count: 24,
		lifetime: 1.3,
		speed: 1.6,
		gravity: 5,
		drag: 1,
		spread: 0.55,
		radius: 0.15,
		size: [0.07, 0.05],
		spin: 3,
		from: [0.5, 0.45, 0.4, 1],
		to: [0.4, 0.36, 0.32, 0],
		lit: 1,
		still: 0.25,
		fadeIn: 0.02
	}),
	/** A flash's front sweeping over the floor from its source (#317). */
	flashWave: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 1.4,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [2, 56],
		from: [1.6, 1.8, 2.4, 0.7],
		to: [1.2, 1.4, 2, 0],
		frame: ATLAS.ring,
		fadeIn: 0.04,
		flat: 1
	}),
	/** Under Reduce flashing: slower and fainter, nothing near a flash. */
	flashWaveSoft: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 4,
		speed: 0,
		spread: 0,
		radius: 0,
		size: [2, 56],
		from: [0.6, 0.7, 1, 0.3],
		to: [0.6, 0.7, 1, 0],
		frame: ATLAS.ring,
		fadeIn: 0.3,
		flat: 1
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
