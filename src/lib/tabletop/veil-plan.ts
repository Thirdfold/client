// What the air holds where (M75 #374 the fog-of-war cloud, #375 ground mist): pure and Node-tested
// (veil-plan.spec.ts), drawn by veil.ts as loops on the particle layer's soft pool.
//
// Every puff stands on one world-fixed lattice (`VEIL_STEP` cells apart, each point jittered by a
// hash of its lattice index alone), within the tier's reach of the camera's target, so the cloud's
// shape is never the layout of anything: only which lattice points carry a puff, and how high, come
// from the viewer's own masks. Three kinds, by the cell under the point:
//  - a fog bank (`fogBank`) over a cell the viewer never explored, within `NEAR` cells of one it did,
//    at head height over the explored cells' levels nearby (never a hidden cell's level); its
//    density in the shader is how hidden the ground is under each fragment (`bankDensity`), so it is
//    black on black over hidden ground and parts as cells are revealed (the reveal fade, FADE_MS);
//  - a low cloud (`fogLow`) over a cell explored but not in sight, thin and low (`lowDensity`);
//  - ground mist (`mist`) over explored cells, pooling by explored cells' levels (lower than the
//    ground round it, low on the table, water, a dark area; thinner under a roof), its step of
//    density carried in the seed above `HUE_SEEDS`, the world's amount (`mistAmount`) a uniform.
// Inputs are read only at cells the viewer knows (`known`, the explored mask, or null for all), so
// nothing about an unexplored cell can change the plan; the spec scrambles them to prove it.

import { worldToGrid, type SquareGrid } from '../game/grid';
import type { Ambient } from '../game/lights';
import type { WorldLook } from '../game/world';
import { hash01 } from './air-plan';
import { STEP_HEIGHT } from './ground';
import type { Tier } from './quality';
import { HUE_SEEDS } from './vfx-recipes';
import type { LoopSpec } from './vfx-state';

/** The lattice's spacing, in cells. */
export const VEIL_STEP = 1.5;
/** How far round the camera's target puffs stand, in cells, by tier: none on low. */
export const VEIL_REACH: Record<Tier, number> = { low: 0, medium: 10, high: 14, ultra: 18 };
/** A fog bank's point stands within this many cells (square) of an explored cell. */
export const NEAR = 2;
/** Heights over the floor, in cells: the bank at head height, the low cloud and the mist below a mini's knees. */
export const BANK_LIFT = 0.9;
export const LOW_LIFT = 0.25;
export const MIST_LIFT = 0.1;
/** The fog-of-war cloud's strength: a player's whole, the GM's faint. */
export const CLOUD_GAIN = { player: 1, gm: 0.35 } as const;
/** How thick the low cloud is over an explored cell out of sight, at its thickest. */
export const LOW_THICK = 0.5;
/** Mist density steps: a seed's index above `HUE_SEEDS`, 1 to 15 (0 lays no puff). */
export const MIST_STEPS = 15;

export interface VeilInput {
	grid: SquareGrid;
	/** The camera's target (world x, z). */
	target: { x: number; z: number };
	tier: Tier;
	/** Fog of war on: the cloud is laid; off, only mist. */
	fog: boolean;
	/** The cells seen now (the party's, for the GM); null for all. */
	visible: ArrayLike<number> | null;
	/** The cells explored (the party's, for the GM); null for all. */
	explored: ArrayLike<number> | null;
	/** The cells whose ground the viewer was sent: a player's explored mask, null for all (the GM). */
	known: ArrayLike<number> | null;
	/** Each cell's level, water (1: a water floor or a liquid sheet), a dark area, a roof: read only where `known`. */
	levels: ArrayLike<number> | null;
	water: ArrayLike<number> | null;
	darkness: ArrayLike<number> | null;
	interior: ArrayLike<number> | null;
	/** The world's mist, 0-1 (`mistAmount`): 0 lays none. */
	mist: number;
}

export interface VeilPlan {
	cloud: LoopSpec[];
	mist: LoopSpec[];
}

/** The lattice points within the tier's reach of the target, nearest first: world x, z and a seed. */
export function latticePoints(
	target: { x: number; z: number },
	reach: number,
	step: number
): { x: number; z: number; seed: number }[] {
	if (reach <= 0) return [];
	const [ci, cj, n] = [
		Math.round(target.x / step),
		Math.round(target.z / step),
		Math.ceil(reach / step) + 1
	];
	const out: { x: number; z: number; seed: number; d: number }[] = [];
	for (let j = cj - n; j <= cj + n; j++)
		for (let i = ci - n; i <= ci + n; i++) {
			const x = (i + 0.5 + (hash01(i, j, 1) - 0.5) * 0.6) * step;
			const z = (j + 0.5 + (hash01(i, j, 2) - 0.5) * 0.6) * step;
			const d = Math.hypot(x - target.x, z - target.z);
			if (d <= reach) out.push({ x, z, seed: Math.floor(hash01(i, j, 3) * HUE_SEEDS), d });
		}
	out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
	return out.map(({ x, z, seed }) => ({ x, z, seed }));
}

/** The fog-of-war cloud and the mist for what the viewer was sent. */
export function veilPlan(input: VeilInput): VeilPlan {
	const { grid, fog, visible, explored, known, levels, water, darkness, interior } = input;
	const cs = grid.cellSize;
	const plan: VeilPlan = { cloud: [], mist: [] };
	const points = latticePoints(input.target, VEIL_REACH[input.tier] * cs, VEIL_STEP * cs);
	if (!points.length || (!fog && input.mist <= 0)) return plan;
	const W = grid.width;
	const isKnown = (i: number) => !known || known[i] > 0;
	const level = (i: number) => (levels ? levels[i] : 0);
	const floorY = (l: number) => l * STEP_HEIGHT * cs;
	// The table's lowest and highest known ground: how low a cell lies on it.
	let [lo, hi] = [Infinity, -Infinity];
	for (let i = 0; i < W * grid.height; i++)
		if (isKnown(i)) [lo, hi] = [Math.min(lo, level(i)), Math.max(hi, level(i))];
	for (const p of points) {
		const cell = worldToGrid(grid, p);
		if (!cell) continue;
		const at = cell.y * W + cell.x;
		// The known ground round the point, and whether any of it was explored.
		let [sum, n, near] = [0, 0, false];
		for (let dy = -NEAR; dy <= NEAR; dy++)
			for (let dx = -NEAR; dx <= NEAR; dx++) {
				const [x, y] = [cell.x + dx, cell.y + dy];
				if (x < 0 || y < 0 || x >= W || y >= grid.height) continue;
				const i = y * W + x;
				if (isKnown(i)) [sum, n] = [sum + level(i), n + 1];
				if (!explored || explored[i] > 0) near = true;
			}
		const mean = n ? sum / n : 0;
		const origin = (y: number) => ({ x: p.x, y, z: p.z });
		if (fog && explored && !explored[at]) {
			if (near && n)
				plan.cloud.push({
					recipe: 'fogBank',
					origin: origin(floorY(mean) + BANK_LIFT * cs),
					seed: p.seed
				});
		} else if (fog && visible && !visible[at] && isKnown(at)) {
			plan.cloud.push({
				recipe: 'fogLow',
				origin: origin(floorY(level(at)) + LOW_LIFT * cs),
				seed: p.seed
			});
		}
		if (input.mist <= 0 || !isKnown(at)) continue;
		const own = level(at);
		const local = Math.min(1, Math.max(0, (mean - own) / 2));
		const low = hi > lo ? 1 - (own - lo) / (hi - lo) : 1;
		const wet = water && water[at] ? 0.3 : 0;
		const dark = darkness && darkness[at] ? 0.3 : 0;
		const roofed = interior && interior[at] && !dark ? 0.4 : 1;
		const density = Math.min(1, (0.25 + 0.35 * low + 0.4 * local + wet + dark) * roofed);
		const step = Math.round(density * MIST_STEPS);
		if (step > 0)
			plan.mist.push({
				recipe: 'mist',
				origin: origin(floorY(own) + MIST_LIFT * cs),
				seed: p.seed + step * HUE_SEEDS
			});
	}
	return plan;
}

/** 1 at `peak` minutes, falling to 0 `width` minutes either side (round midnight). */
const near = (t: number, peak: number, width: number) => {
	const d = Math.min(Math.abs(t - peak), 1440 - Math.abs(t - peak));
	return Math.max(0, 1 - d / width);
};

/**
 * The world's mist, 0-1, from its look: underground some always, more in the dark; under a sky,
 * mist at dawn and dusk and a little at night, none at noon; plus the haze and fog weather.
 */
export function mistAmount(world: WorldLook | null, band: Ambient): number {
	const haze = world?.haze.density ?? 0;
	const fog = world?.weather.kind === 'fog' ? world.weather.intensity : 0;
	const base =
		!world || !world.sun
			? band === 'dark'
				? 0.6
				: band === 'dusk'
					? 0.45
					: 0.3
			: 0.8 * Math.max(near(world.time, 360, 120), near(world.time, 1200, 120)) +
				(band === 'dark' ? 0.3 : 0);
	return Math.min(1, base + 0.6 * haze + 0.8 * fog);
}

/**
 * The fog bank's density at a fog factor (worldModify's: 1 seen, the explored level, the hidden
 * level), as the particle graph works it out (materials/vfx.ts `airDensity`): 1 over hidden
 * ground, 0 from the explored level up. For the GM the levels are the GM's.
 */
export function bankDensity(fog: number, explored: number, hidden: number): number {
	return Math.min(1, Math.max(0, (explored - fog) / (explored - hidden)));
}

/** The low cloud's: 0 hidden, `LOW_THICK` at the explored level, 0 in sight. */
export function lowDensity(fog: number, explored: number, hidden: number): number {
	const k = fog < explored ? (fog - hidden) / (explored - hidden) : (1 - fog) / (1 - explored);
	return LOW_THICK * Math.min(1, Math.max(0, k));
}
