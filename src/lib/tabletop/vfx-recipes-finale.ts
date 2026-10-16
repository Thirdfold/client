// The recipes of the finale (#336), apart from vfx-recipes.ts to keep it under 500 lines: `RECIPES`
// spreads them in (`finaleRecipes`, given the file's own `recipe` builder and atlas, as
// vfx-recipes-fire.ts). Append only, like the rest. The finale's bursts are mostly the existing
// recipes (debris, dustpuff, shock, sparks, wisp, tollRing, tollDust); these two are loops.

import type { ATLAS, VfxRecipe } from './vfx-recipes';

type Maker = (r: Partial<VfxRecipe> & Pick<VfxRecipe, 'pool' | 'lifetime'>) => VfxRecipe;

export const finaleRecipes = (recipe: Maker, atlas: typeof ATLAS) => ({
	/**
	 * A throb of light at a thing's heart: two soft discs swelling out and fading in turn, hued by
	 * the light inside it (`tinted`, from the magic aura's violet, hence this colour's hue). Held as a steady glow under
	 * reduced motion; its colours stay under 1, so it never blooms or flashes (about 0.55 Hz).
	 */
	heartPulse: recipe({
		pool: 'additive',
		count: 2,
		lifetime: 1.8,
		speed: 0,
		spread: 0,
		radius: 0.15,
		size: [0.8, 3.6],
		from: [0.51, 0.3, 1, 0.45],
		to: [0.51, 0.3, 1, 0],
		frame: atlas.disc,
		fadeIn: 0.25,
		still: 0.4,
		tinted: 1
	}),
	/** The seams of a cracked floor glowing, embers rising out of the split (a loop on each crack). */
	seam: recipe({
		pool: 'additive',
		count: 10,
		lifetime: 1.6,
		speed: 0.35,
		gravity: -0.3,
		drag: 0.5,
		spread: 0.25,
		radius: 0.45,
		size: [0.06, 0.02],
		from: [2.2, 0.9, 0.25, 1],
		to: [1.2, 0.2, 0.05, 0],
		frame: atlas.spark,
		drift: 0.1,
		fadeIn: 0.1
	})
});
