// Plays the combat and status effects (#315, #316) on the particle layer: each `VfxEvent`
// (vfx-cues.ts, worked out from the synced state and the log) becomes bursts of vfx-recipes.ts's
// recipes at the cell it names, seeded by the event's `seq` or `seed` so every client sees the
// same; statuses become loops on the bases, kept per token and look. A lazy `vfx` chunk module
// (vfx.ts re-exports `playVfx`); the renderer only delegates to it. Pure but for the layers it is
// handed, so it is tested in Node with stand-ins (vfx-play.spec.ts). Nothing here is sent anywhere.
//
// Under reduced motion every event is one short static ring at its target (heals and guards keep
// their glyphs, held still): nothing travels, no debris, no projectile. Reduce flashing is the
// layer's own `flashCap`. Low halves every recipe's particles (the layer's `share`).

import type { GridPos, SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { DecalLayer } from './decals';
import type { Ground } from './ground';
import type { StatusLook } from './status-visuals';
import type { VfxEvent } from './vfx-cues';
import type { VfxLayer } from './vfx';
import { cellOrigin, type Origin } from './vfx-state';
import type { RecipeId } from './vfx-recipes';
import { isFinale, playFinale, budgetOf } from './vfx-finale';
import { playToll } from './vfx-toll';

/** What an effect needs of the table; the renderer hands it fresh on every call. */
export interface PlayContext {
	vfx: Pick<VfxLayer, 'burst' | 'loop' | 'unloop'> &
		Partial<Pick<VfxLayer, 'tier' | 'reduceFlashing'>>;
	grid: SquareGrid | null;
	ground: Ground | null;
	tokens: readonly Token[];
	/** What a toll's dust and a flash's wave are placed by (vfx-toll.ts); none: nothing of theirs plays. */
	props?: readonly Prop[];
	objects?: readonly SceneObject[];
	focus?: { x: number; z: number };
	decals: Pick<DecalLayer, 'addTransient' | 'fade'>;
	/** The camera's heave for the ground rupturing (effects.ts, #336); none: it does not shake. */
	effects?: { heave(now: number, reducedMotion: boolean): void };
	/** The renderer's clock (ms). */
	now: number;
	reduced: boolean;
}

/** A shot's flight in ms, its apex over the chord (#315), and the slices it is drawn in. */
export const FLIGHT_MS = 350;
export const ARC_APEX = 0.3;
const SLICES = 10;
/** How high a burst on a mini sits (chest height), world units. */
const CHEST = 0.45;
/** How long a scorch or blood mark lasts at most, ms; it fades at the fight's end. */
const MARK_MS = 90_000;

/** The point at `t` (0 to 1) of a parabola from `from` to `to`, peaking at `ARC_APEX` of the chord. */
export function arcAt(from: Origin, to: Origin, t: number): Origin {
	const chord = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t + 4 * ARC_APEX * chord * t * (1 - t),
		z: from.z + (to.z - from.z) * t
	};
}

/** Statuses' recipes and how high above the floor each sits. */
const LOOKS: Record<StatusLook, [RecipeId, number]> = {
	embers: ['embers', 0.2],
	shimmer: ['shimmer', 0.08],
	frost: ['frost', 0.06],
	shadow: ['wisp', 0.1],
	sparks: ['glints', 0.25],
	neutral: ['ringlet', 0.05],
	more: ['more', 0.1]
};

/** The status loops running on each layer: loop id to the cell it was laid at. */
const running = new WeakMap<object, Map<string, string>>();

/** Plays `events`; false when the table has no ground yet (nothing played). */
export function playVfx(events: readonly VfxEvent[], ctx: PlayContext): boolean {
	const { grid, ground } = ctx;
	if (!grid || !ground) return false;
	const at = (cell: GridPos, lift = 0) => cellOrigin(grid, ground, cell, lift);
	const burst = (recipe: RecipeId, o: Origin, seed: number, delay = 0) =>
		ctx.vfx.burst(recipe, o, seed, ctx.now + delay);
	const mark = (atlasKey: 'scorch' | 'blood', cell: GridPos, seed: number, delay: number) =>
		ctx.decals.addTransient({
			atlasKey,
			cell,
			rotation: (seed % 628) / 100,
			seed,
			until: ctx.now + delay + MARK_MS
		});
	// A shot lands when it arrives: its impact or miss waits for its flight.
	const flying = new Set(
		ctx.reduced ? [] : events.flatMap((e) => (e.kind === 'projectile' ? [e.seq] : []))
	);
	const ring = (cell: GridPos, seed: number) => burst('ring', at(cell, CHEST), seed);

	for (const e of events) {
		if (isFinale(e)) {
			playFinale(e, ctx);
			continue;
		}
		switch (e.kind) {
			case 'impact': {
				const delay = flying.has(e.seq) ? FLIGHT_MS : 0;
				if (ctx.reduced) ring(e.at, e.seq);
				else {
					burst('sparks', at(e.at, CHEST), e.seq, delay);
					if (e.heavy) {
						burst('shock', at(e.at, 0.03), e.seq, delay);
						burst('chips', at(e.at, 0.1), e.seq + 1, delay);
					}
				}
				if (e.heavy) mark('blood', e.at, e.seq, delay);
				break;
			}
			case 'miss': {
				const delay = flying.has(e.seq) ? FLIGHT_MS : 0;
				if (ctx.reduced) ring(e.at, e.seq);
				else {
					burst('whiff', at(e.at, CHEST), e.seq, delay);
					const o = at(e.at, 0.05);
					burst('dustpuff', { ...o, x: o.x + 0.35 }, e.seq + 1, delay);
				}
				break;
			}
			case 'heal':
				burst('heal', at(e.at, 0.2), e.seq);
				break;
			case 'burn':
				if (ctx.reduced) ring(e.at, e.seq);
				else {
					burst('embers', at(e.at, 0.15), e.seq);
					burst('lick', at(e.at, 0.1), e.seq + 1);
				}
				mark('scorch', e.at, e.seq, 0);
				break;
			case 'guard':
				for (const id of e.tokenIds) {
					const token = ctx.tokens.find((t) => t.id === id);
					if (token) burst('ward', at(token.pos, 0.1), e.seq);
				}
				break;
			case 'projectile':
				if (ctx.reduced) break;
				for (let i = 0; i < SLICES; i++) {
					const t = i / (SLICES - 1);
					burst('bolt', arcAt(at(e.from, CHEST), at(e.to, CHEST), t), e.seq + i, t * FLIGHT_MS);
				}
				break;
			case 'fall':
				if (ctx.reduced) ring(e.at, e.seed);
				else {
					burst('dustpuff', at(e.at, 0.05), e.seed);
					if (e.enemy) burst('wisp', at(e.at, 0.1), e.seed + 1);
				}
				break;
			case 'spawn':
				if (ctx.reduced) ring(e.at, e.seed);
				else {
					burst('dustpuff', at(e.at, 0.05), e.seed);
					burst('wisp', at(e.at, 0.1), e.seed + 1);
				}
				break;
			case 'despawn':
				if (ctx.reduced) ring(e.at, e.seed);
				else burst('dustpuff', at(e.at, 0.05), e.seed);
				break;
			case 'calm':
				ctx.decals.fade();
				break;
			case 'statuses':
				statuses(ctx, e.of, at);
				break;
			case 'toll':
			case 'flash':
				if (e.kind === 'flash') budgetOf(ctx.vfx).take(ctx.now); // counted against the finale's (#336)
				// The cue path (effects.ts) swings the bell and runs the flash; this is what has a place.
				if (ctx.focus)
					playToll(
						ctx.vfx,
						e,
						{ grid, ground, props: ctx.props ?? [], objects: ctx.objects ?? [], focus: ctx.focus },
						ctx.now,
						ctx.reduced
					);
				break;
		}
	}
	return true;
}

/** Lays one loop per token and look, and takes away the ones no longer wanted or moved. */
function statuses(
	ctx: PlayContext,
	of: readonly (readonly [string, readonly StatusLook[], GridPos])[],
	at: (cell: GridPos, lift?: number) => Origin
): void {
	const have = running.get(ctx.vfx) ?? new Map<string, string>();
	running.set(ctx.vfx, have);
	const want = new Map<string, [StatusLook, GridPos]>();
	for (const [tokenId, looks, cell] of of)
		for (const look of looks) want.set(`st:${tokenId}:${look}`, [look, cell]);
	for (const id of have.keys()) {
		if (want.has(id)) continue;
		ctx.vfx.unloop(id);
		have.delete(id);
	}
	for (const [id, [look, cell]] of want) {
		const key = `${cell.x},${cell.y}`;
		if (have.get(id) === key) continue;
		const [recipe, lift] = LOOKS[look];
		const o = at(cell, lift);
		ctx.vfx.loop(id, recipe, look === 'more' ? { ...o, x: o.x + 0.4 } : o, hash(id));
		have.set(id, key);
	}
}

/** A stable seed from a loop id. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** `playVfx` bound to a table's layers (the renderer's one line): events, its ground, the clock. */
export const vfxPlayer =
	(vfx: PlayContext['vfx'], decals: PlayContext['decals']) =>
	(
		events: readonly VfxEvent[],
		view: Pick<
			PlayContext,
			'grid' | 'ground' | 'tokens' | 'props' | 'objects' | 'focus' | 'effects'
		>,
		now: number,
		reduced: boolean
	) =>
		playVfx(events, { vfx, decals, ...view, now, reduced });
