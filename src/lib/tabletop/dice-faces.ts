// The face labels of each die model and the seeded randomness of a throw:
// what the 3D dice need and the room page does not. Kept apart from
// dice-throw.ts, which the room page imports eagerly, so the two never share
// a runtime module and three.js stays out of the page's static imports.

import type { DieKind } from './dice-throw';

/** Faces per model and the label on each face, in face order. */
export const DIE_LABELS: Record<DieKind, readonly string[]> = {
	d4: ['1', '2', '3', '4'],
	d6: ['1', '2', '3', '4', '5', '6'],
	d8: ['1', '2', '3', '4', '5', '6', '7', '8'],
	d10: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
	d12: Array.from({ length: 12 }, (_, i) => String(i + 1)),
	d20: Array.from({ length: 20 }, (_, i) => String(i + 1)),
	d100tens: ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'],
	d100units: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
};

// Moved to world/hash.ts (shared with the world's seeded layers); callers import it from here still.
export { seededRandom } from './world/hash';
