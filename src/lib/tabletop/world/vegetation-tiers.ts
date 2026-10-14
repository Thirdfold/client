// The vegetation rows by tier (#308): one source for the grass's blades and segments, the decor's
// density and the decals' caps. Pure; `quality.ts` carries each row as `QualitySettings.vegetation`.
// Blades, clumps and decor are opaque on every tier (no discard, so early-Z holds on tile GPUs).
// Starting values, not yet measured on the iGPU (docs/PERFORMANCE.md "Vegetation rows").

export interface VegetationRow {
	/** Grass blades per cell (x0.25, x0.6, x1, x1 of 40). */
	blades: number;
	/** A blade strip's segments (2S + 1 vertices): geometry only, the graph never reads it. */
	segments: number;
	/** Scatter (decor) density, 0-1: multiplies each rule's thinning. */
	scatter: number;
	/** The most rule decals drawn. */
	decalCap: number;
	/** The viewer's grass settings (grass-look.ts): multipliers of blades and blade height. */
	densityScale?: number;
	heightScale?: number;
}

export const VEGETATION = {
	low: { blades: 10, segments: 3, scatter: 0.35, decalCap: 256 },
	medium: { blades: 24, segments: 4, scatter: 0.7, decalCap: 1024 },
	high: { blades: 40, segments: 5, scatter: 1, decalCap: 2048 },
	ultra: { blades: 40, segments: 5, scatter: 1, decalCap: 2048 }
} as const satisfies Record<string, VegetationRow>;
