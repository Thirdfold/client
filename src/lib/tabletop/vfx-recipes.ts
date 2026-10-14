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
export const ATLAS = { disc: 0, spark: 1, puff: 2, ring: 6, shield: 7, plus: 8 } as const;
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
	/** How much the environment's wind carries it, 0 to 1 (`WIND_REACH` world units a second at full strength). */
	wind: number;
	/** 1 takes its hue from the effect's tint (its seed's hue index, `HUES`; a prop's `tint`, #319). */
	tinted: number;
}

/** World units a second the wind carries a particle with `wind` 1, at full strength (#318). */
export const WIND_REACH = 2.5;
/** A tinted effect's hue steps round the colour wheel, the index riding in its seed above `HUE_SEEDS`. */
export const HUES = 16;
/** Seeds below this are the effect's own; its hue index is the seed divided by it (seeds are below 4096). */
export const HUE_SEEDS = 256;

/** Most particles in one burst or loop; the shader's random streams are spaced by it. */
export const MAX_COUNT = 256;
/** Rows the uniform array holds (an ample fixed size: its length is part of the program). */
export const MAX_RECIPES = 48;
/** Vec4s per recipe in the uniform array. */
export const RECIPE_VEC4S = 7;

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
	wind: 0,
	tinted: 0,
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
	/** Motes glinting in lamplight (#318): lit, so they show only where a light reaches. */
	'cavern-motes': recipe({
		pool: 'additive',
		count: 40,
		lifetime: 12,
		speed: 0.12,
		spread: 0.5,
		radius: 4.2,
		size: [0.04, 0.025],
		from: [1, 0.85, 0.55, 0.7],
		to: [1, 0.85, 0.55, 0],
		frame: ATLAS.spark,
		lit: 1,
		drift: 0.25,
		fadeIn: 0.2
	}),
	/** Spores glowing faintly, rising (#318). */
	spores: recipe({
		pool: 'additive',
		count: 40,
		lifetime: 14,
		speed: 0.06,
		gravity: -0.02,
		spread: 0.3,
		radius: 4.2,
		size: [0.07, 0.04],
		from: [0.3, 1.1, 0.75, 0.5],
		to: [0.2, 0.8, 0.9, 0],
		drift: 0.3,
		fadeIn: 0.25
	}),
	/** Fireflies over grass at dusk (#318): three to a loop, each fading in and out in turn, so they blink. */
	fireflies: recipe({
		pool: 'additive',
		count: 3,
		lifetime: 3.2,
		speed: 0.05,
		spread: 1,
		radius: 0.5,
		size: [0.08, 0.07],
		from: [2.2, 2.4, 0.5, 1],
		to: [1.6, 2, 0.3, 0],
		drift: 0.35,
		fadeIn: 0.35
	}),
	/** Dust blowing downwind (#318), lit. */
	'blowing-dust': recipe({
		pool: 'soft',
		count: 40,
		lifetime: 6,
		speed: 0.2,
		spread: 0.5,
		radius: 4.2,
		size: [0.06, 0.14],
		from: [0.8, 0.7, 0.55, 0.35],
		to: [0.8, 0.7, 0.55, 0],
		lit: 1,
		drift: 0.2,
		fadeIn: 0.2,
		wind: 1
	}),
	/** Dust hanging in lamplight (#318): lit. */
	'railcar-dust': recipe({
		pool: 'additive',
		count: 30,
		lifetime: 10,
		speed: 0.03,
		spread: 1,
		radius: 4.2,
		size: [0.03, 0.025],
		from: [1, 0.9, 0.7, 0.5],
		to: [1, 0.9, 0.7, 0],
		lit: 1,
		drift: 0.1,
		fadeIn: 0.25
	}),
	/** Steam rising off a vent (#319): a flipbook puff, lit. */
	steam: recipe({
		pool: 'soft',
		count: 10,
		lifetime: 2.2,
		speed: 0.6,
		gravity: -0.5,
		drag: 0.5,
		spread: 0.15,
		radius: 0.1,
		size: [0.2, 0.8],
		spin: 0.3,
		from: [0.9, 0.92, 0.95, 0.45],
		to: [0.95, 0.97, 1, 0],
		frame: ATLAS.puff,
		frames: PUFF_FRAMES,
		lit: 1,
		drift: 0.12,
		fadeIn: 0.1
	}),
	/** A magic aura (#319): motes of light rising round the origin, hued by the prop's tint. */
	'magic-aura': recipe({
		pool: 'additive',
		count: 24,
		lifetime: 2.6,
		speed: 0.35,
		gravity: -0.2,
		spread: 0.3,
		radius: 0.45,
		size: [0.07, 0.03],
		from: [1.2, 0.6, 2.2, 0.9],
		to: [0.7, 0.3, 1.6, 0],
		frame: ATLAS.spark,
		drift: 0.15,
		tinted: 1
	}),
	/** The steady glow of a lightning prop (#319), all there is under Reduce flashing. */
	'lightning-glow': recipe({
		pool: 'additive',
		count: 2,
		lifetime: 3,
		speed: 0,
		radius: 0.3,
		size: [1.6, 2.2],
		from: [0.25, 0.3, 0.6, 0.25],
		to: [0.2, 0.25, 0.5, 0],
		fadeIn: 0.4
	}),
	/** One point of a lightning bolt (#319): a strike lays a line of them, gone in a fifth of a second. */
	bolt: recipe({
		pool: 'additive',
		count: 1,
		lifetime: 0.2,
		speed: 0,
		radius: 0,
		size: [0.3, 0.15],
		from: [3, 3.4, 5, 1],
		to: [1.5, 1.8, 3, 0],
		fadeIn: 0,
		still: 0
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
				...[r.radius, r.drift, r.fadeIn, 0],
				...[r.wind, r.tinted, 0, 0]
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
		r.radius +
		r.speed * t +
		0.5 * Math.abs(r.gravity) * t * t +
		r.drift +
		r.wind * WIND_REACH * t +
		1.3 * Math.max(...r.size)
	);
}
