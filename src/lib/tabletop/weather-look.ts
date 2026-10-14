// What weather looks like (#320, #321), pure and tested in Node: which kinds fall, how many drops a
// tier draws, each kind's look as numbers for the layer's uniforms (weather.ts), the shared phase
// that lines the storm up across clients, and how porous each floor is for wet ground. Nothing
// here reads the renderer; weather.ts and materials/cover.ts apply it.

import { FLOOR_IDS, type FloorId } from '../game/floor';
import type { Weather } from '../game/world';
import type { Tier } from './quality';

/** The kinds that put something in the air; `fog` only thickens the haze (atmosphere-curve.ts). */
export type Falling = Exclude<Weather, 'none' | 'fog'>;
export const FALLING: readonly Falling[] = ['rain', 'storm', 'snow', 'ash', 'dust'];

/** Whether weather shows at all: a falling kind with some intensity, under an open sky. */
export function weatherVisible(
	skyKind: string | null | undefined,
	weather: { kind: Weather; intensity: number }
): boolean {
	return (
		skyKind !== 'enclosed' && FALLING.includes(weather.kind as Falling) && weather.intensity > 0
	);
}

/** Drops at full intensity per tier; software GL and layer-off draw none. */
const DROPS: Record<Tier, number> = { low: 3000, medium: 8000, high: 20000, ultra: 20000 };
export const MAX_DROPS = DROPS.ultra;

/** One look per falling kind. Lengths in cells at a 32-cell box (they scale with the box). */
export interface WeatherLook {
	/** 0 a streak along its fall, 1 a flake facing the camera. */
	round: 0 | 1;
	length: number;
	width: number;
	/** Cells the wind pushes a drop sideways over its whole fall (times the environment's wind). */
	slant: number;
	/** Sideways sway in cells, and its cycles over one fall. */
	sway: number;
	swayCycles: number;
	/** Seconds the slowest drop takes to cross the box; a drop falls `mult` times that fast. */
	cycle: number;
	mult: readonly [number, number];
	/** The box's height as a share of the usual (dust hangs low). */
	height: number;
	colour: readonly [number, number, number];
	alpha: number;
	/** Seconds a rain drop's ring lives on the ground; 0 none. */
	splash: number;
	/** This kind's share of a tier's drops. */
	share: number;
}

export const LOOKS: Record<Falling, WeatherLook> = {
	rain: {
		round: 0,
		length: 1.1,
		width: 0.035,
		slant: 3,
		sway: 0,
		swayCycles: 0,
		cycle: 0.9,
		mult: [1, 0],
		height: 1,
		colour: [0.7, 0.78, 0.92],
		alpha: 0.3,
		splash: 0.18,
		share: 1
	},
	storm: {
		round: 0,
		length: 1.4,
		width: 0.04,
		slant: 8,
		sway: 0,
		swayCycles: 0,
		cycle: 0.7,
		mult: [1, 0],
		height: 1,
		colour: [0.66, 0.74, 0.9],
		alpha: 0.38,
		splash: 0.18,
		share: 1
	},
	snow: {
		round: 1,
		length: 0.09,
		width: 0.09,
		slant: 2,
		sway: 0.8,
		swayCycles: 3,
		cycle: 24,
		mult: [3, 2],
		height: 1,
		colour: [0.92, 0.95, 1],
		alpha: 0.85,
		splash: 0,
		share: 1
	},
	ash: {
		round: 1,
		length: 0.07,
		width: 0.07,
		slant: 3,
		sway: 1.2,
		swayCycles: 4,
		cycle: 36,
		mult: [3, 2],
		height: 1,
		colour: [0.5, 0.47, 0.45],
		alpha: 0.7,
		splash: 0,
		share: 0.6
	},
	dust: {
		round: 1,
		length: 0.05,
		width: 0.05,
		slant: 28,
		sway: 0.5,
		swayCycles: 5,
		cycle: 6,
		mult: [3, 2],
		height: 0.3,
		colour: [0.78, 0.66, 0.46],
		alpha: 0.35,
		splash: 0,
		share: 0.5
	}
};

/** Drops to draw: the tier's, by intensity and kind; none on software GL or for a quiet sky. */
export function dropCount(
	tier: Tier,
	intensity: number,
	kind: Weather = 'rain',
	software = false
): number {
	const look = Object.hasOwn(LOOKS, kind) ? LOOKS[kind as Falling] : null;
	if (software || !look || !(intensity > 0)) return 0;
	return Math.round(DROPS[tier] * look.share * Math.min(1, intensity));
}

/** The box that weather fills round the camera's target, in cells: wider the further out the camera is. */
export const BOX_CELLS = { min: 16, max: 64 } as const;
export const boxFor = (distanceCells: number): number =>
	Math.min(BOX_CELLS.max, Math.max(BOX_CELLS.min, distanceCells * 1.2));

/**
 * Where in its cycle the storm is: 0 to 1, from server time (ms), when the weather began
 * (`since`) and the look's cycle (s). The same on every client whose server clock agrees.
 */
export function phaseAt(serverMs: number, sinceMs: number, cycleSec: number): number {
	const x = (serverMs - sinceMs) / 1000 / cycleSec;
	return ((x % 1) + 1) % 1;
}

/** The weather's seed as three offsets in 0-1 (columns x and z, and the fall's phase). */
export function seedOffsets(seed: number): [number, number, number] {
	const f = (k: number) => {
		const x = (seed * k) % 1;
		return x < 0 ? x + 1 : x;
	};
	return [f(0.6180339887), f(0.7548776662), f(0.5698402909)];
}

/** How much of a surface's water soaks in, by floor (#321): grass drinks, stone sheds. */
export const POROSITY: Partial<Record<FloorId, number>> = {
	plain: 0.3,
	stone: 0.3,
	wood: 0.5,
	grass: 0.9,
	dirt: 0.8,
	sand: 0.7,
	water: 0,
	void: 0,
	lava: 0,
	cobble: 0.3,
	flagstone: 0.3,
	rock: 0.2,
	mud: 0.9,
	snow: 0.9,
	gravel: 0.6,
	tile: 0.15,
	grating: 0
};
export const OTHER_POROSITY = 0.3;

/** Porosity by `FLOOR_IDS` index, for a uniform array. */
export const porosityTable = (): number[] => FLOOR_IDS.map((id) => POROSITY[id] ?? OTHER_POROSITY);
