// Combat and cue effects, worked out from what the client already has: the
// synced state before and after a change, and the log entries that came with
// it, as audio/cues.ts works out sounds. Pure (no three.js), so it is tested
// in Node. Every position comes from a token or prop this viewer was sent (or
// the cell it last held one at), never from a name or a line of text: nothing
// here reads `authorName`, `targetName` or `text`. Presentation only; nothing
// is sent anywhere.

import type { AdventureView } from '../adventure/adventure';
import { STATUSES } from '../adventure/characters';
import { HEAVY_HIT } from '../audio/cues';
import type { ChatMessage } from '../game/chat';
import type { GridPos } from '../game/grid';
import type { Prop } from '../game/props';
import type { Token } from '../game/token';
import { seamsOf, stage, type FinaleEvent, type StagingOf } from './finale-cues';
import { manifestStaging } from './staging-lookup';
import { statusVisuals, type StatusLook } from './status-visuals';

/** The parts of the room the effects are derived from. */
export interface VfxState {
	/** The viewer's player id. */
	me: string;
	tokens: readonly Token[];
	props: readonly Prop[];
	adventure: AdventureView | null;
	/** The last cell of every token this client was sent on this table (kept after it goes). */
	lastSeen: ReadonlyMap<string, GridPos>;
	/** What a model's `staging` hints say (#336); unset until the manifest has loaded: no finale effects. */
	staging?: StagingOf;
}

/**
 * An effect to play. `seq` is the log entry's it came from (the seed, as dice-throw.ts seeds
 * throws); `seed`, on effects of a change of state, hashes the token and the fight's round.
 */
export type VfxEvent =
	| { kind: 'impact'; tokenId: string; at: GridPos; heavy: boolean; seq: number }
	| { kind: 'miss' | 'heal' | 'burn'; tokenId: string; at: GridPos; seq: number }
	| { kind: 'guard'; tokenIds: string[]; seq: number }
	| { kind: 'projectile'; from: GridPos; to: GridPos; seq: number }
	| { kind: 'toll'; at: GridPos | null; propId: string | null; seq: number }
	| { kind: 'flash'; at: GridPos | null; seq: number }
	| { kind: 'fall'; tokenId: string; at: GridPos; enemy: boolean; seed: number }
	| { kind: 'spawn' | 'despawn'; tokenId: string; at: GridPos; seed: number }
	/** The fight is over (#315): its scorch and blood marks fade. */
	| { kind: 'calm' }
	/** Every token in view with statuses, its looks and cell (#316): the whole set, each time. */
	| { kind: 'statuses'; of: [tokenId: string, looks: StatusLook[], at: GridPos][] }
	/** The finale's: tendrils rising, cracks bursting, the Hand grasping, endings turning in (#336). */
	| FinaleEvent;

/** The props a toll rings: the belfry's bell and the Hollow's great bell. */
export const BELLS: readonly string[] = ['belfry-bell', 'great-bell'];

/**
 * The effects of a change from `before` to `after`, with the log entries that came in with it
 * (oldest first). `before` null: the table was just loaded, which plays nothing.
 */
export function vfxFor(
	before: VfxState | null,
	after: VfxState,
	log: readonly ChatMessage[]
): VfxEvent[] {
	if (!before) return [];
	const now = new Map(after.tokens.map((t) => [t.id, t.pos]));
	const at = (id: string | null | undefined) =>
		id ? (now.get(id) ?? after.lastSeen.get(id) ?? null) : null;
	const round = after.adventure?.encounter?.round ?? before.adventure?.encounter?.round ?? 0;
	const seedOf = (id: string) => hash(`${id}:${round}`);
	const characters = new Set(
		after.adventure?.characters.flatMap((c) => (c.tokenId ? [c.tokenId] : [])) ?? []
	);
	const events: VfxEvent[] = [];
	const felled = new Set<string>();
	let tolled: GridPos | null | undefined;

	for (const m of log) {
		if (m.kind === 'attack') {
			const to = at(m.targetId);
			if (m.targetId && to) {
				events.push(
					m.hit
						? {
								kind: 'impact',
								tokenId: m.targetId,
								at: to,
								heavy: (m.damage?.total ?? 0) >= HEAVY_HIT,
								seq: m.seq
							}
						: { kind: 'miss', tokenId: m.targetId, at: to, seq: m.seq }
				);
			}
			const from = at(m.sourceId);
			if (m.ranged && from && to) events.push({ kind: 'projectile', from, to, seq: m.seq });
		} else if (m.kind === 'ability') {
			if (/toll/i.test(m.ability)) {
				const from = at(m.sourceId);
				if (from) events.push({ kind: 'toll', at: from, propId: null, seq: m.seq });
				tolled ??= from;
				continue;
			}
			const to = at(m.targetId);
			if (!m.targetId || !to || m.amount === null || m.amount === 0) continue;
			const burning = m.ability === STATUSES.burning.name || /burn|fire|flame/i.test(m.ability);
			if (m.amount > 0) events.push({ kind: 'heal', tokenId: m.targetId, at: to, seq: m.seq });
			else if (burning) events.push({ kind: 'burn', tokenId: m.targetId, at: to, seq: m.seq });
		} else if (m.kind === 'narration' && m.cue === 'toll') {
			const bell = after.props.find((p) => BELLS.includes(p.assetId));
			const where = bell ? { ...bell.pos } : null;
			events.push({ kind: 'toll', at: where, propId: bell?.id ?? null, seq: m.seq });
			tolled ??= where;
		} else if (m.kind === 'narration' && m.cue === 'flash') {
			events.push({ kind: 'flash', at: tolled ?? null, seq: m.seq });
		}
		// An enemy struck down: its token is gone from the table, at the cell it last held.
		if ((m.kind === 'attack' || m.kind === 'ability') && m.targetId) {
			const id = m.targetId;
			const last = after.lastSeen.get(id);
			if (!now.has(id) && last && !characters.has(id) && !felled.has(id)) {
				felled.add(id);
				events.push({ kind: 'fall', tokenId: id, at: last, enemy: true, seed: m.seq });
			}
		}
	}

	events.push(...stateEvents(before, after, at, seedOf, felled, log));
	if (before.adventure?.encounter && after.adventure && !after.adventure.encounter)
		events.push({ kind: 'calm' });
	return stage(before, after, events, log);
}

/** Guards raised, characters falling, enemies brought on or taken away: from the views alone. */
function stateEvents(
	before: VfxState,
	after: VfxState,
	at: (id: string | null) => GridPos | null,
	seedOf: (id: string) => number,
	felled: ReadonlySet<string>,
	log: readonly ChatMessage[]
): VfxEvent[] {
	const a = before.adventure;
	const b = after.adventure;
	if (!a || !b) return [];
	const events: VfxEvent[] = [];
	const guarded: string[] = [];
	for (const c of b.characters) {
		const was = a.characters.find((x) => x.id === c.id);
		const where = at(c.tokenId);
		if (!was || !c.tokenId || !where) continue;
		const guarding = (s: typeof c) => s.statuses.some((x) => x.id === 'guarded');
		if (guarding(c) && !guarding(was)) guarded.push(c.tokenId);
		if (!was.downed && !was.dead && (c.downed || c.dead)) {
			events.push({
				kind: 'fall',
				tokenId: c.tokenId,
				at: where,
				enemy: false,
				seed: seedOf(c.tokenId)
			});
		}
	}
	if (guarded.length) {
		// With the entry that raised it, so it lands with its float; else seeded by the guarded.
		const entry = log.findLast(
			(m) => m.kind === 'ability' && !!m.sourceId && guarded.includes(m.sourceId)
		);
		events.push({ kind: 'guard', tokenIds: guarded, seq: entry?.seq ?? seedOf(guarded.join()) });
	}

	const had = new Set(before.tokens.map((t) => t.id));
	const inOrder = new Set(a.encounter?.order.flatMap((t) => (t.tokenId ? [t.tokenId] : [])));
	for (const t of b.encounter?.order ?? []) {
		const where = at(t.tokenId);
		if (t.kind !== 'enemy' || !t.tokenId || !where || had.has(t.tokenId) || inOrder.has(t.tokenId))
			continue;
		events.push({ kind: 'spawn', tokenId: t.tokenId, at: where, seed: seedOf(t.tokenId) });
	}

	// Taken out of the fight standing (removed by the GM, the fight called off): the order lost
	// enemies, and their tokens are gone. One that only left this viewer's sight stays in the order.
	// ponytail: counts the order's enemies, so one leaving sight as another is removed reads as both
	// removed; tell them apart by id once the view says which turns were removed.
	const enemies = (v: AdventureView) =>
		v.encounter?.order.filter((t) => t.kind === 'enemy').length ?? 0;
	if (enemies(b) < enemies(a)) {
		const now = new Set(after.tokens.map((t) => t.id));
		for (const e of a.encounter?.enemies ?? []) {
			const last = after.lastSeen.get(e.tokenId);
			if (e.hp <= 0 || now.has(e.tokenId) || felled.has(e.tokenId) || !last) continue;
			events.push({ kind: 'despawn', tokenId: e.tokenId, at: last, seed: seedOf(e.tokenId) });
		}
	}
	return events;
}

/** FNV-1a: a stable seed from a string. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** The effects that wait for their entry's card (RoomView's `showCard`), to land with its float. */
const ON_CARD: ReadonlySet<VfxEvent['kind']> = new Set([
	'impact',
	'miss',
	'heal',
	'burn',
	'guard',
	'projectile'
]);
const CARDED: ReadonlySet<ChatMessage['kind']> = new Set(['roll', 'attack', 'ability', 'check']);

/**
 * What `vfxFor` needs from one change to the next, kept for the room page: the last state, the
 * log entries already seen, the last cell of every token sent on this table, and the latest
 * card entry's effects, held until its card shows (`card`). Everything else plays at once.
 */
export class VfxTracker {
	private seen: VfxState | null = null;
	private table = '';
	private seq = -1;
	private lastSeen = new Map<string, GridPos>();
	private held: VfxEvent[] = [];
	/** The status set last sent, so only a change sends it again. */
	private statusKey = '[]';
	/** The same for the cracks' seams (#336). */
	private seamKey = '[]';
	private readonly play: (events: VfxEvent[]) => boolean | void;

	/**
	 * `play` returns false when there is no table to play on yet (statuses are then sent again);
	 * `staging` reads a model's hints (the manifest's, unless a test passes its own).
	 */
	constructor(
		play: (events: VfxEvent[]) => boolean | void,
		private readonly staging: StagingOf = manifestStaging
	) {
		this.play = play;
	}

	/** A change: `table` names the table (a new one forgets where tokens were). */
	update(table: string, view: Omit<VfxState, 'lastSeen'>, log: readonly ChatMessage[]): void {
		if (table !== this.table) {
			if (this.table) {
				// The old table's loops go, even for none here.
				this.statusKey = '';
				if (this.seamKey !== '[]') this.seamKey = '';
			}
			this.table = table;
			this.seen = null;
			this.lastSeen = new Map();
			this.seq = log.at(-1)?.seq ?? -1;
		}
		for (const t of view.tokens) this.lastSeen.set(t.id, { x: t.pos.x, y: t.pos.y });
		const state: VfxState = { ...view, lastSeen: new Map(this.lastSeen), staging: this.staging };
		const fresh = log.filter((m) => m.seq > this.seq);
		this.seq = log.at(-1)?.seq ?? this.seq;
		const events = vfxFor(this.seen, state, fresh);
		this.seen = state;
		const card = fresh.at(-1);
		const carded = card && CARDED.has(card.kind) ? card.seq : null;
		const held = events.filter((e) => ON_CARD.has(e.kind) && 'seq' in e && e.seq === carded);
		if (carded !== null) this.held = held;
		const now = events.filter((e) => !held.includes(e));
		const looks = statusVisuals(view.adventure);
		const of = view.tokens.flatMap((t): [string, StatusLook[], GridPos][] =>
			looks.has(t.id) ? [[t.id, looks.get(t.id)!, { x: t.pos.x, y: t.pos.y }]] : []
		);
		const key = JSON.stringify(of);
		if (key !== this.statusKey) {
			this.statusKey = key;
			now.push({ kind: 'statuses', of });
		}
		const seams = seamsOf(view.props, this.staging);
		const seamed = JSON.stringify(seams);
		if (seamed !== this.seamKey) {
			this.seamKey = seamed;
			now.push({ kind: 'seams', of: seams });
		}
		if (now.length && this.play(now) === false) {
			this.statusKey = '';
			if (this.seamKey !== '[]') this.seamKey = '';
		}
	}

	/** The card for log entry `seq` shows: its effects play. */
	card(seq: number): void {
		const due = this.held.filter((e) => 'seq' in e && e.seq === seq);
		this.held = this.held.filter((e) => !due.includes(e));
		if (due.length) this.play(due);
	}
}
