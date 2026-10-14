// An environment's scatter rules (M74 #305): small decoration (clover, tufts, pebbles, moss, reeds,
// rubble) laid by floor and place, as data. Pure and shared: the pipeline reads and checks the
// rules, the manifest's parser reads them again, and tabletop/world/scatter.ts places them. The
// parser stays small (it ships on every page): shapes and ranges only; the floors, assets and the
// height cap are the pipeline's to check (server/assets/pipeline-scatter.ts).

/** Where a rule puts its decor. `open`: anywhere on the cell. The rest lie along one side of it. */
export const SCATTER_WHERE = [
	'open',
	'wallFoot',
	'cliffFoot',
	'cliffTop',
	'voidRim',
	'shore',
	'besideProp'
] as const;
export type ScatterWhere = (typeof SCATTER_WHERE)[number];

/** The most rules an environment lists, and the most instances a cell may get from one (density). */
export const SCATTER_LIMITS = { rules: 16, density: 4 } as const;
/** Decor on a walkable cell stays under this tall, in cells, at its largest scale. */
export const DECOR_MAX_HEIGHT = 0.15;
/** Decor taller than this stays out of a token's footing (`TOKEN_DISK`); flatter may lie under it. */
export const DECOR_FLAT = 0.03;

export interface ScatterRule {
	/** A decor model's id. */
	decor: string;
	/** Floor ids, or `default` for the table's own surface (the `plain` floor). */
	on: string[];
	where: ScatterWhere;
	/** `besideProp`: a catalogue asset id or category the cell lies beside. */
	beside?: string;
	/** Instances per cell, 0 to 4; a fraction is a chance of one more. */
	density: number;
	/** Scale range, min then max. */
	scale: [number, number];
	/** Never on a roofed cell. */
	outdoor?: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const num = (v: unknown, lo: number, hi: number): v is number =>
	typeof v === 'number' && v >= lo && v <= hi;

/** `raw` as a list of rules, or null if any is malformed (unknown keys are dropped). */
export function readScatter(raw: unknown): ScatterRule[] | null {
	if (!Array.isArray(raw) || raw.length > SCATTER_LIMITS.rules) return null;
	const out: ScatterRule[] = [];
	for (const r of raw) {
		if (typeof r !== 'object' || r === null) return null;
		const { decor, on, where, beside, density, scale, outdoor } = r as Record<string, unknown>;
		const place = SCATTER_WHERE.find((w) => w === where);
		if (
			!(typeof decor === 'string' && ID.test(decor)) ||
			!(Array.isArray(on) && on.length > 0 && on.length < 16 && on.every((f) => ID.test(f))) ||
			!place ||
			(place === 'besideProp') !== (beside !== undefined) ||
			(beside !== undefined && !(typeof beside === 'string' && ID.test(beside))) ||
			!num(density, 0, SCATTER_LIMITS.density) ||
			!(Array.isArray(scale) && scale.length === 2 && num(scale[0], 0.25, 4)) ||
			!num(scale[1], scale[0], 4) ||
			(outdoor !== undefined && typeof outdoor !== 'boolean')
		)
			return null;
		out.push({
			decor,
			on: [...(on as string[])],
			where: place,
			...(beside ? { beside: beside as string } : {}),
			density,
			scale: [scale[0], scale[1]],
			...(outdoor ? { outdoor } : {})
		});
	}
	return out;
}
