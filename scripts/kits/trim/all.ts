// Every kit's trim (scripts/make-kit-trim.ts): the pieces it generates, and the models of other
// sources (CC0 door leaves, fetched by scripts/fetch-models.ts) it stands in the rest.

import type { KitPiece, KitRole } from '../../../src/lib/assets/kit';
import type { Piece } from './piece';
import { cavernTrim } from './cavern';
import { caveTrim } from './cave';
import { hallsTrim } from './halls';
import { villageTrim } from './village';

export interface Trim {
	/** The kit file it patches, assets/kits/<kit>.json. */
	kit: string;
	pieces: Piece[];
	/** Roles filled by models that are not made here. */
	external?: Partial<Record<KitRole, KitPiece[]>>;
}

export const trims = (): Trim[] => [villageTrim(), hallsTrim(), cavernTrim(), caveTrim()];
