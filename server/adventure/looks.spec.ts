// The Hollow Bell's looks (M76, #338): data that only tunes how each place, chapter and ending is
// graded. Every look parses, none changes the rules band of the table it is on (the village and
// the monastery stay dusk, the Hollow and the Heart stay dark, in every ending), and no step moves
// the exposure by more than MAX_STEP_EV, so nothing reads as a flash.

import { describe, expect, it } from 'vitest';
import type { Ambient } from '../../src/lib/game/lights';
import { ambientFor, bandOf, parseWorldPatch } from '../../src/lib/game/world';
import { LOCATIONS } from '../adventures/hollow-bell/locations';
import {
	CHAPTER_LIGHTS,
	CHAPTER_LOOKS,
	ENDING_LOOKS,
	MAX_STEP_EV,
	NIGHTFALL,
	PLACE_LOOKS
} from '../adventures/hollow-bell/looks';
import { DECISIONS, type LocationId } from '../adventures/hollow-bell/story';
import { RoomManager, type Player, type Room } from '../rooms';
import { beginAdventure, claimCharacter, decide, direct, startAdventure } from './engine';

const BAND: Record<LocationId, Ambient> = {
	bellweather: 'dusk',
	monastery: 'dusk',
	hollow: 'dark',
	heart: 'dark'
};

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

/** What the table looks like at a moment of the story. */
interface Snap {
	chapter: string;
	location: LocationId;
	ambient: Ambient;
	time: number;
	sun: boolean;
	exposure: number;
	haze: string | null;
}

/** Plays the story with the GM's controls, answering the final choice with `answer`. */
function walk(answer: string): Snap[] {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	const ana = ok(rooms.join(created.room.id, 'Ana', 'player')).player;
	return playOut(created.room, created.player, ana, answer);
}

function playOut(room: Room, gm: Player, ana: Player, answer: string): Snap[] {
	const snaps: Snap[] = [];
	const snap = () => {
		const story = room.adventure!;
		snaps.push({
			chapter: story.chapter,
			location: story.location as LocationId,
			ambient: room.ambient,
			time: room.world.time,
			sun: room.world.sun,
			exposure: room.world.grade.exposure,
			haze: room.world.haze.color
		});
	};
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	room.dice = (sides) => sides;
	snap();
	for (let i = 0; i < 60 && room.adventure!.stage === 'playing'; i++) {
		const pending = room.adventure!.pending;
		if (pending) {
			const option =
				pending === 'bell' ? answer : DECISIONS[pending as keyof typeof DECISIONS].options[0].id;
			ok(decide(room, gm, pending, option));
		} else ok(direct(room, gm, { op: 'skip' }));
		snap();
	}
	expect(room.adventure!.stage).toBe('complete');
	return snaps;
}

const ANSWERS = ['destroy', 'silence', 'use', 'descend'] as const;

describe("The Hollow Bell's looks", () => {
	it('all parse as world patches', () => {
		const all = [
			...Object.values(PLACE_LOOKS),
			...Object.values(CHAPTER_LOOKS),
			...Object.values(ENDING_LOOKS),
			NIGHTFALL
		];
		for (const look of all) expect(parseWorldPatch(look)).toEqual(look);
		// The chapters whose lights are recoloured also have a look: the opening puts both first.
		for (const chapter of Object.keys(CHAPTER_LIGHTS))
			expect(CHAPTER_LOOKS).toHaveProperty(chapter);
	});

	it("keep each table's band: dusk in the village and the monastery, dark in the Hollow and the Heart", () => {
		for (const [id, location] of Object.entries(LOCATIONS)) {
			const scene = location.scene();
			expect(scene.ambient).toBe(BAND[id as LocationId]);
			expect(ambientFor(scene.world, scene.ambient)).toBe(scene.ambient);
			if (scene.world.sun) expect(bandOf(scene.world.time)).toBe('dusk');
			expect(scene.world.sun).toBe(BAND[id as LocationId] === 'dusk');
		}
		// Nightfall is the late end of dusk, not night.
		expect(bandOf(NIGHTFALL.time!)).toBe('dusk');
		for (const look of [...Object.values(CHAPTER_LOOKS), PLACE_LOOKS.monastery]) {
			if (look.time !== undefined) expect(bandOf(look.time)).toBe('dusk');
		}
	});

	for (const answer of ANSWERS) {
		it(`stay in band and step gently through the whole story, to ${answer}`, () => {
			const snaps = walk(answer);
			for (const s of snaps) {
				expect(s.ambient, `${s.chapter} at ${s.location}`).toBe(BAND[s.location]);
				expect(ambientFor({ time: s.time, sun: s.sun } as never, s.ambient)).toBe(s.ambient);
			}
			// A chapter's own look, once it has begun.
			for (const [chapter, look] of Object.entries(CHAPTER_LOOKS)) {
				const at = snaps.find((s) => s.chapter === chapter);
				if (at) expect(at.haze).toBe(look.haze?.color);
			}
			// No change of exposure within a place exceeds the cap; a new table is a new place.
			for (let i = 1; i < snaps.length; i++) {
				if (snaps[i].location !== snaps[i - 1].location) continue;
				const step = Math.abs(snaps[i].exposure - snaps[i - 1].exposure);
				expect(step, `${snaps[i - 1].chapter} to ${snaps[i].chapter}`).toBeLessThanOrEqual(
					MAX_STEP_EV + 1e-9
				);
			}
			const last = snaps.at(-1)!;
			const ending = answer === 'descend' ? ENDING_LOOKS.descend : ENDING_LOOKS[answer];
			expect(last.haze).toBe(ending.haze?.color);
			expect(last.exposure).toBe(ending.grade?.exposure);
		});
	}

	it('lead the village from dusk toward nightfall, and the monastery by a later moon', () => {
		const snaps = walk('silence');
		const at = (chapter: string) => snaps.find((s) => s.chapter === chapter)!;
		expect(at('village').time).toBeLessThan(at('discover_bell').time);
		expect(snaps.some((s) => s.location === 'bellweather' && s.time === NIGHTFALL.time)).toBe(true);
		expect(at('investigate_monastery').time).toBeGreaterThan(NIGHTFALL.time! - 1);
		expect(at('the_hollow').sun).toBe(false);
	});
});
