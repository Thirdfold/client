// The shore field's scale (#292), apart from shore.ts so the renderer can size the field's texture
// without pulling the builders (a lazy chunk, build.ts) into its own.

/** Texels a cell is cut into, each way. */
export const SHORE_TEXELS = 4;
/** The distance, in cells, where the field tops out (255). */
export const SHORE_MAX = 4;
