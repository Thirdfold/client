// The corner flag on a book: "new" for something published lately, "your pick" for the story this
// browser ran last. Both are per-browser conveniences; storage may be unavailable.

export type Flag = 'new' | 'pick';

const KEY = 'thirdfold:library:last-run';
const NEW_FOR_MS = 14 * 86_400_000;

export function loadLastRun(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export function saveLastRun(id: string): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// ignore
	}
}

/** "Your pick" wins over "new"; a built-in story has no publish date and is never new. */
export function flagFor(
	id: string,
	publishedAt: string | null,
	lastRun: string | null,
	now = Date.now()
): Flag | null {
	if (lastRun !== null && id === lastRun) return 'pick';
	if (publishedAt) {
		const at = Date.parse(publishedAt);
		if (!Number.isNaN(at) && now - at < NEW_FOR_MS && at <= now + 86_400_000) return 'new';
	}
	return null;
}

export const FLAG_LABEL: Record<Flag, string> = { new: 'New', pick: 'Your pick' };
