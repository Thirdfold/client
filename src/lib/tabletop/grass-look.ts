// The viewer's grass settings (Graphics menu): how dense and how tall. Pure, apart from the tiers:
// the multipliers ride on the vegetation row (`withGrassLook`) into the lazy grass chunk, which
// turns them into an instance count and a uniform. Never synced; damaged values read as Normal.

import type { VegetationRow } from './world/vegetation-tiers';

export const GRASS_DENSITIES = { sparse: 0.5, normal: 1, dense: 1.75, lush: 2.5 } as const;
export const GRASS_HEIGHTS = { short: 0.6, normal: 1, tall: 1.6, 'very-tall': 2.4 } as const;
export type GrassDensity = keyof typeof GRASS_DENSITIES;
export type GrassHeight = keyof typeof GRASS_HEIGHTS;
/** The most blades a cell grows, however the tier and the density multiply. */
export const MAX_BLADES = 100;

export interface GrassPrefs {
	grassDensity?: GrassDensity;
	grassHeight?: GrassHeight;
}

const has = (table: object, v: unknown): boolean =>
	typeof v === 'string' && Object.prototype.hasOwnProperty.call(table, v);

/** The grass settings a saved object holds: only values they may take, and only the non-default. */
export function readGrass(r: Record<string, unknown>): GrassPrefs {
	return {
		...(has(GRASS_DENSITIES, r.grassDensity) &&
			r.grassDensity !== 'normal' && { grassDensity: r.grassDensity as GrassDensity }),
		...(has(GRASS_HEIGHTS, r.grassHeight) &&
			r.grassHeight !== 'normal' && { grassHeight: r.grassHeight as GrassHeight })
	};
}

/** The tier's row with the viewer's multipliers (1 when absent or unknown). */
export function withGrassLook(row: VegetationRow, prefs: GrassPrefs): VegetationRow {
	const d = GRASS_DENSITIES[prefs.grassDensity ?? 'normal'] ?? 1;
	const h = GRASS_HEIGHTS[prefs.grassHeight ?? 'normal'] ?? 1;
	return d === 1 && h === 1 ? row : { ...row, densityScale: d, heightScale: h };
}

/** Blades per cell for a row: the tier's times the density, whole and capped. */
export const bladesFor = (row: VegetationRow): number =>
	Math.min(MAX_BLADES, Math.max(1, Math.round(row.blades * (row.densityScale ?? 1))));
