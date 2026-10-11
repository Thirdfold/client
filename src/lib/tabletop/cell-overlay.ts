// The cell overlay's channels and looks (#285), pure: one RGBA8 texel per cell, drawn on the ground
// by the grid's overlay material (materials/grid.ts, which mirrors these constants). Each channel
// has a colour from Okabe and Ito's colour-vision-safe palette and a pattern twin, so none depends
// on colour alone: reach is a solid contour, range a dashed one, the path a dotted line, areas
// diagonal hatching. Only explored cells carry anything (ui/reach.ts), so nothing can show over
// ground the viewer has not seen.

/** The channels, in texel order (R, G, B, A). */
export const CHANNELS = ['reach', 'range', 'path', 'area'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Okabe-Ito: blue and orange for reach and range, sky blue for the path, bluish green for areas. */
export const CHANNEL_COLOUR: Record<Channel, number> = {
	reach: 0x0072b2,
	range: 0xe69f00,
	path: 0x56b4e9,
	area: 0x009e73
};
/** The fill's opacity inside each channel's contour, and the contour's. */
export const FILL_OPACITY: Record<Channel, number> = {
	reach: 0.16,
	range: 0.1,
	path: 0.3,
	area: 0.3
};
export const CONTOUR_OPACITY = 0.9;
/** The contour's half width in the channel's 0-1 value (it lies where the value crosses 0.5). */
export const CONTOUR_WIDTH = 0.12;
/** Dashes per cell along a range contour (a dash and a gap), and the path's dots. */
export const DASHES_PER_CELL = 2;
/** Diagonal hatch stripes per cell for areas. */
export const AREA_STRIPES = 4;
/** Reach and range must look at least this far apart (OKLab) under each dichromacy. */
export const CHANNEL_DISTANCE = 0.1;

export interface OverlayCells {
	width: number;
	height: number;
	/** width × height × 4 bytes (reach, range, path, area), 0 or 255, in row order. */
	data: Uint8Array;
}
