// The bell toll and the flash on the particle layer (#317), a part of the lazy `vfx` chunk. The
// cue path (effects.ts, `playCue`) still swings the bell, shudders the camera, slides the blot
// under the floor and runs the flash's envelope (exposure, bloom, sky); this adds what has a place,
// from the `toll` and `flash` events of vfx-cues.ts (`playToll` below, called by `playVfx` for
// those two kinds, once each, so the cue and the events never fire the same effect twice):
//
// - toll: lit dust from the bell (at its manifest `swing.pivot`, else the top of its bounds; above
//   the token for a Keeper's toll), a shockwave ring on the floor under it, a burst of debris, and
//   dust sifting from the tops of the walls near the camera's focus (at most `WALL_POINTS`, picked
//   by the cue's `seq`, so the same cue always dusts the same walls),
// - flash: a front sweeping over the floor from its source (`flashWave`, or the slower and fainter
//   `flashWaveSoft` under Reduce flashing). A source the viewer was not sent has no event position
//   (`at` null): no wave, the global flash alone.
//
// Every position is a prop, token or wall the viewer was sent, or the cell they last stood on.
// Reduced motion keeps only the cue path's swing and flash: nothing here plays. All of it is
// bursts of the particle layer, drawn in the two pools, so a toll adds no draws and no programs.

import {
	cornerToWorld,
	gridToWorld,
	type GridEdge,
	type GridPos,
	type SquareGrid
} from '../game/grid';
import type { SceneObject } from '../game/objects';
import { footprintCells, type Prop } from '../game/props';
import type { Ground } from './ground';
import { WALL_HEIGHT } from './ground';
import { modelNow } from './models';
import type { VfxEvent } from './vfx-cues';
import type { RecipeId } from './vfx-recipes';
import type { Origin } from './vfx-state';
import { keyHash } from './world/hash';

export type TollEvent = Extract<VfxEvent, { kind: 'toll' | 'flash' }>;

/** Wall tops that sift dust per toll, and on the low tier. */
export const WALL_POINTS = 64;
export const WALL_POINTS_LOW = 16;
/** Wall tops further than this from the camera's focus (cells) are left alone. */
export const WALL_REACH = 14;
/** A token's head, in cells over its floor: where a Keeper's toll starts. */
const HEAD = 1.6;
/** Rings and waves lie this far over the floor (cells), clear of it. */
const FLOOR_LIFT = 0.04;

/** What a toll is worked out from: the table as this viewer was sent it. */
export interface TollWorld {
	grid: SquareGrid;
	ground: Ground | null;
	props: readonly Prop[];
	objects: readonly SceneObject[];
	/** The camera's focus (world x and z). */
	focus: { x: number; z: number };
	/** How high a bell model hangs, in cells over its prop's floor (its swing pivot, else its top). */
	heightOf(assetId: string): number | null;
}

export interface Spawn {
	recipe: RecipeId;
	origin: Origin;
	seed: number;
}

/** How high a model hangs: its swing pivot, else the top of its bounds (the great bell has no pivot). */
export function hangOf(assetId: string): number | null {
	const entry = modelNow(assetId)?.entry;
	return entry ? (entry.swing?.pivot ?? entry.bounds.max[1]) : null;
}

/** Every unit edge of every wall (windows have no top to dust), with the ground beside it. */
function wallEdges(objects: readonly SceneObject[]): GridEdge[] {
	const edges: GridEdge[] = [];
	for (const o of objects) {
		if (o.kind !== 'wall' || o.window) continue;
		const [dx, dy] = [Math.sign(o.b.x - o.a.x), Math.sign(o.b.y - o.a.y)];
		const n = Math.abs(o.b.x - o.a.x) + Math.abs(o.b.y - o.a.y);
		for (let i = 0; i < n; i++)
			edges.push({
				a: { x: o.a.x + dx * i, y: o.a.y + dy * i },
				b: { x: o.a.x + dx * (i + 1), y: o.a.y + dy * (i + 1) }
			});
	}
	return edges;
}

/**
 * Up to `max` points over the tops of the walls within `WALL_REACH` cells of the focus, the
 * nearest few hundred ordered by a hash of the cue's `seq` and the edge, so one cue always picks
 * the same ones and the next picks others. Not through the void: only walls the viewer was sent.
 */
export function wallTops(w: TollWorld, seq: number, max: number): Origin[] {
	const { grid, ground, focus } = w;
	const reach = WALL_REACH * grid.cellSize;
	const found: { at: Origin; order: number }[] = [];
	for (const e of wallEdges(w.objects)) {
		const [p, q] = [cornerToWorld(grid, e.a), cornerToWorld(grid, e.b)];
		const [x, z] = [(p.x + q.x) / 2, (p.z + q.z) / 2];
		if (Math.hypot(x - focus.x, z - focus.z) > reach) continue;
		const base = ground ? ground.edgeFloors(e).high : 0;
		found.push({
			at: { x, y: base + WALL_HEIGHT * grid.cellSize, z },
			order: keyHash(`${seq}:${e.a.x},${e.a.y}:${e.b.x},${e.b.y}`)
		});
	}
	return found
		.sort((a, b) => a.order - b.order)
		.slice(0, max)
		.map((f) => f.at);
}

/** The middle of a cell's floor (or a footprint's), `lift` cells up. */
function floorAt(w: TollWorld, at: GridPos, cells: readonly GridPos[] = [at], lift = 0): Origin {
	const centres = cells.map((c) => gridToWorld(w.grid, c));
	const mean = (axis: 'x' | 'z') => centres.reduce((sum, c) => sum + c[axis], 0) / centres.length;
	return { x: mean('x'), y: (w.ground?.floorY(at) ?? 0) + lift * w.grid.cellSize, z: mean('z') };
}

/** Where the bell hangs for a toll event: its prop among the viewer's, else above the token. */
function bellOrigin(ev: Extract<TollEvent, { kind: 'toll' }>, w: TollWorld): Origin | null {
	if (!ev.at) return null;
	const prop = ev.propId ? w.props.find((p) => p.id === ev.propId) : undefined;
	const hang = prop ? w.heightOf(prop.assetId) : null;
	if (!prop || hang === null) return floorAt(w, ev.at, [ev.at], HEAD);
	return floorAt(w, prop.pos, footprintCells(prop), hang * prop.scale);
}

/**
 * What an event spawns, in order. `low`: the low tier, a quarter of the wall points; `soft`:
 * Reduce flashing, which swaps the flash's wave for a slow, faint one.
 */
export function tollSpawns(
	ev: TollEvent,
	w: TollWorld,
	{ low, soft }: { low: boolean; soft: boolean }
): Spawn[] {
	const seed = ev.seq * 31;
	if (ev.kind === 'flash')
		return ev.at
			? [
					{
						recipe: soft ? 'flashWaveSoft' : 'flashWave',
						origin: floorAt(w, ev.at, [ev.at], FLOOR_LIFT),
						seed
					}
				]
			: [];
	const out: Spawn[] = [];
	const bell = bellOrigin(ev, w);
	if (bell && ev.at) {
		out.push({ recipe: 'tollDust', origin: bell, seed });
		out.push({ recipe: 'tollRing', origin: floorAt(w, ev.at, [ev.at], FLOOR_LIFT), seed: seed + 1 });
		if (!low) out.push({ recipe: 'debris', origin: bell, seed: seed + 2 });
	}
	wallTops(w, ev.seq, low ? WALL_POINTS_LOW : WALL_POINTS).forEach((origin, i) =>
		out.push({ recipe: 'wallDust', origin, seed: seed + 3 + i })
	);
	return out;
}

/**
 * Plays a `toll` or `flash` event on the particle layer at `now` (ms, the renderer's clock):
 * nothing under reduced motion. `vfx` is the layer (vfx.ts), `world` the table as the viewer has it.
 */
export function playToll(
	vfx: {
		burst(recipe: string, origin: Origin, seed: number, t0: number): void;
		state: { reduced: boolean };
		tier: string;
		reduceFlashing: boolean;
	},
	ev: TollEvent,
	world: Omit<TollWorld, 'heightOf'>,
	now: number
): void {
	if (vfx.state.reduced) return;
	const spawns = tollSpawns(
		ev,
		{ ...world, heightOf: hangOf },
		{ low: vfx.tier === 'low', soft: vfx.reduceFlashing }
	);
	for (const s of spawns) vfx.burst(s.recipe, s.origin, s.seed, now);
}
