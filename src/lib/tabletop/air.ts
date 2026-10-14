// The air layer (M75 #318, #319), in the lazy `vfx` chunk with the particle layer it drives: what
// the table puts in the air without anyone's action, all of it loops and bursts on VfxLayer.
//
//  - The environment's motes (#318): cavern motes, spores, dust, fireflies. The first kinds are
//    loops on a world-fixed lattice round the camera's target, the tier's count of them; fireflies
//    are loops over the grass cells the viewer knows, only at dusk and after dark. Nothing here
//    draws over a cell the viewer has not explored: the particle graph's fog term (worldModify)
//    blacks those, and `lit` motes show only where a light reaches.
//  - Effect props and model sockets (#319): a prop whose model declares `fx` sockets loops the
//    socket's recipe at its point, turned and scaled with the prop; chimneys on the roofs the viewer
//    has smoke the same way; a lightning prop glows steadily and strikes now and then (air-plan.ts
//    holds the schedule and its flash limit; Reduce flashing and reduced motion leave the glow).
//
// `set` takes the inputs from `relight` (it only notes them); `tick` runs just before the particle
// layer's own, so what it lays out draws in the same frame and no frame is asked for. Effect props
// are markers only the GM sees (`shown`): the models of the `effects` category are drawn for the
// GM alone, a player sees the effect.

import { manifestNow } from '$lib/assets/load';
import type { EnvironmentDef, Manifest } from '$lib/assets/manifest';
import { windParams } from '$lib/assets/wind';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';
import { ASSETS, type Prop } from '$lib/game/props';
import {
	FX_LOOP,
	MOTE_RECIPE,
	STRIKE_GAP_MS,
	boltPoints,
	fireflyLoops,
	idSeed,
	moteAnchors,
	socketLoops,
	strikeDue,
	tintSeed
} from './air-plan';
import { vfxUniforms } from './materials/vfx';
import type { QualitySettings, Tier } from './quality';
import type { VfxLayer } from './vfx';
import { RECIPES, WIND_REACH } from './vfx-recipes';
import type { LoopItem, Origin } from './vfx-state';
import type { GrassCells } from './world/grass-cells';
import type { WorldShape } from './world/shape';

/** What the layer needs of the roofs (roofs.ts `smoke`). */
export interface Chimneys {
	smoke(): { revision: number; sockets: Float32Array[] };
}

export interface AirInput {
	grid: SquareGrid;
	shape: WorldShape;
	props: readonly Prop[];
	environment: string | null;
	/** The rules' band; fireflies come out in the dusk and the dark. */
	band: Ambient;
	/** The grass the viewer knows (grass.ts `lawn`). */
	lawn: GrassCells | null;
}

/** Whether a prop is an effect marker, drawn for the GM alone. */
export const isMarker = (assetId: string): boolean => ASSETS[assetId]?.category === 'effects';

interface Striker {
	seed: number;
	base: Origin;
	/** The slot last struck. */
	done: number;
}

export class AirLayer {
	private input: AirInput | null = null;
	private manifest: Manifest | null = null;
	private tier: Tier = 'medium';
	private on = true;
	private stale = true;
	private chimneys = -1;
	private fxKey = '';
	private moteKey = '';
	private spot = '';
	private strikers: Striker[] = [];
	private lastStrike = -Infinity;

	constructor(
		private readonly vfx: VfxLayer,
		private readonly roofs: Chimneys
	) {}

	/** What the viewer was sent (called by `relight`): worked out again at the next `tick`. */
	set(input: AirInput): void {
		this.input = input;
		this.stale = true;
	}

	/** The tier's counts, and the `motes` layer switch (`?off=motes`). */
	setTier(settings: QualitySettings): void {
		this.tier = settings.tier;
		this.on = settings.layers.motes;
		this.stale = true;
	}

	/** `props` without the effect markers unless the viewer is the GM. */
	shown<T extends { assetId: string }>(props: readonly T[], gm: boolean): readonly T[] {
		return gm ? props : props.filter((p) => !isMarker(p.assetId));
	}

	/**
	 * Before the particle layer's tick: lays out what changed, sets the wind, plays the strikes due.
	 * `target` is the camera's pivot (world x, z).
	 */
	tick(now: number, target: { x: number; z: number }): void {
		const input = this.input;
		const manifest = manifestNow();
		if (manifest !== this.manifest) [this.manifest, this.stale] = [manifest, true];
		if (!input || !manifest) return;
		const env = input.environment ? manifest.environments[input.environment] : undefined;
		const reduced = this.vfx.state.reduced;
		this.blow(env, reduced);
		const chimneys = this.roofs.smoke();
		if (this.stale || chimneys.revision !== this.chimneys) {
			this.chimneys = chimneys.revision;
			this.effects(input, manifest, chimneys.sockets);
		}
		this.motes(input, env, target);
		this.stale = false;
		// Strikes flash: none under reduced motion or Reduce flashing (the glow stays).
		if (!reduced && vfxUniforms.flashCap.value > 1) this.strike(now, input.grid.cellSize);
	}

	/** The environment's wind carries the dust (the particle graph's `wind` uniform). */
	private blow(env: EnvironmentDef | undefined, reduced: boolean): void {
		const w = windParams(env, 1, reduced, false);
		const k = w.strength * WIND_REACH;
		vfxUniforms.wind.value.set(w.direction[0] * k, w.direction[1] * k);
	}

	/** Effect props' and sockets' loops, and the lightning props to strike. */
	private effects(input: AirInput, manifest: Manifest, chimneys: Float32Array[]): void {
		const { grid, shape, props } = input;
		const items: LoopItem[] = [];
		const strikers: Striker[] = [];
		const add = (recipe: keyof typeof RECIPES, origin: Origin, seed: number) =>
			items.push({ recipe, origin, seed }); // the layer's share: low halves them
		for (const p of props) {
			const sockets = manifest.models[p.assetId]?.fx;
			if (!sockets) continue;
			for (const { fx, origin } of socketLoops(p, sockets, grid, shape.ground)) {
				const recipe = FX_LOOP[fx];
				add(recipe, origin, recipe === 'magic-aura' ? tintSeed(p.id, p.tint) : idSeed(p.id));
				if (fx === 'lightning') strikers.push({ seed: idSeed(p.id), base: origin, done: -1 });
			}
		}
		// A chimney's smoke on a roof the viewer has: the sockets of the chunks drawn.
		for (const list of chimneys)
			for (let i = 0; i + 2 < list.length; i += 3)
				add(
					'smoke',
					{ x: list[i], y: list[i + 1], z: list[i + 2] },
					Math.round(list[i] * 31 + list[i + 2] * 17)
				);
		const key = items
			.map(
				(l) =>
					`${l.recipe}${l.seed}${l.origin.x.toFixed(2)},${l.origin.y.toFixed(2)},${l.origin.z.toFixed(2)}`
			)
			.join('|');
		if (key !== this.fxKey) {
			this.fxKey = key;
			this.vfx.group('fx:', items, false);
		}
		// Keep the slot a surviving striker last struck, so a relight does not strike it again.
		this.strikers = strikers.map((s) => ({
			...s,
			done: this.strikers.find((o) => o.seed === s.seed)?.done ?? -1
		}));
	}

	/** The environment's motes, laid out again when the camera's target moved two units or the inputs changed. */
	private motes(
		input: AirInput,
		env: EnvironmentDef | undefined,
		target: { x: number; z: number }
	): void {
		const kind = this.on ? env?.motes : undefined;
		const spot = `${Math.floor(target.x / 2)},${Math.floor(target.z / 2)}`;
		if (!this.stale && spot === this.spot) return;
		this.spot = spot;
		let items: LoopItem[] = [];
		if (kind === 'fireflies') {
			if (input.band !== 'day' && input.lawn)
				items = fireflyLoops(input.lawn.cells, this.tier, target, input.grid, input.shape.ground);
		} else if (kind) {
			items = moteAnchors(kind, this.tier, target, input.grid, input.shape.ground).map(
				(origin, i) => ({
					recipe: MOTE_RECIPE[kind],
					origin,
					seed: i
				})
			);
		}
		const key =
			items.map((l) => `${l.seed}${l.origin.x.toFixed(2)},${l.origin.z.toFixed(2)}`).join('|') +
			(kind ?? '');
		if (key === this.moteKey) return;
		this.moteKey = key;
		// Their tier's count is already in the loops: the layer's low-tier halving is not applied twice.
		this.vfx.group(
			'mote:',
			items.map((l) => ({ ...l, share: 1 })),
			false
		);
	}

	/**
	 * Lightning props' strikes due now: a bolt laid as a line of one-point bursts. None within
	 * `STRIKE_GAP_MS` of the last, whichever prop: at most 3 flashes a second.
	 */
	private strike(now: number, cell: number): void {
		for (const s of this.strikers) {
			const slot = strikeDue(s.seed, now);
			if (slot === null || slot === s.done || now - this.lastStrike < STRIKE_GAP_MS) continue;
			[s.done, this.lastStrike] = [slot, now];
			for (const p of boltPoints(s.seed, slot, s.base, cell))
				this.vfx.burst('strike', p, s.seed, now);
		}
	}
}
