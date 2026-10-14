// Fire (#312), a part of the lazy `vfx` chunk: every fire the viewer can see burns as particle
// loops on the particle layer (vfx.ts), keyed by the light's id. The sources (`fireSources`, pure
// and server-tested) are exactly the GridLights' entries (grid-light-layer.ts) of lights that are
// on and burn: a torch, candle, brazier, lantern or fire, a fixture's, a prop's (the light seated
// on its flame, `flameSeats`) or a floor fire's, and a token's carried light at its hand, so a
// flame stands where its light does, and a remembered light last seen off, a light out of the
// viewer's view and a glow, magic, neon or panel light have none. The picture never shows fire the
// rules don't count. Each flame is a loop of teardrop cards (the `flame` recipes) whose seed
// carries its light's flicker profile and phase (`flameSeed`), so in the shader it breathes with
// the light (materials/vfx.ts + flicker.ts, the same waves as the GridLight's); open fires add an
// ember loop (8 on low, 12, 30 on high and up), braziers and floor fires smoke on medium and up.
// Nothing is rebuilt per frame: `update` runs with the lights, `follow` when a carrier's mini
// moves. Still under reduced motion (flames hold a fixed phase, no embers or smoke).

import type { SquareGrid } from '../game/grid';
import { lightLook, type LightKind } from '../game/lights';
import { isGlowId, type LightEntry } from './grid-lights';
import { BURNING } from './light-model';
import type { Lit } from './grid-light-layer';
import type { Tier } from './quality';
import type { RecipeId } from './vfx-recipes';
import { flameSeed } from './vfx-recipes';
import type { LoopSpec } from './vfx-state';

/** Those that throw embers (open flames) and those that smoke (a lot of fire). */
const OPEN: ReadonlySet<LightKind> = new Set<LightKind>(['torch', 'brazier', 'fire']);
const SMOKY: ReadonlySet<LightKind> = new Set<LightKind>(['brazier', 'fire']);

/** A flame to draw: where, what it burns as, and its light's flicker. */
export interface Fire {
	/** The light's id (a carried light's: its token's). */
	id: string;
	kind: LightKind;
	x: number;
	y: number;
	z: number;
	/** Its light's flicker profile and phase (light-model.ts): what the flame breathes with. */
	profile: number;
	phase: number;
	/** A token's light, at its hand: a smaller flame. */
	carried: boolean;
}

/**
 * The fires: for each GridLight entry (`entries`, from the source `sourceOf` gives, in `lit`) that
 * is on and burns. A kind with no fixture model (`fixture: false`) burns only as a floor fire,
 * seated on a prop's flame (`seats`: cell index to height) or carried: a bare light is a light only.
 */
export function fireSources(
	grid: SquareGrid,
	lit: readonly Lit[],
	entries: readonly LightEntry[],
	sourceOf: readonly number[],
	seats: ReadonlyMap<number, number>
): Fire[] {
	const fires: Fire[] = [];
	const seen = new Set<string>();
	entries.forEach((e, i) => {
		const { source, carrier } = lit[sourceOf[i]];
		if (isGlowId(e.id) || seen.has(e.id)) return;
		const look = lightLook(source);
		const seated = seats.has(source.pos.y * grid.width + source.pos.x);
		if (!BURNING.has(look.kind)) return;
		if (!(carrier || seated || look.fixture || look.kind === 'fire')) return;
		seen.add(e.id);
		const { x, y, z } = e.visual;
		fires.push({
			id: e.id,
			kind: look.kind,
			x,
			y,
			z,
			profile: e.profile,
			phase: e.phase,
			carried: !!carrier
		});
	});
	return fires;
}

/** A fire's loops: its flame, and embers and smoke by the tier (none while `still`). */
export function fireLoops(fire: Fire, tier: Tier, still: boolean): Map<string, LoopSpec> {
	const out = new Map<string, LoopSpec>();
	const at = { x: fire.x, y: fire.y, z: fire.z };
	const small = fire.carried || fire.kind === 'candle' || fire.kind === 'lantern';
	const add = (suffix: string, recipe: RecipeId, seed: number) =>
		out.set(`fire:${fire.id}:${suffix}`, { recipe, origin: at, seed });
	add('flame', small ? 'flameSmall' : 'flame', flameSeed(fire.profile, fire.phase));
	if (still) return out;
	const seed = Math.floor(fire.phase * 4096);
	if (OPEN.has(fire.kind))
		add('embers', tier === 'low' ? 'embersLow' : tier === 'medium' ? 'embers' : 'embersHigh', seed);
	if (SMOKY.has(fire.kind) && tier !== 'low') add('smoke', 'fireSmoke', seed);
	return out;
}

/** The part of the particle layer fires use (vfx.ts `VfxLayer`). */
export interface FireSink {
	tier: Tier;
	/** The heat haze over the fires (haze.ts, #326). */
	heat: { setFires(fires: readonly Fire[]): void };
	syncLoops(prefix: string, wanted: ReadonlyMap<string, LoopSpec>): void;
}

export class FireLayer {
	/** What the last `update` was given, so `follow` can place carried flames again. */
	private last: {
		grid: SquareGrid;
		lit: readonly Lit[];
		entries: readonly LightEntry[];
		sourceOf: readonly number[];
		seats: ReadonlyMap<number, number>;
		still: boolean;
	} | null = null;

	constructor(private readonly vfx: FireSink) {}

	/** The fires of this update's lights, as loops: whatever is not among them stops. */
	update(
		grid: SquareGrid,
		lit: readonly Lit[],
		entries: readonly LightEntry[],
		sourceOf: readonly number[],
		seats: ReadonlyMap<number, number>,
		still: boolean
	): void {
		this.last = { grid, lit, entries, sourceOf, seats, still };
		this.follow();
	}

	/** The same fires at the lights' entries now: a carried light's follows its gliding mini. */
	follow(): void {
		const l = this.last;
		if (!l) return;
		const wanted = new Map<string, LoopSpec>();
		const fires = fireSources(l.grid, l.lit, l.entries, l.sourceOf, l.seats);
		for (const fire of fires)
			for (const [id, spec] of fireLoops(fire, this.vfx.tier, l.still)) wanted.set(id, spec);
		this.vfx.heat.setFires(fires);
		this.vfx.syncLoops('fire:', wanted);
	}

	dispose(): void {
		this.vfx.syncLoops('fire:', new Map());
		this.vfx.heat.setFires([]);
	}
}
