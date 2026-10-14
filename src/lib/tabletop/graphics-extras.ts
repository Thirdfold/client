// The Graphics menu's switches that are not a tier's (quality.ts `GraphicsPrefs` extends these):
// absent from older saves, so each is optional and read only when it holds a value it may take.

import { readGrass, type GrassPrefs } from './grass-look';
import { readWalls, type WallsSetting } from './cutaway';

export interface GraphicsExtras extends GrassPrefs {
	/** 'Always show names' (#268): every name, not only on demand. */
	names?: boolean;
	/** The walls near the camera (#282, cutaway.ts): the cutaway when absent. */
	walls?: WallsSetting;
}

/** The extras a saved settings object holds. */
export const readExtras = (r: Record<string, unknown>): GraphicsExtras => ({
	...(r.names === true && { names: true }),
	...readWalls(r.walls),
	...readGrass(r)
});
