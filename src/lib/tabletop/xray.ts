// Each mini's flags (#281, #284): hidden whole by the cut plane, and whether it may show an x-ray
// silhouette. Pure (no three.js): the token layer works them out, the figures' `aMini` and the
// bases' ring flags carry them (figures.ts, base-layer.ts), and the mini, base and silhouette
// shaders read them (hooks.ts, base.ts, xray-layer.ts). docs/RENDERING.md, "X-ray (#284)".

/** The bits: cut away (drawn nowhere), and no silhouette (fallen, GM-hidden, cut away). */
export const MINI_FLAG = { cut: 1, noXray: 2 } as const;

/** A figure instance's flags, its ring's palette index and 1 for an enemy's (figures.ts). */
export const MINI_ATTRIBUTE = 'aMini';

/** The silhouette's look: how much of it shows, enemies' stripes across the world (per cell). */
export const XRAY = { opacity: 0.45, stripes: 3, gap: 0.35 } as const;

export interface MiniState {
	/** Its floor's level, and the cut's (null: none). */
	level: number;
	cutLevel: number | null;
	/** The viewer's own or selected: never cut (`Tabletop.setCut`'s kept tokens). */
	kept: boolean;
	fallen: boolean;
	/** Hidden from the players: the GM sees it see-through already. */
	hidden: boolean;
}

/**
 * A mini's flags: cut away when its floor is at or above the cut and it isn't kept (#281: whole,
 * never clipped open); no silhouette when it is cut away, fallen or GM-hidden (#284).
 */
export function miniFlags(s: MiniState): number {
	const cut = !s.kept && s.cutLevel !== null && s.level >= s.cutLevel;
	return (cut ? MINI_FLAG.cut : 0) + (cut || s.fallen || s.hidden ? MINI_FLAG.noXray : 0);
}

/** Whether `flags` has `bit` (as the shaders read it: `floor(flags / bit) mod 2`). */
export const hasFlag = (flags: number, bit: number): boolean => Math.floor(flags / bit) % 2 === 1;
