// Checks the environments' scatter rules (M74 #305) and decal rules (#307) against what only the
// build knows: the floors, the decor models and their sizes, the catalogue. The manifest's parser (manifest-parse.ts) checks
// their shape again on the client; this is what keeps a rule from drawing anything tall on ground
// a mini walks (docs/ASSETS.md, "Scatter rules").

import { FLOOR_IDS } from '../../src/lib/game/floor';
import { DECOR_MAX_HEIGHT } from '../../src/lib/assets/scatter';
import { DECAL_TEXTURES } from '../../src/lib/assets/decals';
import type { EnvironmentDef, ModelEntry, TextureEntry } from '../../src/lib/assets/manifest';
import type { Asset } from '../../src/lib/game/props';
import { AssetError } from './pipeline-files';

/** Floors that never get decor: no ground (`void`, `lava`), no footing (`water`); `default` is `plain`. */
const NONE = new Set(['plain', 'void', 'lava', 'water']);

export function checkScatter(
	environments: Record<string, EnvironmentDef>,
	models: Record<string, ModelEntry>,
	props: Record<string, Pick<Asset, 'category'>>
): void {
	const categories = new Set(Object.values(props).map((p) => p.category));
	for (const [id, env] of Object.entries(environments)) {
		env.scatter?.forEach((rule, k) => {
			const where = `environment ${id}, scatter rule ${k + 1} (${rule.decor})`;
			const fail = (why: string) => {
				throw new AssetError(where, why);
			};
			const decor = models[rule.decor];
			if (decor?.kind !== 'decor') fail('"decor" must name a model in models/decor');
			for (const floor of rule.on)
				if (floor !== 'default' && (!FLOOR_IDS.some((f) => f === floor) || NONE.has(floor)))
					fail(`"on" has "${floor}", which is neither "default" nor a floor that takes decor`);
			if (rule.beside !== undefined && !props[rule.beside] && !categories.has(rule.beside as never))
				fail(`"beside" must name a catalogue prop or category, not "${rule.beside}"`);
			// Everything lies on ground a mini may walk: the cap holds at the largest scale.
			const tall = decor!.bounds.max[1] * rule.scale[1];
			if (tall > DECOR_MAX_HEIGHT + 1e-9)
				fail(`${tall.toFixed(3)} cells tall at its largest scale, over ${DECOR_MAX_HEIGHT}`);
		});
	}
}

/**
 * Checks the environments' decal rules (#307): floors that exist (not void, lava or water, where
 * no decal lies), catalogue props or categories to lie beside, and the atlas they draw from.
 */
export function checkDecals(
	environments: Record<string, EnvironmentDef>,
	textures: Record<string, TextureEntry>,
	props: Record<string, Pick<Asset, 'category'>>
): void {
	const categories = new Set(Object.values(props).map((p) => p.category));
	for (const [id, env] of Object.entries(environments)) {
		env.decals?.forEach((rule, k) => {
			const fail = (why: string) => {
				throw new AssetError(`environment ${id}, decal rule ${k + 1} (${rule.decal})`, why);
			};
			for (const t of DECAL_TEXTURES) if (!textures[t]) fail(`the decal atlas's "${t}" is missing`);
			for (const floor of rule.on)
				if (floor !== 'default' && (!FLOOR_IDS.some((f) => f === floor) || NONE.has(floor)))
					fail(`"on" has "${floor}", which is neither "default" nor a floor that takes decals`);
			for (const b of rule.beside ?? [])
				if (!props[b] && !categories.has(b as never))
					fail(`"beside" must name catalogue props or categories, not "${b}"`);
		});
	}
}
