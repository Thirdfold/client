// The recipes of the air (#318 motes, spores, fireflies and dust; #319 effect props' steam, magic
// aura and lightning), apart from vfx-recipes.ts to keep it under 500 lines: `RECIPES` spreads them
// in last (`airRecipes`, given the file's own `recipe` builder and atlas, as vfx-recipes-fire.ts).
// Append only, like the rest.

import type { ATLAS, PUFF_FRAMES, VfxRecipe } from './vfx-recipes';

type Maker = (r: Partial<VfxRecipe> & Pick<VfxRecipe, 'pool' | 'lifetime'>) => VfxRecipe;

export const airRecipes = (recipe: Maker, atlas: typeof ATLAS, puffFrames: typeof PUFF_FRAMES) => ({
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
		frame: atlas.spark,
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
		frame: atlas.puff,
		frames: puffFrames,
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
		frame: atlas.spark,
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
	/** One point of a lightning strike's bolt (#319): a strike lays a line of them, gone in a fifth of a second. */
	strike: recipe({
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
});
