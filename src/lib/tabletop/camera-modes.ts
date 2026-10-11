// The camera's modes as data (#289): overview, explore, eye level and follow. Each says which
// framing curve it uses (camera-rig.ts: pitch, field of view), how far in and out the viewer may
// go, what grid and labels it shows, whether the spring arm (#290) holds it off terrain and
// walls, and whether it tracks a mini. Pure (no three.js), tested in Node. The stored
// `thirdfold:view` migrates through `parseView`.

import type { GridPos } from '../game/grid';
import type { CameraMode } from './camera-rig';

export type CameraView = 'overview' | 'explore' | 'eye' | 'follow';
export const CAMERA_VIEWS: readonly CameraView[] = ['overview', 'explore', 'eye', 'follow'];

export interface ModeSpec {
	/** The framing curve (pitch by distance, field of view). */
	curve: CameraMode;
	/** How close and how far (cells) the viewer may go; null for the table's own reach. */
	distance: { min: number; max: number | null };
	/** The grid shown: faint over the whole place, round the hover and selection, or none. */
	grid: 'overview' | 'explore' | 'off';
	/** Whose names show besides the hovered: the viewer's own and the turn's, the turn's, or none. */
	labels: 'own' | 'turn' | 'hover';
	/** The spring arm holds the camera off terrain and walls. */
	arm: boolean;
	/** The pivot follows a mini (the selected one, or the turn's with Follow turns). */
	tracks: boolean;
}

const WHOLE = { min: 3, max: null };

export const CAMERA_MODES: Record<CameraView, ModeSpec> = {
	overview: {
		curve: 'overview',
		distance: WHOLE,
		grid: 'overview',
		labels: 'own',
		arm: false,
		tracks: false
	},
	explore: {
		curve: 'explore',
		distance: WHOLE,
		grid: 'explore',
		labels: 'turn',
		arm: false,
		tracks: false
	},
	eye: {
		curve: 'eye',
		distance: { min: 1.5, max: 12 },
		grid: 'off',
		labels: 'hover',
		arm: true,
		tracks: true
	},
	follow: {
		curve: 'explore',
		distance: WHOLE,
		grid: 'explore',
		labels: 'turn',
		arm: true,
		tracks: true
	}
};

/**
 * The view a stored value means. A new value is kept; 'tabletop' (before #280) is explore;
 * anything else, 'tactical' included, a missing value or garbage, is overview.
 */
export function parseView(stored: unknown): CameraView {
	if (stored === 'tabletop') return 'explore';
	return CAMERA_VIEWS.find((v) => v === stored) ?? 'overview';
}

/** A mini the camera can stand at or follow: where it is. */
export interface Subject {
	id: string;
	pos: GridPos;
}

/** The curve in use: eye level with nobody to stand at is explore's. */
export function effectiveCurve(view: CameraView, subject: Subject | null): CameraMode {
	return view === 'eye' && !subject ? 'explore' : CAMERA_MODES[view].curve;
}

/** What the camera follows or stands at, from what the viewer sees and has chosen (local UI). */
export interface SubjectChoice {
	selectedId: string | null;
	/** The token whose turn it is in a fight. */
	activeId: string | null;
	followTurns: boolean;
	/** Ids of the tokens the viewer was sent. */
	visible: ReadonlySet<string>;
	own: readonly string[];
}

/**
 * The mini the eye-level and follow views attach to, only ever one the viewer was sent. Eye
 * level: the selected one, else the viewer's own. Follow: the turn's with Follow turns, else the
 * selected one. Null otherwise (the rig then does not track).
 */
export function cameraSubject(view: CameraView, c: SubjectChoice): string | null {
	const seen = (id: string | null) => (id && c.visible.has(id) ? id : null);
	if (view === 'follow') return (c.followTurns && seen(c.activeId)) || seen(c.selectedId);
	if (view === 'eye') return seen(c.selectedId) ?? c.own.find((id) => c.visible.has(id)) ?? null;
	return null;
}
