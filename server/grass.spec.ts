// The GM's grass paint (M74, the owner's revision): who may paint it, what each viewer is sent,
// and that it lives on with the table (exported scenes, live rooms across a restart).
import { describe, expect, it } from 'vitest';
import { decodeGrass } from '../src/lib/game/floor';
import { restoreRoom, serializeRoom } from './room-store';
import { RoomManager, type Player } from './rooms';
import { createToken, setFog, setGrass } from './scene';
import { applyScene, exportScene } from './scene-io';
import { diffView, sentFrom, viewFor } from './views';

function setup() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	const { room, player: gm } = created;
	const seat = (name: string, role: 'player' | 'spectator'): Player => {
		const r = rooms.join(room.id, name, role);
		if (!r.ok) throw new Error(r.message);
		return r.player;
	};
	return { room, gm, pip: seat('Pip', 'player'), sam: seat('Sam', 'spectator') };
}

const all = { from: { x: 0, y: 0 }, to: { x: 19, y: 19 } };

describe('setGrass', () => {
	it('lets only the GM paint, on the map, and keeps no map once all Normal', () => {
		const { room, gm, pip, sam } = setup();
		for (const actor of [pip, sam]) {
			expect(setGrass(room, actor, all.from, all.to, 'lush', 'tall')).toMatchObject({
				ok: false,
				code: 'forbidden'
			});
		}
		expect(setGrass(room, gm, { x: 0, y: 0 }, { x: 20, y: 0 }, 'lush', 'tall')).toMatchObject({
			ok: false,
			code: 'invalid_position'
		});
		expect(room.grass).toBeNull();
		expect(setGrass(room, gm, { x: 1, y: 1 }, { x: 2, y: 2 }, 'none', 'short')).toEqual({
			ok: true,
			cells: 4
		});
		expect(room.grass![room.grid.width + 1]).toBe(0x11);
		setGrass(room, gm, all.from, all.to, 'normal', 'normal');
		expect(room.grass).toBeNull();
	});

	it('shows players and spectators only what they have explored; the GM all of it', () => {
		const { room, gm, pip, sam } = setup();
		setFog(room, gm, true);
		const hero = createToken(room, gm, {
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 1, y: 1 },
			ownerId: pip.id
		});
		expect(hero.ok).toBe(true);
		const before = sentFrom(viewFor(room, pip));
		setGrass(room, gm, all.from, all.to, 'dense', 'very-tall');
		const size = room.grid.width * room.grid.height;
		const far = 19 * room.grid.width + 19;
		const near = room.grid.width + 1;
		for (const viewer of [pip, sam]) {
			const seen = decodeGrass(viewFor(room, viewer).grass!, size)!;
			expect(seen[near]).toBe(0x33);
			expect(seen[far]).toBe(0);
		}
		expect(decodeGrass(viewFor(room, gm).grass!, size)![far]).toBe(0x33);
		expect(diffView(before, viewFor(room, pip))).toContainEqual({
			type: 'grass_update',
			grass: viewFor(room, pip).grass
		});
	});

	it('is saved with the table and kept by a live room across a restart', () => {
		const { room, gm } = setup();
		setGrass(room, gm, { x: 3, y: 3 }, { x: 4, y: 4 }, 'sparse', 'tall');
		const painted = room.grass!.slice();
		const file = exportScene(room, 'Meadow');
		expect(file.grass).not.toBeNull();
		setGrass(room, gm, all.from, all.to, 'normal', 'normal');
		applyScene(room, file);
		expect(room.grass).toEqual(painted);
		const back = restoreRoom(JSON.parse(JSON.stringify(serializeRoom(room))), 0);
		if (!back.ok) throw new Error(back.error);
		expect(back.room.grass).toEqual(painted);
	});
});
