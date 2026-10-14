import { describe, expect, it } from 'vitest';
import type { AdventureView, CharacterStatus, TurnView } from '../adventure/adventure';
import type { ChatMessage } from '../game/chat';
import type { DiceRoll } from '../game/dice';
import type { GridPos } from '../game/grid';
import type { Prop } from '../game/props';
import type { Token } from '../game/token';
import { VfxTracker, vfxFor, type VfxEvent, type VfxState } from './vfx-cues';

const token = (id: string, x: number, y: number, ownerId: string | null = null): Token => ({
	id,
	name: id,
	color: '#ffffff',
	pos: { x, y },
	ownerId,
	vision: 6,
	light: 0
});

const hero = (patch: Partial<CharacterStatus> = {}) =>
	({
		id: 'warden',
		playerId: 'me',
		tokenId: 'w',
		downed: false,
		dead: false,
		statuses: [],
		...patch
	}) as CharacterStatus;

const turn = (tokenId: string | null): TurnView => ({
	kind: 'enemy',
	characterId: null,
	name: 'Hollow Hound',
	initiative: 10,
	tokenId,
	out: false
});

/** Just the parts of the adventure view the effects read. */
function story(patch: Partial<AdventureView> = {}): AdventureView {
	return {
		characters: [hero()],
		encounter: null,
		...patch
	} as unknown as AdventureView;
}

const fight = (order: TurnView[], enemies: { tokenId: string; hp: number }[] = [], round = 1) =>
	({ round, order, current: 0, enemies }) as unknown as AdventureView['encounter'];

function state(tokens: Token[], patch: Partial<VfxState> = {}, seen: [string, GridPos][] = []) {
	return {
		me: 'me',
		tokens,
		props: [],
		adventure: story(),
		lastSeen: new Map([...tokens.map((t) => [t.id, t.pos] as [string, GridPos]), ...seen]),
		...patch
	} satisfies VfxState;
}

const roll = (total: number): DiceRoll => ({ expression: '1d20', terms: [], total });

const attack = (m: Record<string, unknown> = {}) =>
	({
		seq: 7,
		at: 0,
		kind: 'attack',
		authorId: '',
		authorName: 'Bell Cultist',
		attack: 'Sling',
		targetName: 'The Warden',
		toHit: roll(18),
		defense: 13,
		hit: true,
		damage: roll(5),
		...m
	}) as unknown as ChatMessage;

const ability = (m: Record<string, unknown>) =>
	({
		seq: 8,
		at: 0,
		kind: 'ability',
		authorId: '',
		authorName: 'x',
		targetName: null,
		roll: null,
		text: '',
		...m
	}) as unknown as ChatMessage;

const here = [token('w', 5, 5, 'me'), token('c', 9, 5)];

describe('vfxFor', () => {
	it('plays nothing for a table just loaded', () => {
		expect(vfxFor(null, state(here), [attack({ sourceId: 'c', targetId: 'w' })])).toEqual([]);
	});

	it('strikes, misses and throws from the tokens in the view', () => {
		const s = state(here);
		expect(vfxFor(s, s, [attack({ sourceId: 'c', targetId: 'w', ranged: true })])).toEqual([
			{ kind: 'impact', tokenId: 'w', at: { x: 5, y: 5 }, heavy: false, seq: 7 },
			{ kind: 'projectile', from: { x: 9, y: 5 }, to: { x: 5, y: 5 }, seq: 7 }
		]);
		const heavy = attack({ targetId: 'w', damage: roll(8), ranged: false });
		expect(vfxFor(s, s, [heavy])).toEqual([
			{ kind: 'impact', tokenId: 'w', at: { x: 5, y: 5 }, heavy: true, seq: 7 }
		]);
		expect(vfxFor(s, s, [attack({ targetId: 'w', hit: false, damage: null })])).toEqual([
			{ kind: 'miss', tokenId: 'w', at: { x: 5, y: 5 }, seq: 7 }
		]);
	});

	it('throws nothing without the attacker (redacted) or its flag', () => {
		const s = state(here);
		const kinds = (m: ChatMessage) => vfxFor(s, s, [m]).map((e) => e.kind);
		expect(kinds(attack({ targetId: 'w', ranged: true }))).toEqual(['impact']);
		expect(kinds(attack({ sourceId: 'c', targetId: 'w' }))).toEqual(['impact']);
	});

	it('heals and burns by the entry, never its text', () => {
		const s = state(here);
		expect(vfxFor(s, s, [ability({ ability: 'Mend', targetId: 'w', amount: 6 })])).toEqual([
			{ kind: 'heal', tokenId: 'w', at: { x: 5, y: 5 }, seq: 8 }
		]);
		const burn = ability({ ability: 'Burning', sourceId: 'c', targetId: 'c', amount: -3 });
		expect(vfxFor(s, s, [burn])).toEqual([
			{ kind: 'burn', tokenId: 'c', at: { x: 9, y: 5 }, seq: 8 }
		]);
	});

	it('gives no effect for a target missing from the view', () => {
		const s = state(here);
		expect(vfxFor(s, s, [attack({ targetId: 'gone', sourceId: 'c', ranged: true })])).toEqual([]);
	});

	it('guards those whose views gained the status, with the entry that raised it', () => {
		const before = state(here);
		const after = state(here, {
			adventure: story({ characters: [hero({ statuses: [{ id: 'guarded', rounds: 1 }] })] })
		});
		const raised = ability({ ability: 'Shield wall', sourceId: 'w', targetId: null, amount: null });
		expect(vfxFor(before, after, [raised])).toEqual([{ kind: 'guard', tokenIds: ['w'], seq: 8 }]);
	});

	it('tolls at the bell in view, and flashes from it', () => {
		const bell: Prop = {
			id: 'b',
			assetId: 'belfry-bell',
			pos: { x: 2, y: 3 },
			rotation: 0,
			scale: 1
		};
		const s = state(here, { props: [bell] });
		const cue = (seq: number, c: string) =>
			({ seq, at: 0, kind: 'narration', text: '', cue: c }) as ChatMessage;
		expect(vfxFor(s, s, [cue(1, 'toll'), cue(2, 'flash')])).toEqual([
			{ kind: 'toll', at: { x: 2, y: 3 }, propId: 'b', seq: 1 },
			{ kind: 'flash', at: { x: 2, y: 3 }, seq: 2 }
		]);
		const bare = state(here);
		expect(vfxFor(bare, bare, [cue(3, 'flash')])).toEqual([{ kind: 'flash', at: null, seq: 3 }]);
		// The Keeper's toll, at the Keeper when this viewer sees it.
		const toll = ability({ ability: 'Toll', sourceId: 'c', targetId: null, amount: -2 });
		expect(vfxFor(s, s, [toll])).toEqual([
			{ kind: 'toll', at: { x: 9, y: 5 }, propId: null, seq: 8 }
		]);
		expect(vfxFor(s, s, [{ ...toll, sourceId: undefined } as ChatMessage])).toEqual([]);
	});

	it('lays a killed enemy down at its last cell when its token went first', () => {
		const before = state(here);
		// token_deleted arrived before the killing blow: the token is gone, its cell remembered.
		const after = state([here[0]], {}, [['c', { x: 9, y: 5 }]]);
		const blow = attack({ authorId: 'me', sourceId: 'w', targetId: 'c', damage: roll(11) });
		expect(vfxFor(before, after, [blow])).toEqual([
			{ kind: 'impact', tokenId: 'c', at: { x: 9, y: 5 }, heavy: true, seq: 7 },
			{ kind: 'fall', tokenId: 'c', at: { x: 9, y: 5 }, enemy: true, seed: 7 }
		]);
	});

	it('lays a character down when its view says it fell', () => {
		const after = state(here, { adventure: story({ characters: [hero({ downed: true })] }) });
		const [fall] = vfxFor(state(here), after, []);
		expect(fall).toMatchObject({ kind: 'fall', tokenId: 'w', at: { x: 5, y: 5 }, enemy: false });
	});

	it('plays nothing when a token only leaves sight', () => {
		const inFight = {
			adventure: story({ encounter: fight([turn('c')], [{ tokenId: 'c', hp: 9 }]) })
		};
		const gone = { adventure: story({ encounter: fight([turn(null)], []) }) };
		expect(vfxFor(state(here, inFight), state([here[0]], gone), [])).toEqual([]);
	});

	it('brings on only a new combatant this viewer sees', () => {
		const before = state([here[0]], { adventure: story({ encounter: fight([]) }) });
		const after = state(here, { adventure: story({ encounter: fight([turn('c'), turn(null)]) }) });
		const [spawn, ...rest] = vfxFor(before, after, []);
		expect(spawn).toMatchObject({ kind: 'spawn', tokenId: 'c', at: { x: 9, y: 5 } });
		expect(rest).toEqual([]);
		// A sentry already on the table that joins the fight is no newcomer.
		const watched = state(here, { adventure: story({ encounter: null }) });
		expect(vfxFor(watched, after, [])).toEqual([]);
	});

	it('takes away an enemy removed from the fight standing, at its last cell', () => {
		const before = state(here, {
			adventure: story({ encounter: fight([turn('c')], [{ tokenId: 'c', hp: 9 }]) })
		});
		const after = state([here[0]], { adventure: story({ encounter: null }) }, [
			['c', { x: 9, y: 5 }]
		]);
		const [despawn, ...rest] = vfxFor(before, after, []);
		expect(despawn).toMatchObject({ kind: 'despawn', tokenId: 'c', at: { x: 9, y: 5 } });
		expect(rest).toEqual([]);
	});

	it('gives the same events and seeds for the same inputs, whatever the names', () => {
		const before = state(here, {
			adventure: story({ encounter: fight([turn('c')], [{ tokenId: 'c', hp: 9 }], 3) })
		});
		const after = state([here[0]], { adventure: story({ encounter: null }) }, [
			['c', { x: 9, y: 5 }]
		]);
		const log = [attack({ sourceId: 'c', targetId: 'w', ranged: true })];
		const first = vfxFor(before, after, log);
		expect(vfxFor(before, after, log)).toEqual(first);
		const renamed = (s: VfxState): VfxState => ({
			...s,
			tokens: s.tokens.map((t) => ({ ...t, name: `${t.name} the Renamed` }))
		});
		const relabelled = log.map((m) => ({ ...m, authorName: 'Someone', targetName: 'Else' }));
		expect(vfxFor(renamed(before), renamed(after), relabelled as ChatMessage[])).toEqual(first);
	});

	it("places nothing on a fogged player's view for a hidden attacker and target named in the log", () => {
		// A player sees only their own Warden; the server dropped the ids it wasn't sent.
		const mine = state([here[0]]);
		const redacted = attack({ authorName: 'Bell Cultist', targetName: 'The Veil', ranged: true });
		expect(vfxFor(mine, mine, [redacted])).toEqual([]);
		// Even an id that slipped through places nothing the view doesn't hold.
		const leaked = attack({ sourceId: 'c', targetId: 'v', ranged: true });
		expect(vfxFor(mine, mine, [leaked])).toEqual([]);
	});
});

describe('VfxTracker', () => {
	const view = (tokens: Token[]) => ({ me: 'me', tokens, props: [], adventure: story() });

	it("holds the card entry's effects for its card and plays the rest at once", () => {
		const played: VfxEvent[][] = [];
		const vfx = new VfxTracker((e) => played.push(e));
		const cue = { seq: 6, at: 0, kind: 'narration', text: '', cue: 'flash' } as ChatMessage;
		vfx.update('t', view(here), []);
		const blow = attack({ sourceId: 'c', targetId: 'w', ranged: true });
		vfx.update('t', view(here), [cue, blow]);
		expect(played.map((b) => b.map((e) => e.kind))).toEqual([['flash']]);
		vfx.card(7);
		expect(played.map((b) => b.map((e) => e.kind))).toEqual([['flash'], ['impact', 'projectile']]);
		vfx.card(7);
		expect(played).toHaveLength(2);
	});

	it('remembers a token after it goes, until the table changes', () => {
		const played: VfxEvent[][] = [];
		const vfx = new VfxTracker((e) => played.push(e));
		vfx.update('t', view(here), []);
		vfx.update('t', view([here[0]]), [attack({ targetId: 'c', seq: 9 })]);
		vfx.card(9);
		expect(played.flat().map((e) => e.kind)).toEqual(['fall', 'impact']);
		// A new table: nothing from the old one, and its first change plays nothing.
		vfx.update('u', view([here[0]]), [attack({ targetId: 'c', seq: 10 })]);
		vfx.update('u', view([here[0]]), [attack({ targetId: 'c', seq: 11 })]);
		vfx.card(11);
		expect(played.flat()).toHaveLength(2);
	});
});
