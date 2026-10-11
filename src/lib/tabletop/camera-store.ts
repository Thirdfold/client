// The camera pose kept per room in localStorage (`thirdfold:camera:<roomId>`, #279), read and
// written so that unavailable storage or a damaged entry just means a fresh framing.

import type { SquareGrid } from '../game/grid';
import { parseSavedCamera, type SavedCamera } from './camera-rig';

export function loadCamera(key: string | null, grid: SquareGrid): SavedCamera | null {
	if (!key) return null;
	try {
		const raw = localStorage.getItem(key);
		return raw ? parseSavedCamera(JSON.parse(raw), grid) : null;
	} catch {
		return null; // storage unavailable or a damaged entry: framed afresh
	}
}

export function saveCamera(key: string, saved: SavedCamera): void {
	try {
		localStorage.setItem(key, JSON.stringify(saved));
	} catch {
		// Storage unavailable: the pose just isn't remembered.
	}
}
