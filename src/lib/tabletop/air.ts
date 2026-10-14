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
import { serverNow } from '$lib/net/server-now';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';
import type { Prop } from '$lib/game/props';
import {
	FX_LOOP,
	MOTE_RECIPE,
	boltPoints,
	fireflyLoops,
	idSeed,
	moteAnchors,
	posSeed,
	socketLoops,
	strikeAllowed,
	strikeDue,
	tintSeed
} from './air-plan';
import { vfxUniforms } from './materials/vfx';
import type { QualitySettings, Tier } from './quality';
import type { VfxLayer } from './vfx';
import { RECIPES, WIND_REACH } from './vfx-recipes';
import type { LoopSpec, Origin } from './vfx-state';
import type { GrassCells } from './world/grass-cells';
import type { WorldShape } from './world/shape';

/** Loops by id: `prefix` and their index, so a set that changes little rewrites little (syncLoops). */
const toMap = (prefix: string, items: LoopSpec[]) =>
	new Map(items.map((l, i) => [prefix + i, l] as const));

/** What the layer reads, handed by the renderer (the particle layer's constructor). */
export interface AirDeps {
	/** The roofs drawn (roofs.ts `smoke`). */
	roofs: { smoke(): { revision: number; sockets: Float32Array[] } };
	/** The camera's pivot, live. */
	target: { x: number; z: number };
	/** What the viewer was sent now; null before a table. */
	view(): AirView;
}

/**
 * What the viewer was sent, as the renderer holds it: the grid, the world's shape, the props, the
 * environment's id, the rules' band (fireflies come out in the dusk and the dark) and the grass the
 * viewer knows (grass.ts `lawn`).
 */
export type AirView = [
	SquareGrid | null,
	WorldShape | null | undefined,
	readonly Prop[],
	string | null,
	Ambient,
	GrassCells | null
];

interface AirInput {
	grid: SquareGrid;
	shape: WorldShape;
	props: readonly Prop[];
	environment: string | null;
	band: Ambient;
	lawn: GrassCells | null;
}

type Placed = AirInput;

interface Striker {
	seed: number;
	base: Origin;
	/** The slot last struck. */
	done: number;
}

export class AirLayer {
	private last: unknown[] = [];
	private tier: Tier = 'medium';
	private on = true;
	private stale = true;
	private chimneys = -1;
	private spot = '';
	private strikers: Striker[] = [];

	constructor(
		private readonly vfx: VfxLayer,
		private readonly deps: AirDeps
	) {}

	/** The tier's counts, and the `motes` layer switch (`?off=motes`). */
	setTier(settings: QualitySettings): void {
		this.tier = settings.tier;
		this.on = settings.layers.motes;
		this.stale = true;
	}

	/**
	 * Before the particle layer's own tick: lays out what changed (the viewer's table, the roofs, the
	 * camera's pivot moving two units), sets the wind, plays the strikes due.
	 */
	tick(now: number): void {
		const view = this.deps.view();
		const manifest = manifestNow();
		const seen = [manifest, ...view];
		if (seen.some((v, i) => v !== this.last[i])) [this.last, this.stale] = [seen, true];
		const [grid, shape, props, id, band, lawn] = view;
		if (!grid || !shape || !manifest) return;
		const input: Placed = { grid, shape, props, environment: id, band, lawn };
		const env = id ? manifest.environments[id] : undefined;
		const reduced = this.vfx.state.reduced;
		this.blow(env, reduced);
		const chimneys = this.deps.roofs.smoke();
		if (this.stale || chimneys.revision !== this.chimneys) {
			this.chimneys = chimneys.revision;
			this.effects(input, manifest, chimneys.sockets);
		}
		this.motes(input, env, this.deps.target);
		this.stale = false;
		// Strikes flash: none under reduced motion or Reduce flashing (the glow stays).
		if (!reduced && vfxUniforms.flashCap.value > 1) this.strike(now, grid.cellSize);
	}

	/** The environment's wind carries the dust (the particle graph's `wind` uniform). */
	private blow(env: EnvironmentDef | undefined, reduced: boolean): void {
		const w = windParams(env, 1, reduced, false);
		const k = w.strength * WIND_REACH;
		vfxUniforms.wind.value.set(w.direction[0] * k, w.direction[1] * k);
	}

	/** Effect props' and sockets' loops, and the lightning props to strike. */
	private effects(input: Placed, manifest: Manifest, chimneys: Float32Array[]): void {
		const { grid, shape, props } = input;
		const items: LoopSpec[] = [];
		const strikers: Striker[] = [];
		const add = (recipe: keyof typeof RECIPES, origin: Origin, seed: number) =>
			items.push({ recipe, origin, seed }); // the layer's share: low halves them
		for (const p of props) {
			const sockets = manifest.models[p.assetId]?.fx;
			if (!sockets) continue;
			for (const { fx, origin } of socketLoops(p, sockets, grid, shape.ground)) {
				const recipe = FX_LOOP[fx];
				if (!recipe) continue; // a recipe this build does not know
				add(recipe, origin, recipe === 'magic-aura' ? tintSeed(p.id, p.tint) : idSeed(p.id));
				if (fx === 'lightning') strikers.push({ seed: posSeed(p.pos), base: origin, done: -1 });
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
		this.vfx.syncLoops('fx:', toMap('fx:', items));
		// Keep the slot a surviving striker last struck, so a relight does not strike it again.
		this.strikers = strikers.map((s) => ({
			...s,
			done: this.strikers.find((o) => o.seed === s.seed)?.done ?? -1
		}));
	}

	/** The environment's motes, laid out again when the camera's target moved two units or the inputs changed. */
	private motes(
		input: Placed,
		env: EnvironmentDef | undefined,
		target: { x: number; z: number }
	): void {
		const kind = this.on && env?.motes && env.motes in MOTE_RECIPE ? env.motes : undefined;
		const spot = `${Math.floor(target.x / 2)},${Math.floor(target.z / 2)}`;
		if (!this.stale && spot === this.spot) return;
		this.spot = spot;
		let items: LoopSpec[] = [];
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
		this.vfx.syncLoops('mote:', toMap('mote:', items));
	}

	/**
	 * Lightning props' strikes due now on the server's clock: a bolt laid as a line of one-point
	 * bursts (on the renderer's clock `now`). Which may strike is air-plan.ts `strikeAllowed`: with
	 * the weather's lightning, at most 3 flashes a second, the same on every client.
	 */
	private strike(now: number, cell: number): void {
		const wall = serverNow();
		const seeds = this.strikers.map((s) => s.seed);
		const weather = this.vfx.sky.strikingWeather();
		for (const s of this.strikers) {
			const slot = strikeDue(s.seed, wall);
			if (slot === null || slot === s.done || !strikeAllowed(s.seed, slot, seeds, weather))
				continue;
			s.done = slot;
			for (const p of boltPoints(s.seed, slot, s.base, cell))
				this.vfx.burst('strike', p, s.seed, now);
		}
	}
}
