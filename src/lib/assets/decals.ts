// An environment's decal rules (M74 #307): grime, moss, damp, soot, scorch, cracks, leaf litter
// and blood laid on floors and wall faces by place, as data. Pure and shared: the pipeline reads
// and checks the rules, the manifest's parser reads them again, and tabletop/world/decal-rules.ts
// places them. The parser stays small (it ships on every page): shapes and ranges only; the floors
// and the catalogue are the pipeline's to check (server/assets/pipeline-scatter.ts).

/** The atlas's decals, in its order: each has `DECAL_VARIANTS` cells, row-major from the bottom. */
export const DECAL_KEYS = [
	'grime',
	'moss',
	'damp',
	'soot',
	'scorch',
	'cracks',
	'leaves',
	'blood'
] as const;
export type DecalKey = (typeof DECAL_KEYS)[number];
/** Cells per decal in the atlas, and cells across it (a 4x4 grid). */
export const DECAL_VARIANTS = 2;
export const DECAL_ACROSS = 4;
/** The atlas's maps, recipes in the manifest: albedo and alpha, normal, mask (R rough, G cavity). */
export const DECAL_TEXTURES = ['decal-albedo', 'decal-normal', 'decal-mask'] as const;

/** `open`: on the floor. `wallFoot`: at the foot of a wall or window. `wall`: up a wall's face. */
export const DECAL_WHERE = ['open', 'wallFoot', 'wall'] as const;
export type DecalWhere = (typeof DECAL_WHERE)[number];

/** The most rules an environment lists. */
export const DECAL_LIMITS = { rules: 16 } as const;

export interface DecalRule {
	decal: DecalKey;
	where: DecalWhere;
	/** Floor ids of the cell it lies on (or in front of), or `default` for the table's own surface. */
	on: string[];
	/** Catalogue asset ids or categories: only on cells in or beside one of the viewer's props. */
	beside?: string[];
	/** The chance of one per cell (`open`) or per wall side, 0 to 1. */
	chance: number;
	/** Size range in cells, min then max (0.2 to 1). */
	size: [number, number];
	/** Never on a roofed cell. */
	outdoor?: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const num = (v: unknown, lo: number, hi: number): v is number =>
	typeof v === 'number' && v >= lo && v <= hi;
const ids = (v: unknown): v is string[] =>
	Array.isArray(v) && v.length > 0 && v.length < 16 && v.every((f) => ID.test(f));

/** `raw` as a list of rules, or null if any is malformed (unknown keys are dropped). */
export function readDecals(raw: unknown): DecalRule[] | null {
	if (!Array.isArray(raw) || raw.length > DECAL_LIMITS.rules) return null;
	const out: DecalRule[] = [];
	for (const r of raw) {
		if (typeof r !== 'object' || r === null) return null;
		const { decal, where, on, beside, chance, size, outdoor } = r as Record<string, unknown>;
		const key = DECAL_KEYS.find((k) => k === decal);
		const place = DECAL_WHERE.find((w) => w === where);
		if (
			!key ||
			!place ||
			!ids(on) ||
			(beside !== undefined && !ids(beside)) ||
			!num(chance, 0, 1) ||
			!(Array.isArray(size) && size.length === 2 && num(size[0], 0.2, 1)) ||
			!num(size[1], size[0], 1) ||
			(outdoor !== undefined && typeof outdoor !== 'boolean')
		)
			return null;
		out.push({
			decal: key,
			where: place,
			on: [...on],
			...(beside ? { beside: [...(beside as string[])] } : {}),
			chance,
			size: [size[0], size[1]],
			...(outdoor ? { outdoor } : {})
		});
	}
	return out;
}
