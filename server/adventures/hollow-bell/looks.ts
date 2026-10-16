// The Hollow Bell's world looks (M76, #338): how each place, chapter and ending is graded, as plain
// data. The hour, haze (density and colour) and exposure are presentation; the one rule here is the
// ambient band, which the hour sets under a sun, so every look below keeps its table's band (a spec
// walks the story and asserts it): the village and the monastery stay in dusk (19:00-20:59, so
// "nightfall" is the late end of it, never night), the Hollow and the Heart stay dark (no sun).
//
// The picture each aims at (docs/LOOK.md): the village in a warm low dusk that cools toward a
// blue fill with warm lamps once the Hound has been faced; the monastery by a cool moon against
// candle and torch warmth; the Hollow a navy floor, the Bell's light in the blue-violet, going
// wine and then red as it wakes; each ending its own final light. Haze colour is the one knob that
// reaches the horizon, the void and the fog at once; exposure steps between two looks are at most
// MAX_STEP_EV, so no change reads as a flash (docs/RENDERING.md "Reduce flashing").

import type { SceneFile } from '../../../src/lib/game/scene-file';
import { applyWorldPatch, type WorldPatch } from '../../../src/lib/game/world';
import type { Effect } from '../../adventure/define';
import type { ChapterId, LocationId } from './story';

/** The most a look may move the exposure from the one before it, EV. */
export const MAX_STEP_EV = 0.5;

const look = (
	time: number | null,
	density: number,
	color: string,
	exposure: number
): WorldPatch => ({
	...(time === null ? {} : { time }),
	haze: { density, color },
	grade: { exposure }
});

/** Each table's look, over the one its builder gives (the hour and preset stay the builder's unless set). */
export const PLACE_LOOKS: Record<LocationId, WorldPatch> = {
	// 19:30, warm: low amber light in the valley, haze to a ruddy horizon, lamps coming on.
	bellweather: look(1170, 0.25, '#6a4636', 0.3),
	// 20:50: the sun is down and a half moon stands over the gatehouse; cool air, warm candles.
	monastery: look(1250, 0.2, '#1c2a48', 0.5),
	// Underground: a navy floor under the Bell's blue-violet light.
	hollow: look(null, 0.15, '#0e1636', 0.4),
	// The Heart: dark red, a slow beat.
	heart: look(null, 0.2, '#3a0c10', 0.3)
};

/** What a chapter's opening does to the look of the table the party is on, by chapter. */
export const CHAPTER_LOOKS: Partial<Record<ChapterId, WorldPatch>> = {
	// The bell has rung and the Hound is out: 20:15, the light going violet.
	discover_bell: look(1215, 0.28, '#4a3a54', 0.4),
	// The nave: the moon higher, the air colder.
	enter_monastery: look(1255, 0.22, '#16223e', 0.6),
	// Down the stair into the dark.
	descend: look(1258, 0.25, '#101a3a', 0.4),
	// The Hollow wakes: the navy goes to wine.
	the_waking: look(null, 0.18, '#2a1020', 0.5),
	// The Bell rings itself: a red key.
	the_ringing: look(null, 0.22, '#3a0e1a', 0.5),
	// The Bell held, the Hollow waiting: back to a violet navy.
	final_decision: look(null, 0.16, '#1a1034', 0.5),
	// The Descent: the Heart's own look, with its light made to beat.
	the_descent: look(null, 0.2, '#3a0c10', 0.3)
};

/** Once the well's Hound is down: 20:45, the late end of dusk. Blue fill, warm lamps. */
export const NIGHTFALL: WorldPatch = look(1245, 0.3, '#2b3556', 0.5);

/** The final look of each ending, by answer (the Heart's is a table of its own). */
export const ENDING_LOOKS = {
	// Near-black and cold: the Bell split, every light out.
	destroy: look(null, 0.08, '#070a14', 0),
	// The red eye in a dark Hollow.
	silence: look(null, 0.1, '#14060c', 0),
	// Calm and blue. The grade is exposure 1 as it always was (a spec pins it).
	use: { haze: { density: 0.16, color: '#1a3a78' }, grade: { preset: 'hollow-blue', exposure: 1 } },
	// The Heart still and grey.
	descend: look(null, 0.16, '#3a3d44', 0.3)
} as const satisfies Record<string, WorldPatch>;

/**
 * The Hollow's own lights, recoloured as it wakes (colour, intensity and flicker only: a light's
 * place, reach and whether it is on are rules and stay): the pit's glow goes wine and then red,
 * the Bell's turns hot and breathes while it rings itself, and both come back for the choice.
 */
export const CHAPTER_LIGHTS: Partial<Record<ChapterId, readonly Effect[]>> = {
	the_waking: [{ light: 'ho-pit-glow', color: '#d8465f', intensity: 1.5, flicker: 'pulse' }],
	the_ringing: [
		{ light: 'ho-bell-glow', color: '#ff9a82', flicker: 'pulse' },
		{ light: 'ho-pit-glow', color: '#ff3a4c', intensity: 2, flicker: 'pulse' }
	],
	the_descent: [{ light: 'hh-heart-light', intensity: 1.8, flicker: 'pulse' }],
	final_decision: [
		{ light: 'ho-bell-glow', color: '#7fb6ff', flicker: 'none' },
		{ light: 'ho-pit-glow', color: '#9c6cff', intensity: 1, flicker: 'none' }
	]
};

/** A table's scene with `patch` laid over its world look; the band is the builder's own. */
export function lookedAt(scene: SceneFile, patch: WorldPatch, now = Date.now()): SceneFile {
	return { ...scene, world: applyWorldPatch(scene.world, patch, now) };
}
