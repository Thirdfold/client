// How a model is staged when it comes and goes (M76 #336): a closed record of hints a model
// carries, so the finale's effects (tabletop/finale-cues.ts) key on what a thing is drawn as, never
// on a story id. Any adventure that uses the figure gets the same effects. Pure and shared: the
// pipeline reads and checks it from a model's source, the manifest's parser reads it again (it
// ships on every page, so small). Presentation only; nothing here is sent over the network.

export const APPEARS = ['emerge', 'rupture', 'shatter'] as const;
export const VANISHES = ['sink'] as const;
export const IDLES = ['sway', 'pulse'] as const;
export const ATTACKS = ['grasp'] as const;
export const GLOWS = ['light'] as const;

export interface Staging {
	/**
	 * `emerge`: rises out of the ground when it joins a fight; `rupture`: bursts open where it
	 * appears and collapses where it goes (a crack); `shatter`: a prop turning into it breaks.
	 */
	appear?: (typeof APPEARS)[number];
	/** `sink`: goes down into the ground when it leaves the fight. */
	vanish?: (typeof VANISHES)[number];
	/** `pulse`: throbs while a light that is on stands inside its footprint (drawn as a loop). */
	idle?: (typeof IDLES)[number];
	/** `grasp`: an attack from it lunges at the target with dust. */
	attack?: (typeof ATTACKS)[number];
	/** `light`: its glow takes the colour of the light inside its footprint. */
	glowFrom?: (typeof GLOWS)[number];
}

const LISTS: Record<keyof Staging, readonly string[]> = {
	appear: APPEARS,
	vanish: VANISHES,
	idle: IDLES,
	attack: ATTACKS,
	glowFrom: GLOWS
};

/** `raw` as a staging record (one or more known hints, nothing else), or null if it isn't one. */
export function readStaging(raw: unknown): Staging | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!Object.hasOwn(LISTS, key) || typeof value !== 'string') return null;
		if (!LISTS[key as keyof Staging].includes(value)) return null;
		out[key] = value;
	}
	return Object.keys(out).length ? (out as Staging) : null;
}
