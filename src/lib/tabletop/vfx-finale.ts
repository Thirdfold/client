// Plays the finale's events (finale-cues.ts, #336) on the particle layer, a part of the lazy `vfx`
// chunk: tendrils rising out of the ground and sinking back, cracks bursting open with a seam of
// embers and collapsing in dust, the Hand's lunge, a bell shattering, the ground's heave, an
// ending's scene turning in. Mostly bursts of existing recipes at a cell the viewer was sent, seeded
// by the event so every client sees the same.
//
// Flashes: the bright bursts (shocks, spark showers, rings) share one `FlashBudget` per layer, at
// most `FLASH_BUDGET` a second (WCAG 2.3.1) and one under Reduce flashing, which also keeps every
// colour under 1 (the layer's flash cap), so the ringing phase stays inside the cap whatever its
// cracks, tendrils and tolls do together; what the budget refuses still plays its dust.
// Reduced motion: nothing shakes, nothing travels; each event is one short static ring (as the
// rest of vfx-play.ts) and the seams hold still. Low: no debris, and the layer halves the rest.

import type { GridPos } from '$lib/game/grid';
import type { FinaleEvent } from './finale-cues';
import type { PlayContext } from './vfx-play';
import { hangOf } from './vfx-toll';
import { cellOrigin, type Origin } from './vfx-state';
import type { RecipeId } from './vfx-recipes';
import { footprintCells, type Prop } from '$lib/game/props';
import { tintSeed } from './air-plan';

/** Bright bursts a second, shared by every finale effect (3 is WCAG 2.3.1's limit); 1 when reduced. */
export const FLASH_BUDGET = 3;
export const FLASH_BUDGET_SOFT = 1;

/** A rolling count of bright bursts in the last second. */
export class FlashBudget {
	private times: number[] = [];

	constructor(readonly max: number) {}

	/** Whether a bright burst at `now` (ms) fits; if it does it is counted. */
	take(now: number): boolean {
		this.times = this.times.filter((t) => now - t < 1000);
		if (this.times.length >= this.max) return false;
		this.times.push(now);
		return true;
	}
}

const budgets = new WeakMap<object, FlashBudget>();
/** The layer's budget (a Reduce flashing change swaps it for the other size). */
export function budgetOf(vfx: PlayContext['vfx']): FlashBudget {
	const max = vfx.reduceFlashing ? FLASH_BUDGET_SOFT : FLASH_BUDGET;
	let budget = budgets.get(vfx);
	if (!budget || budget.max !== max) budgets.set(vfx, (budget = new FlashBudget(max)));
	return budget;
}

/** The seam loops running on each layer: loop id to the cell it was laid at. */
const running = new WeakMap<object, Map<string, string>>();
/** How high above a crack its seam embers are born, and a thing's burst above the floor. */
const SEAM_LIFT = 0.05;
const LOW_LIFT = 0.1;
const MID_LIFT = 0.45;

/** Whether `e` is one of the finale's events. */
export const isFinale = (e: { kind: string }): e is FinaleEvent =>
	[
		'emerge',
		'sink',
		'rupture',
		'collapse',
		'shatter',
		'grasp',
		'heave',
		'ending',
		'seams'
	].includes(e.kind);

/** Plays one finale event. `props` are the viewer's, for a shattered prop's height. */
export function playFinale(e: FinaleEvent, ctx: PlayContext): void {
	const { grid, ground } = ctx;
	if (!grid || !ground) return;
	const at = (cell: GridPos, lift = 0): Origin => cellOrigin(grid, ground, cell, lift);
	const burst = (recipe: RecipeId, o: Origin, seed: number, delay = 0) =>
		ctx.vfx.burst(recipe, o, seed, ctx.now + delay);
	const low = ctx.vfx.tier === 'low';
	const budget = budgetOf(ctx.vfx);
	/** A bright burst, if the second's budget has room. */
	const bright = (recipe: RecipeId, o: Origin, seed: number, delay = 0) =>
		budget.take(ctx.now + delay) && (burst(recipe, o, seed, delay), true);
	/** The static ring a reduced-motion viewer gets for any of them. */
	const ring = (cell: GridPos, seed: number) => bright('ring', at(cell, MID_LIFT), seed);

	switch (e.kind) {
		case 'emerge':
			if (ctx.reduced) ring(e.at, e.seed);
			else {
				burst('dustpuff', at(e.at, LOW_LIFT), e.seed);
				burst('dustpuff', at(e.at, LOW_LIFT), e.seed + 1, 120);
				if (!low) burst('debris', at(e.at, LOW_LIFT), e.seed + 2);
				bright('shock', at(e.at, 0.03), e.seed + 3);
			}
			break;
		case 'sink':
			if (ctx.reduced) ring(e.at, e.seed);
			else {
				burst('dustpuff', at(e.at, LOW_LIFT), e.seed);
				burst('wisp', at(e.at, LOW_LIFT), e.seed + 1);
			}
			break;
		case 'rupture':
			if (ctx.reduced) ring(e.at, e.seed);
			else {
				burst('dustpuff', at(e.at, LOW_LIFT), e.seed);
				if (!low) burst('debris', at(e.at, SEAM_LIFT), e.seed + 1);
				bright('sparks', at(e.at, SEAM_LIFT), e.seed + 2);
			}
			ctx.decals.addTransient({
				atlasKey: 'scorch',
				cell: e.at,
				rotation: (e.seed % 628) / 100,
				seed: e.seed,
				until: ctx.now + 90_000
			});
			break;
		case 'collapse':
			if (ctx.reduced) break;
			burst('dustpuff', at(e.at, LOW_LIFT), e.seed);
			burst('dustpuff', at(e.at, LOW_LIFT), e.seed + 1, 100);
			if (!low) burst('debris', at(e.at, SEAM_LIFT), e.seed + 2);
			break;
		case 'shatter': {
			const prop = ctx.props?.find((p) => p.id === e.propId);
			const half = prop ? (hangOf(prop.assetId) ?? 1) * prop.scale * 0.5 * grid.cellSize : 0.5;
			const o = { ...at(e.at), y: at(e.at).y + half };
			if (ctx.reduced) ring(e.at, e.seed);
			else {
				burst('debris', o, e.seed);
				if (!low) burst('debris', o, e.seed + 1, 150);
				burst('dustpuff', at(e.at, LOW_LIFT), e.seed + 2);
				burst('tollDust', o, e.seed + 3);
				bright('shock', at(e.at, 0.03), e.seed + 4);
			}
			break;
		}
		case 'grasp': {
			if (ctx.reduced) break;
			const [a, b] = [at(e.from, MID_LIFT), at(e.to, MID_LIFT)];
			// The lunge: puffs of dust along the chord toward the target, then the grip.
			for (let i = 1; i <= 3; i++) {
				const t = i / 4;
				const o = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
				burst('dustpuff', o, e.seq + i, t * 160);
			}
			burst('dustpuff', at(e.to, LOW_LIFT), e.seq + 4, 200);
			if (!low) burst('debris', at(e.to, SEAM_LIFT), e.seq + 5, 200);
			bright('shock', at(e.to, 0.03), e.seq + 6, 200);
			break;
		}
		case 'heave':
			ctx.effects?.heave(ctx.now, ctx.reduced);
			break;
		case 'ending':
			if (ctx.reduced) {
				if (e.at) ring(e.at, e.seed);
			} else {
				if (e.at) {
					bright('tollRing', at(e.at, 0.04), e.seed);
					burst('tollDust', at(e.at, 2.5), e.seed + 1);
				} else if (ctx.focus)
					burst('tollDust', { x: ctx.focus.x, y: 2.5, z: ctx.focus.z }, e.seed + 1);
			}
			break;
		case 'seams': {
			const have = running.get(ctx.vfx) ?? new Map<string, string>();
			running.set(ctx.vfx, have);
			const want = new Map<string, GridPos>(e.of.map(([id, cell]) => [`seam:${id}`, cell]));
			for (const id of have.keys()) {
				if (want.has(id)) continue;
				ctx.vfx.unloop(id);
				have.delete(id);
			}
			for (const [id, cell] of want) {
				const where = `${cell.x},${cell.y}`;
				if (have.get(id) === where) continue;
				ctx.vfx.loop(id, 'seam', at(cell, SEAM_LIFT), hash(id));
				have.set(id, where);
			}
			break;
		}
	}
}

/**
 * The pulse loops of props whose model throbs while a light that is on stands in their footprint
 * (`pulsing`: the props, with their hints), hued by that light (`glowFrom`). `lights` are the
 * lights on, with their cell and `#rrggbb` colour. A prop with no light in it has none: the Heart
 * greys when its light goes out.
 */
export function pulseLoops(
	props: readonly Pick<Prop, 'id' | 'assetId' | 'pos' | 'rotation'>[],
	lights: readonly { pos: GridPos; color: string }[],
	hints: (assetId: string) => { idle?: string; glowFrom?: string } | undefined,
	origin: (cell: GridPos) => Origin
): Map<string, { recipe: RecipeId; origin: Origin; seed: number }> {
	const out = new Map<string, { recipe: RecipeId; origin: Origin; seed: number }>();
	for (const p of props) {
		const hint = hints(p.assetId);
		if (hint?.idle !== 'pulse') continue;
		const cells = footprintCells(p);
		const light = lights.find((l) => cells.some((c) => c.x === l.pos.x && c.y === l.pos.y));
		if (!light) continue;
		const tint = hint.glowFrom === 'light' ? light.color : undefined;
		const id = `pulse:${p.id}`;
		out.set(id, {
			recipe: 'heartPulse',
			origin: origin(cells[Math.floor(cells.length / 2)] ?? p.pos),
			seed: tintSeed(id, tint)
		});
	}
	return out;
}

/** A stable seed from an id. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}
