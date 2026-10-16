import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../src/lib/game/dice';
import { defaultWorldFor } from '../src/lib/game/world';
import { setPause, setWorld } from './scene';
import { beginAdventure, claimCharacter, direct, startAdventure } from './adventure/engine';
import { appendLog, postChat } from './chat';
import { snapshotFor, viewFor } from './views';
import {
	FileRoomStore,
	MemoryRoomStore,
	restoreRoom,
	serializeRoom,
	SupabaseRoomStore,
	type LiveRoom
} from './room-store';
import { RoomManager, type Player, type Room } from './rooms';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

/** A room mid-story: The Hollow Bell begun, a fight on, a line of chat. */
beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	room.dice = max;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	ok(direct(room, gm, { op: 'encounter_start', encounter: 'well' }));
	ok(postChat(room, ana, 'Behind you!'));
	ana.explored[5] = 1;
});

const copy = (live: LiveRoom): LiveRoom => JSON.parse(JSON.stringify(live));

describe('a live room kept across a restart', () => {
	it('comes back with the same seats, tokens, story, log and explored maps, nobody connected', () => {
		const back = ok(restoreRoom(copy(serializeRoom(room)), 5000)).room;
		expect(back.id).toBe(room.id);
		expect([...back.players.values()].map((p) => [p.id, p.name, p.role, p.connected])).toEqual([
			[gm.id, 'Gia', 'gm', false],
			[ana.id, 'Ana', 'player', false]
		]);
		expect(back.players.get(ana.id)!.sessionToken).toBe(ana.sessionToken);
		expect(back.players.get(ana.id)!.explored[5]).toBe(1);
		const warden = [...back.tokens.values()].find((t) => t.name === 'The Warden')!;
		expect(warden.ownerId).toBe(ana.id);
		expect(back.adventure).toMatchObject({ stage: 'playing', chapter: room.adventure!.chapter });
		expect(back.adventure!.encounter?.id).toBe('well');
		expect(back.log.map((m) => ('text' in m ? m.text : m.kind))).toEqual(
			room.log.map((m) => ('text' in m ? m.text : m.kind))
		);
		expect(back.nextSeq).toBe(room.nextSeq);
		// Empty from the restart on, so it is still pruned if nobody comes back.
		expect(back.emptySince).toBe(5000);
	});

	it('stays listed for anyone to join, as its GM listed it', () => {
		expect(ok(restoreRoom(copy(serializeRoom(room)), 5000)).room.listed).toBe(false);
		room.listed = true;
		expect(ok(restoreRoom(copy(serializeRoom(room)), 5000)).room.listed).toBe(true);
		const older = copy(serializeRoom(room));
		delete older.listed;
		expect(ok(restoreRoom(older, 5000)).room.listed).toBe(false);
	});

	it("keeps the world's look", () => {
		ok(setWorld(room, gm, { time: 1300, weather: { kind: 'storm', seed: 9 } }, 42));
		const back = ok(restoreRoom(copy(serializeRoom(room)), 5000)).room;
		expect(back.world).toEqual(room.world);
		expect(back.ambient).toBe('dark');
	});

	it('comes back from before the world look: a room stored with a v9 table', () => {
		const live = copy(serializeRoom(room));
		const scene = live.scene as unknown as Record<string, unknown>;
		const discovery = live.scene.discovery;
		scene.version = 9;
		delete scene.world;
		delete scene.interior;
		scene.discovery = Object.fromEntries(
			Object.entries(discovery).map(([name, d]) => [name, d.explored])
		);
		const back = ok(restoreRoom(live, 5000)).room;
		expect(back.ambient).toBe(room.ambient);
		expect(back.world).toEqual(defaultWorldFor(room.ambient));
		expect(back.interior).toBeNull();
		expect(back.players.get(ana.id)!.explored[5]).toBe(1);
		expect(back.adventure).toMatchObject({ stage: 'playing', chapter: room.adventure!.chapter });
	});

	it('keeps the lights each seat remembers, as remembered, and restores a room from before them', () => {
		const torch = { id: 'old-torch', pos: { x: 2, y: 2 }, radius: 3, color: '#ffa04d', on: true };
		ana.seenLights = new Map([[torch.id, torch]]);
		ana.lightsLearned = ana.explored.slice();
		const live = copy(serializeRoom(room));
		expect(live.players.find((p) => p.id === ana.id)!.lights).toEqual([torch]);
		expect(live.players.find((p) => p.id === gm.id)!.lights).toBeUndefined();
		const back = ok(restoreRoom(live, 5000)).room.players.get(ana.id)!;
		expect([...back.seenLights!.values()]).toEqual([torch]);
		expect([...back.lightsLearned!]).toEqual([...back.explored]);

		// Stored before remembered lights: nothing learned, so the next sync learns them as today.
		for (const p of live.players) delete p.lights;
		for (const d of Object.values(live.scene.discovery)) delete d.lights;
		const older = ok(restoreRoom(live, 5000)).room.players.get(ana.id)!;
		expect(older.seenLights).toBeUndefined();
		expect(older.lightsLearned).toBeUndefined();

		// Checked like a scene's lights.
		const bad = copy(serializeRoom(room));
		bad.players.find((p) => p.id === ana.id)!.lights![0].pos = { x: 99, y: 0 };
		expect(restoreRoom(bad).ok).toBe(false);
	});

	it('never trusts what it reads back: a damaged room is rejected whole', () => {
		const good = serializeRoom(room);
		const broken = (patch: (r: LiveRoom) => void) => {
			const r = copy(good);
			patch(r);
			return restoreRoom(r);
		};
		expect(restoreRoom('nope').ok).toBe(false);
		expect(broken((r) => (r.version = 99)).ok).toBe(false);
		expect(broken((r) => (r.id = '../etc')).ok).toBe(false);
		expect(broken((r) => (r.players[0].sessionToken = 'guess')).ok).toBe(false);
		expect(broken((r) => (r.players[1].role = 'gm')).ok).toBe(false);
		expect(broken((r) => (r.players[1].sessionToken = r.players[0].sessionToken)).ok).toBe(false);
		expect(broken((r) => ((r.scene as { version: number }).version = 999)).ok).toBe(false);
		expect(broken((r) => (r.scene.adventure!.id = 'another-story')).ok).toBe(false);
		// Odd log entries are dropped, not trusted.
		const odd = broken((r) => r.log.push({ kind: 'chat' } as unknown as LiveRoom['log'][number]));
		expect(odd.ok && odd.room.log.length).toBe(room.log.length);
	});

	it("keeps attackers' tokens on log entries, and redacts them per viewer, old entries too (#314)", () => {
		const [houndId] = room.adventure!.encounter!.enemies.keys();
		const wardenId = [...room.tokens.values()].find((t) => t.name === 'The Warden')!.id;
		const roll = { expression: '1d20', terms: [], total: 20 };
		const bite = {
			kind: 'attack' as const,
			authorName: 'Hollow Hound',
			attack: 'Bite',
			targetId: wardenId,
			targetName: 'The Warden',
			toHit: roll,
			defense: 13,
			hit: true,
			damage: roll
		};
		appendLog(room, { ...bite, authorId: '', sourceId: houndId, ranged: false });
		// Before #314 an enemy's token id was its entry's author.
		appendLog(room, { ...bite, authorId: houndId });
		const back = ok(restoreRoom(copy(serializeRoom(room)))).room;
		const [now, old] = back.log.slice(-2);
		expect(now).toMatchObject({ authorId: '', sourceId: houndId, ranged: false });
		expect(old).toMatchObject({ authorId: houndId });

		const player = back.players.get(ana.id)!;
		const log = (viewer: Player) => snapshotFor(back, viewer, viewFor(back, viewer)).log.slice(-2);
		const seen = log(player);
		const knows = viewFor(back, player).tokens.some((t) => t.id === houndId);
		expect(seen[0]).toMatchObject({ authorId: '', targetId: wardenId, ranged: false });
		expect('sourceId' in seen[0]).toBe(knows);
		expect(seen[1]).toMatchObject({ authorId: '', targetId: wardenId });
		expect(log(back.players.get(gm.id)!)).toEqual([now, old]);
	});
});

describe('room stores', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-rooms-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('keeps rooms as files, one each, and forgets them when asked', async () => {
		const store = new FileRoomStore(dir);
		await store.save(serializeRoom(room));
		await writeFile(path.join(dir, 'notes.txt'), 'not a room');
		await writeFile(path.join(dir, 'ABCDEF.json'), '{broken');
		expect(await readdir(dir)).toContain(`${room.id}.json`);
		const all = await store.loadAll();
		expect(all).toHaveLength(1);
		expect(restoreRoom(all[0]).ok).toBe(true);
		await store.remove(room.id);
		expect(await store.loadAll()).toEqual([]);
		await expect(store.remove('../../etc')).rejects.toThrow(/Invalid room id/);
	});

	it('keeps nothing shared by reference in memory', async () => {
		const store = new MemoryRoomStore();
		const live = serializeRoom(room);
		await store.save(live);
		live.nextSeq = 0;
		expect(((await store.loadAll())[0] as LiveRoom).nextSeq).toBe(room.nextSeq);
	});

	it('keeps rooms in Supabase by id, and only the rooms’ own ids', async () => {
		const calls: unknown[][] = [];
		const builder = {
			upsert: (row: unknown) => (calls.push(['upsert', row]), Promise.resolve({ error: null })),
			delete: () => (calls.push(['delete']), builder),
			eq: (c: string, v: unknown) => (calls.push(['eq', c, v]), Promise.resolve({ error: null })),
			select: (c: string) => (calls.push(['select', c]), Promise.resolve({ data: [], error: null }))
		};
		const client = { from: (t: string) => (calls.push(['from', t]), builder) };
		const store = new SupabaseRoomStore(client as unknown as SupabaseClient);
		const live = serializeRoom(room);
		await store.save(live);
		await store.remove(room.id);
		await store.remove("x' or 1=1");
		expect(await store.loadAll()).toEqual([]);
		expect(calls).toEqual([
			['from', 'live_rooms'],
			['upsert', { id: room.id, data: live, updated_at: live.savedAt }],
			['from', 'live_rooms'],
			['delete'],
			['eq', 'id', room.id],
			['from', 'live_rooms'],
			['select', 'data']
		]);
	});
});

describe('a running clock in a live room (#324)', () => {
	it('is kept as the hour it shows, and starts again from there after a restart', () => {
		ok(setWorld(room, gm, { time: 1250, rate: 1 }, 1000));
		const live = copy(serializeRoom(room, new Date(6000)));
		expect(live.scene.world).toMatchObject({ time: 1255, rate: 1 });
		const back = ok(restoreRoom(live, 90_000)).room;
		// Downtime doesn't pass game time: the hour it showed, anchored at the restore.
		expect(back.world).toMatchObject({ time: 1255, rate: 1 });
		expect(back.timeAt).toBe(90_000);
		expect(back.ambient).toBe('dusk');
	});

	it('waits with a paused game, and a stopped clock stays stopped', () => {
		ok(setWorld(room, gm, { time: 1250, rate: 1 }, 1000));
		setPause(room, true, 6000);
		const paused = ok(restoreRoom(copy(serializeRoom(room, new Date(60_000))), 90_000)).room;
		expect(paused.world).toMatchObject({ time: 1255, rate: 1 });
		expect(paused).toMatchObject({ paused: true, timeAt: null });

		setPause(room, false, 70_000);
		ok(setWorld(room, gm, { rate: 0 }, 71_000));
		const stopped = ok(restoreRoom(copy(serializeRoom(room, new Date(80_000))), 90_000)).room;
		expect(stopped.timeAt).toBeNull();
	});
});
