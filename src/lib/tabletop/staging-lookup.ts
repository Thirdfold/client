// The hints models carry (assets/staging.ts) as the room page's tracker reads them: from the
// manifest, fetched once when a page first asks (the asset loader is fetched apart, so the room
// page's own code stays small). Until it has arrived every model reads as unstaged, which plays
// nothing; Node (the tests) never fetches and passes its own lookup.

import type { Staging } from '../assets/staging';

let models: Record<string, { staging?: Staging }> | null = null;
let asked = false;

/** A model's hints, if the manifest has arrived and the model has any. */
export function manifestStaging(model: string | undefined): Staging | undefined {
	if (!asked && typeof window !== 'undefined') {
		asked = true;
		void import('../assets/load')
			.then((m) => m.loadManifest())
			.then((manifest) => (models = manifest.models));
	}
	return model ? models?.[model]?.staging : undefined;
}
