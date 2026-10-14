// Effects as data (M75 #318, #319): the drifting air an environment has, and the effects a model
// emits from sockets. Both name a particle recipe (tabletop/vfx-recipes.ts) from a closed list, so a
// manifest or a part list can only ask for what the renderer draws. Pure and shared: the pipeline
// reads and checks them, the manifest's parser reads them again (it ships on every page, so small).

/** The air an environment has (#318), each a looping recipe of the same name. */
export const MOTES = [
	'cavern-motes',
	'spores',
	'fireflies',
	'blowing-dust',
	'railcar-dust'
] as const;
export type Motes = (typeof MOTES)[number];

/** What a model socket or an effect prop may emit (#319), each a looping recipe of the same name. */
export const FX_RECIPES = ['smoke', 'steam', 'magic-aura', 'lightning', 'sparks'] as const;
export type FxRecipe = (typeof FX_RECIPES)[number];

/** Where a model emits from: a recipe, and a point in model units (a cell is 1) about the footprint's centre. */
export interface FxSocket {
	recipe: FxRecipe;
	at: [number, number, number];
}

/** The most sockets a model declares. */
export const MAX_SOCKETS = 4;

/**
 * `raw` as a list of sockets (1 to `MAX_SOCKETS`, points within 16 units), or null if it isn't one.
 * Shapes only, as the client's parser needs (it ships on every page); the pipeline also checks the
 * recipes against the closed list (`socketsKnown`) and the renderer draws only those it has.
 */
export function readSockets(raw: unknown): FxSocket[] | null {
	if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SOCKETS) return null;
	for (const s of raw) {
		const { recipe, at } = s ?? {};
		const near = (v: unknown) => typeof v === 'number' && Math.abs(v) <= 16;
		if (typeof recipe !== 'string' || !Array.isArray(at) || at.length !== 3 || !at.every(near))
			return null;
	}
	return raw.map(({ recipe, at }) => ({ recipe, at: [...at] as FxSocket['at'] }));
}

/** Whether every socket names a recipe of the closed list (the pipeline's check). */
export const socketsKnown = (sockets: readonly FxSocket[]): boolean =>
	sockets.every((s) => FX_RECIPES.some((r) => r === s.recipe));
