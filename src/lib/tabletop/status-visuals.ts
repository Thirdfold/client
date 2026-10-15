// What each token's base shows of its statuses (#316), from the adventure view alone: the
// characters whose token this viewer was sent (`tokenId` non-null) and the enemies in the fight
// they can see. Pure (no three.js), tested in Node. Nothing here reads a status's name; the look
// is the `vfx` preset the server copied from its definition, so a status a creator or the rules
// track adds shows with no client change. A status without a preset gets a neutral ring, and a
// base shows at most `MAX_LOOKS` looks, a plus pip for the rest.

import type { ActiveStatus, AdventureView } from '../adventure/adventure';
import type { StatusVfx } from '../adventure/characters';

/** A preset, the neutral ring (no preset), or the pip that says there are more. */
export type StatusLook = StatusVfx | 'neutral' | 'more';

const PRESETS: Record<StatusVfx, true> = {
	embers: true,
	shimmer: true,
	frost: true,
	shadow: true,
	sparks: true
};
const isStatusVfx = (value: unknown): value is StatusVfx =>
	typeof value === 'string' && Object.hasOwn(PRESETS, value);

/** The most looks one base shows before the pip. */
export const MAX_LOOKS = 3;

export function looksOf(statuses: readonly ActiveStatus[]): StatusLook[] {
	const kinds = new Set<StatusLook>(statuses.map((s) => (isStatusVfx(s.vfx) ? s.vfx : 'neutral')));
	const looks = [...kinds];
	return looks.length > MAX_LOOKS ? [...looks.slice(0, MAX_LOOKS), 'more'] : looks;
}

/** Token id to the looks of its statuses; tokens with none are left out. */
export function statusVisuals(adventure: AdventureView | null): Map<string, StatusLook[]> {
	const out = new Map<string, StatusLook[]>();
	const add = (tokenId: string | null, statuses: readonly ActiveStatus[]) => {
		if (tokenId && statuses.length) out.set(tokenId, looksOf(statuses));
	};
	for (const c of adventure?.characters ?? []) add(c.tokenId, c.statuses);
	for (const e of adventure?.encounter?.enemies ?? []) add(e.tokenId, e.statuses);
	return out;
}
