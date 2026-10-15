import { describe, expect, it } from 'vitest';
import type { AdventureView, EndingView, TurnView } from '../adventure/adventure';
import type { Staging } from '../assets/staging';
import type { ChatMessage } from '../game/chat';
import type { GridPos } from '../game/grid';
import type { Prop } from '../game/props';
import type { Token } from '../game/token';
import { seamsOf } from './finale-cues';
import { VfxTracker, vfxFor, type VfxEvent, type VfxState } from './vfx-cues';

// Models stand for what the finale's figures are drawn as; no id or name below says what they are.
// (The props are catalogue assets, which a footprint needs; the hints are the test's own.)
const HINTS: Record<string, Staging> = {
	rising: { appear: 'emerge', vanish: 'sink', attack: 'grasp' },
	crack: { appear: 'rupture' },
	'broken-bell': { appear: 'shatter' },
	heart: { idle: 'pulse', glowFrom: 'light' }
};
const staging = (m: string | undefined) => (m ? HINTS[m] : undefined);

const token = (id: string, x: number, y: number, model?: string, ownerId: string | null = null) =>
	({ id, name: id, color: '#fff', pos: { x, y }, ownerId, vision: 6, light: 0, model }) as Token;
const prop = (id: string, assetId: string, x: number, y: number) =>
	({ id, assetId, pos: { x, y }, rotation: 0, scale: 1 }) as unknown as Prop;
const entry = (tokenId: string | null, name = 'Foe', out = false): TurnView => ({
	kind: 'enemy',
	characterId: null,
	name,
	initiative: 10,
	tokenId,
	out
});
const fight = (order: TurnView[], round = 1) =>
	({ round, order, current: 0, enemies: [] }) as unknown as AdventureView['encounter'];
const story = (patch: Partial<AdventureView> = {}) =>
	({ characters: [], encounter: null, ending: null, ...patch }) as unknown as AdventureView;

function state(
	tokens: Token[],
	patch: Partial<VfxState> = {},
	seen: [string, GridPos][] = []
): VfxState {
	return {
		me: 'me',
		tokens,
		props: [],
		adventure: story(),
		lastSeen: new Map([...tokens.map((t) => [t.id, t.pos] as [string, GridPos]), ...seen]),
		staging,
		...patch
	};
}

const attack = (m: Record<string, unknown>) =>
	({
		seq: 7,
		at: 0,
		kind: 'attack',
		authorId: '',
		authorName: 'x',
		targetName: 'y',
		attack: 'z',
		toHit: { expression: '1d20', terms: [], total: 15 },
		defense: 10,
		hit: true,
		damage: { expression: '1d4', terms: [], total: 2 },
		...m
	}) as unknown as ChatMessage;

const kinds = (events: VfxEvent[]) => events.map((e) => e.kind);
const hero = token('w', 5, 5, undefined, 'me');

describe('without staging', () => {
	it('plays what vfxFor always did', () => {
		const before = state([hero], {
			adventure: story({ encounter: fight([]) }),
			staging: undefined
		});
		const after = state([hero, token('t', 7, 5, 'rising')], {
			adventure: story({ encounter: fight([entry('t')]) }),
			staging: undefined
		});
		expect(kinds(vfxFor(before, after, []))).toEqual(['spawn']);
	});

	it('plays nothing finale for models with no hints, whatever they are called', () => {
		const before = state([hero], { adventure: story({ encounter: fight([]) }) });
		const after = state([hero, token('tendril', 7, 5, 'plain')], {
			props: [prop('ho-crack-1', 'crate', 3, 3)],
			adventure: story({ encounter: fight([entry('tendril')]) })
		});
		expect(kinds(vfxFor(before, after, []))).toEqual(['spawn']);
	});
});

describe('emerge and sink', () => {
	it('a foe that joins the fight rises out of the ground, once', () => {
		const before = state([hero], { adventure: story({ encounter: fight([entry(null, 'A')]) }) });
		const after = state([hero, token('t1', 7, 5, 'rising'), token('t2', 8, 5, 'rising')], {
			adventure: story({
				encounter: fight([entry('t1', 'Tendril'), entry('t2', 'Tendril'), entry(null, 'A')])
			})
		});
		const events = vfxFor(before, after, []);
		expect(events.filter((e) => e.kind === 'emerge')).toEqual([
			{ kind: 'emerge', tokenId: 't1', at: { x: 7, y: 5 }, seed: expect.any(Number) },
			{ kind: 'emerge', tokenId: 't2', at: { x: 8, y: 5 }, seed: expect.any(Number) }
		]);
		expect(kinds(events)).not.toContain('spawn');
	});

	it('one that only came into sight plays nothing', () => {
		const order = (id: string | null) => fight([entry(id, 'Tendril')]);
		const before = state([hero], { adventure: story({ encounter: order(null) }) });
		const after = state([hero, token('t', 7, 5, 'rising')], {
			adventure: story({ encounter: order('t') })
		});
		expect(vfxFor(before, after, [])).toEqual([]);
	});

	it('a struck-down foe sinks where it last stood', () => {
		const before = state([hero, token('t', 7, 5, 'rising')], {
			adventure: story({ encounter: fight([entry('t', 'Tendril')]) })
		});
		const after = state([hero], {
			adventure: story({ encounter: fight([entry(null, 'Tendril', true)]) }),
			lastSeen: new Map([['t', { x: 7, y: 5 }]])
		});
		const events = vfxFor(before, after, [attack({ sourceId: 'w', targetId: 't' })]);
		expect(events.filter((e) => e.kind === 'sink')).toEqual([
			{ kind: 'sink', tokenId: 't', at: { x: 7, y: 5 }, seed: expect.any(Number) }
		]);
		expect(kinds(events)).not.toContain('fall');
	});

	it('one whose entry turns out as its token leaves the view sinks once, from the entry alone', () => {
		const before = state([hero, token('t', 7, 5, 'rising')], {
			adventure: story({ encounter: fight([entry('t', 'Tendril')]) })
		});
		const after = state([hero], {
			adventure: story({ encounter: fight([entry(null, 'Tendril', true)]) }),
			lastSeen: new Map([['t', { x: 7, y: 5 }]])
		});
		expect(kinds(vfxFor(before, after, []))).toEqual(['sink']);
	});

	it('a foe the viewer never held makes no sink', () => {
		const before = state([hero], { adventure: story({ encounter: fight([entry(null, 'T')]) }) });
		const after = state([hero], {
			adventure: story({ encounter: fight([entry(null, 'T', true)]) })
		});
		expect(vfxFor(before, after, [])).toEqual([]);
	});
});

describe('grasp', () => {
	it('an attack from a grasping figure lunges at its target', () => {
		const s = state([hero, token('h', 9, 5, 'rising')]);
		const events = vfxFor(s, s, [attack({ sourceId: 'h', targetId: 'w' })]);
		expect(events).toContainEqual({
			kind: 'grasp',
			from: { x: 9, y: 5 },
			to: { x: 5, y: 5 },
			seq: 7
		});
	});

	it('needs its attacker (redacted for a viewer who was not sent it)', () => {
		const s = state([hero, token('h', 9, 5, 'rising')]);
		expect(kinds(vfxFor(s, s, [attack({ targetId: 'w' })]))).toEqual(['impact']);
	});

	it('an attack from a figure without the hint does not', () => {
		const s = state([hero, token('c', 9, 5, 'plain')]);
		expect(kinds(vfxFor(s, s, [attack({ sourceId: 'c', targetId: 'w' })]))).toEqual(['impact']);
	});
});

describe('cracks, the heave and the broken bell', () => {
	const before = state([hero], { props: [prop('old', 'crack', 2, 2)] });

	it('new cracks burst open, old ones collapse, and the ground heaves once', () => {
		const after = state([hero], {
			props: [prop('n1', 'crack', 5, 5), prop('n2', 'crack', 6, 5)]
		});
		const events = vfxFor(before, after, []);
		expect(kinds(events)).toEqual(['rupture', 'rupture', 'collapse', 'heave']);
		expect(events[0]).toMatchObject({ propId: 'n1', at: { x: 5, y: 5 } });
		expect(events[2]).toMatchObject({ propId: 'old', at: { x: 2, y: 2 } });
	});

	it('a crack that stays plays nothing', () => {
		expect(vfxFor(before, state([hero], { props: [prop('old', 'crack', 2, 2)] }), [])).toEqual([]);
	});

	it('a prop turning into a breaking model shatters where it stood', () => {
		const a = state([hero], { props: [prop('b', 'bell', 4, 4)] });
		const b = state([hero], { props: [prop('b', 'broken-bell', 4, 4)] });
		expect(vfxFor(a, b, [])).toEqual([
			{ kind: 'shatter', propId: 'b', at: { x: 5, y: 5 }, seed: expect.any(Number) }
		]);
		expect(vfxFor(b, b, [])).toEqual([]);
	});

	it('a table just loaded plays none of it', () => {
		expect(vfxFor(null, before, [])).toEqual([]);
	});

	it('the seams are every cracked prop in view, as a whole set', () => {
		expect(seamsOf([prop('a', 'crack', 1, 1), prop('b', 'crate', 2, 2)], staging)).toEqual([
			['a', { x: 1, y: 1 }]
		]);
		expect(seamsOf([prop('a', 'crack', 1, 1)], undefined)).toEqual([]);
	});
});

describe('endings', () => {
	const ending = { id: 'e', title: 'T' } as EndingView;

	it('the update where the ending first appears turns the scene in, at the throbbing prop', () => {
		const props = [prop('h', 'heart', 10, 10)];
		const a = state([hero], { props, adventure: story() });
		const b = state([hero], { props, adventure: story({ ending }) });
		const events = vfxFor(a, b, []);
		expect(events).toEqual([{ kind: 'ending', at: expect.any(Object), seed: expect.any(Number) }]);
		expect(vfxFor(b, b, [])).toEqual([]);
		const bare = state([hero], { adventure: story({ ending }) });
		expect(vfxFor(a, bare, [])).toMatchObject([{ kind: 'ending', at: null }]);
	});
});

describe('the tracker', () => {
	it('lays the seams out as a set, again only when they change, and takes them away', () => {
		const played: VfxEvent[][] = [];
		const tracker = new VfxTracker((events) => void played.push(events), staging);
		const view = (props: Prop[]) => ({ me: 'me', tokens: [hero], props, adventure: story() });
		tracker.update('t', view([]), []);
		tracker.update('t', view([prop('c', 'crack', 3, 3)]), []);
		tracker.update('t', view([prop('c', 'crack', 3, 3)]), []);
		tracker.update('t', view([]), []);
		const seams = played.flat().filter((e) => e.kind === 'seams');
		expect(seams).toEqual([
			{ kind: 'seams', of: [['c', { x: 3, y: 3 }]] },
			{ kind: 'seams', of: [] }
		]);
	});
});
