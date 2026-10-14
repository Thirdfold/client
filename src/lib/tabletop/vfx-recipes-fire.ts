// The recipes of fire (#312) and the bell's toll and flash (#317), apart from vfx-recipes.ts to keep
// it under 500 lines: `RECIPES` spreads them in (`fireRecipes`, given the file's own `recipe`
// builder and atlas so neither imports the other at run time). Append only, like the rest.

import type { ATLAS, PUFF_FRAMES, VfxRecipe } from './vfx-recipes';

type Maker = (r: Partial<VfxRecipe> & Pick<VfxRecipe, 'pool' | 'lifetime'>) => VfxRecipe;

export const fireRecipes = (
	recipe: Maker,
	atlas: typeof ATLAS,
	puffFrames: typeof PUFF_FRAMES
) => ({
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
		frame: atlas.flame,
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
		frame: atlas.flame,
		still: 0.4,
		drift: 0.012,
		fadeIn: 0.12,
		breathe: 1
	}),
	/** Embers on the low tier (#312): 8 once low halves them. */
	embersLow: recipe({
		pool: 'additive',
		count: 16,
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
		frame: atlas.puff,
		frames: puffFrames,
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
		frame: atlas.ring,
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
		frame: atlas.ring,
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
		frame: atlas.ring,
		fadeIn: 0.3,
		flat: 1
	})
});
