// The finale's effects (M76 #336), worked out like vfx-cues.ts's from the synced state before and
// after a change and the log entries that came with it. Pure (no three.js), tested in Node. What a
// thing does when it comes or goes is read from its model's `staging` hints (assets/staging.ts), never
// from an id, a name or a line of text: tendrils rise, the Hand grasps, a crack bursts open and
// collapses, a broken bell shatters, the Heart pulses, because their models say so, and any
// adventure that uses the figures gets the same. Every position is a token or prop this viewer was
// sent, or the cell it last held one at. `staging` unset (no manifest yet) plays nothing. Nothing is
// sent anywhere.

import type { TurnView } from '../adventure/adventure';
import type { ChatMessage } from '../game/chat';
import type { GridPos } from '../game/grid';
import { footprintCells } from '../game/props';
import type { Staging } from '../assets/staging';
import type { VfxEvent, VfxState } from './vfx-cues';

/** The effects of the finale. `seed` hashes what it is about; `seq` is the log entry's. */
export type FinaleEvent =
	/** A foe rises out of the ground: it joined the fight (it did not just come into sight). */
	| { kind: 'emerge'; tokenId: string; at: GridPos; seed: number }
	/** A foe goes down into the ground, where it last stood. */
	| { kind: 'sink'; tokenId: string; at: GridPos; seed: number }
	/** A prop bursts open where it appeared (a crack) or collapses where it went. */
	| { kind: 'rupture' | 'collapse'; propId: string; at: GridPos; seed: number }
	/** A prop turned into one that breaks (the Bell to its broken self). */
	| { kind: 'shatter'; propId: string; at: GridPos; seed: number }
	/** An attack from a grasping thing: it lunges at its target. */
	| { kind: 'grasp'; from: GridPos; to: GridPos; seq: number }
	/** The ground heaves (one per change that ruptured or collapsed something). */
	| { kind: 'heave'; seed: number }
	/** A story ends: its final scene turns in at the glowing thing, if the viewer has one. */
	| { kind: 'ending'; at: GridPos | null; seed: number }
	/** Every prop with seams that is in view, each change: the glowing cracks (like `statuses`). */
	| { kind: 'seams'; of: [propId: string, at: GridPos][] };

/** The hints of a model id (a token's `model`, a prop's `assetId`). */
export type StagingOf = (model: string | undefined) => Staging | undefined;

/** The middle cell of a prop's footprint, where its effects centre. */
const centre = (p: Parameters<typeof footprintCells>[0]): GridPos => {
	const cells = footprintCells(p);
	return cells[Math.floor(cells.length / 2)] ?? p.pos;
};

/** Props with seams (a `rupture` model) in view, with the cell they glow at. */
export function seamsOf(
	props: VfxState['props'],
	staging: StagingOf | undefined
): [string, GridPos][] {
	if (!staging) return [];
	return props.flatMap((p): [string, GridPos][] =>
		staging(p.assetId)?.appear === 'rupture' ? [[p.id, centre(p)]] : []
	);
}

const key = (t: TurnView) => `${t.kind}:${t.name}:${t.initiative}`;

/**
 * `events` (vfx-cues.ts's own, for this change) with the finale's staging applied, and its own
 * events added: a spawn of an `emerge` model becomes an emerge (and nothing at all when its entry
 * only came into sight), a fall or despawn of a `sink` model a sink, and so on.
 */
export function stage(
	before: VfxState,
	after: VfxState,
	events: VfxEvent[],
	log: readonly ChatMessage[]
): VfxEvent[] {
	const staging = after.staging;
	if (!staging) return events;
	const model = (id: string) =>
		(after.tokens.find((t) => t.id === id) ?? before.tokens.find((t) => t.id === id))?.model;
	const hints = (id: string) => staging(model(id));
	const now = new Map(after.tokens.map((t) => [t.id, t.pos]));
	const at = (id: string | null | undefined) =>
		id ? (now.get(id) ?? after.lastSeen.get(id) ?? null) : null;

	// Entries that were already in the fight: a token that only came into sight is not new.
	const known = new Map<string, number>();
	for (const t of before.adventure?.encounter?.order ?? [])
		known.set(key(t), (known.get(key(t)) ?? 0) + 1);
	const seen = new Map<string, number>();
	const isNew = new Map<string, boolean>();
	for (const t of after.adventure?.encounter?.order ?? []) {
		const n = (seen.get(key(t)) ?? 0) + 1;
		seen.set(key(t), n);
		if (t.tokenId) isNew.set(t.tokenId, n > (known.get(key(t)) ?? 0));
	}

	const out: VfxEvent[] = [];
	const sunk = new Set<string>();
	for (const e of events) {
		if (e.kind === 'spawn' && hints(e.tokenId)?.appear === 'emerge') {
			if (isNew.get(e.tokenId)) out.push({ ...e, kind: 'emerge' });
		} else if (
			(e.kind === 'despawn' || (e.kind === 'fall' && e.enemy)) &&
			hints(e.tokenId)?.vanish === 'sink'
		) {
			sunk.add(e.tokenId);
			out.push({ kind: 'sink', tokenId: e.tokenId, at: e.at, seed: e.seed });
		} else out.push(e);
	}

	// An enemy's entry turned out as its token left the view (a victory, not a blow).
	const was = before.adventure?.encounter?.order ?? [];
	for (const t of after.adventure?.encounter?.order ?? []) {
		const prev = t.out ? was.find((x) => key(x) === key(t) && !x.out && x.tokenId) : undefined;
		const id = prev?.tokenId;
		const last = id ? after.lastSeen.get(id) : undefined;
		if (!id || !last || now.has(id) || sunk.has(id) || hints(id)?.vanish !== 'sink') continue;
		sunk.add(id);
		out.push({ kind: 'sink', tokenId: id, at: last, seed: hash(`${id}:sink`) });
	}

	for (const m of log) {
		if (m.kind !== 'attack' || !m.sourceId || hints(m.sourceId)?.attack !== 'grasp') continue;
		const [from, to] = [at(m.sourceId), at(m.targetId)];
		if (from && to) out.push({ kind: 'grasp', from, to, seq: m.seq });
	}

	let heaved = false;
	const had = new Map(before.props.map((p) => [p.id, p]));
	const stays = new Set(after.props.map((p) => p.id));
	for (const p of after.props) {
		const prev = had.get(p.id);
		const hint = staging(p.assetId);
		if (!prev && hint?.appear === 'rupture') {
			out.push({ kind: 'rupture', propId: p.id, at: centre(p), seed: hash(p.id) });
			heaved = true;
		} else if (prev && prev.assetId !== p.assetId && hint?.appear === 'shatter')
			out.push({ kind: 'shatter', propId: p.id, at: centre(p), seed: hash(p.id) });
	}
	for (const p of before.props) {
		if (stays.has(p.id) || staging(p.assetId)?.appear !== 'rupture') continue;
		out.push({ kind: 'collapse', propId: p.id, at: centre(p), seed: hash(p.id) });
		heaved = true;
	}
	if (heaved)
		out.push({ kind: 'heave', seed: hash(`heave:${after.adventure?.encounter?.round ?? 0}`) });

	if (after.adventure?.ending && before.adventure && !before.adventure.ending) {
		const glow = after.props.find((p) => staging(p.assetId)?.idle === 'pulse');
		out.push({ kind: 'ending', at: glow ? centre(glow) : null, seed: hash('ending') });
	}
	return out;
}

/** FNV-1a: a stable seed from a string. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}
