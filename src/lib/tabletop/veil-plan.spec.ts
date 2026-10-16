// The air's plan (#374, #375): a world-fixed lattice, the fog of war's cloud only where the viewer's
// own masks put it, mist pooling by explored levels, and nothing about an unexplored cell able to
// change any of it.

import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { DEFAULT_WORLD } from '../game/world';
import { FOG_LEVELS } from './cell-maps';
import { STEP_HEIGHT } from './ground';
import {
	BANK_LIFT,
	CLOUD_GAIN,
	LOW_THICK,
	MIST_LIFT,
	MIST_STEPS,
	VEIL_REACH,
	VEIL_STEP,
	bankDensity,
	latticePoints,
	lowDensity,
	mistAmount,
	veilPlan,
	type VeilInput
} from './veil-plan';
import { HUE_SEEDS, RECIPES } from './vfx-recipes';
import { worldToGrid } from '../game/grid';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 16 };
const size = grid.width * grid.height;
/** The left half explored, a strip of it in sight; levels rising to the right. */
const explored = new Uint8Array(size).map((_, i) => (i % grid.width < 12 ? 1 : 0));
const visible = new Uint8Array(size).map((_, i) =>
	i % grid.width >= 6 && i % grid.width < 12 ? 1 : 0
);
const levels = new Uint8Array(size).map((_, i) => Math.floor((i % grid.width) / 4));
const base = (over: Partial<VeilInput> = {}): VeilInput => ({
	grid,
	target: { x: 0, z: 0 },
	tier: 'high',
	fog: true,
	visible,
	explored,
	known: explored,
	levels,
	water: null,
	darkness: null,
	interior: null,
	mist: 0.5,
	...over
});
const cellOf = (o: { x: number; z: number }) => worldToGrid(grid, o)!;
const at = (o: { x: number; z: number }) => cellOf(o).y * grid.width + cellOf(o).x;

describe('the lattice', () => {
	it('is fixed in the world: a moved target keeps the points both reach, and puts none beyond its reach', () => {
		const a = latticePoints({ x: 0, z: 0 }, 10, VEIL_STEP);
		const b = latticePoints({ x: 3, z: 0 }, 10, VEIL_STEP);
		const key = (p: { x: number; z: number }) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`;
		const inB = new Map(b.map((p) => [key(p), p.seed]));
		const shared = a.filter((p) => inB.has(key(p)));
		expect(shared.length).toBeGreaterThan(a.length / 2);
		for (const p of shared) expect(inB.get(key(p))).toBe(p.seed);
		for (const p of b) expect(Math.hypot(p.x - 3, p.z)).toBeLessThanOrEqual(10);
		expect(a.every((p) => p.seed >= 0 && p.seed < HUE_SEEDS)).toBe(true);
	});

	it('lays nothing on low', () => {
		expect(VEIL_REACH.low).toBe(0);
		expect(veilPlan(base({ tier: 'low' }))).toEqual({ cloud: [], mist: [] });
	});
});

describe('the fog-of-war cloud', () => {
	const { cloud } = veilPlan(base({ mist: 0 }));

	it('banks over unexplored ground next to explored ground, at head height over explored levels', () => {
		const banks = cloud.filter((l) => l.recipe === 'fogBank');
		expect(banks.length).toBeGreaterThan(0);
		for (const b of banks) {
			const c = cellOf(b.origin);
			expect(explored[at(b.origin)], 'over unexplored ground').toBe(0);
			expect(c.x, 'within reach of explored ground').toBeLessThan(12 + 2);
			// The explored levels round it (levels 2, the x 8-11 band) and none of the hidden ones.
			expect(b.origin.y).toBeCloseTo(2 * STEP_HEIGHT + BANK_LIFT);
		}
	});

	it('lies low over explored ground out of sight, and not at all over ground in sight', () => {
		const low = cloud.filter((l) => l.recipe === 'fogLow');
		expect(low.length).toBeGreaterThan(0);
		for (const l of low) {
			expect(explored[at(l.origin)]).toBe(1);
			expect(visible[at(l.origin)]).toBe(0);
		}
		expect(cloud.every((l) => !visible[at(l.origin)])).toBe(true);
	});

	it('is gone with fog off', () => {
		expect(veilPlan(base({ fog: false, mist: 0 })).cloud).toEqual([]);
	});

	it('density mirrors the graph: a bank 1 hidden and 0 from explored up, the low cloud thin', () => {
		for (const mode of ['player', 'gm'] as const) {
			const { explored: e, hidden: h } = FOG_LEVELS[mode];
			expect(bankDensity(h, e, h)).toBe(1);
			expect(bankDensity(e, e, h)).toBe(0);
			expect(bankDensity(1, e, h)).toBe(0);
			expect(lowDensity(h, e, h)).toBe(0);
			expect(lowDensity(e, e, h)).toBeCloseTo(LOW_THICK);
			expect(lowDensity(1, e, h)).toBe(0);
		}
		expect(CLOUD_GAIN.gm).toBeLessThan(CLOUD_GAIN.player); // the GM sees it faintly
	});
});

describe('ground mist', () => {
	it('stands only over explored cells, just above their floor, a density step in its seed', () => {
		const { mist } = veilPlan(base());
		expect(mist.length).toBeGreaterThan(0);
		for (const m of mist) {
			expect(explored[at(m.origin)]).toBe(1);
			expect(m.origin.y).toBeCloseTo(levels[at(m.origin)] * STEP_HEIGHT + MIST_LIFT);
			const step = Math.floor(m.seed / HUE_SEEDS);
			expect(step).toBeGreaterThan(0);
			expect(step).toBeLessThanOrEqual(MIST_STEPS);
			expect(m.recipe).toBe('mist');
		}
		expect(veilPlan(base({ mist: 0 })).mist).toEqual([]);
	});

	it('pools in low ground and over water, thinner on raised cells and under roofs', () => {
		const stepAt = (plan: ReturnType<typeof veilPlan>, x: number) =>
			plan.mist.filter((m) => cellOf(m.origin).x === x).map((m) => Math.floor(m.seed / HUE_SEEDS));
		const plan = veilPlan(base());
		const [low, high] = [Math.min(...stepAt(plan, 1)), Math.max(...stepAt(plan, 10))];
		expect(low).toBeGreaterThan(high);
		const wet = veilPlan(base({ water: new Uint8Array(size).fill(1) }));
		expect(Math.min(...stepAt(wet, 10))).toBeGreaterThan(high);
		const roofed = veilPlan(base({ interior: new Uint8Array(size).fill(1) }));
		expect(Math.max(...stepAt(roofed, 1))).toBeLessThan(low);
	});

	it('comes with dusk, dawn, the dark, haze and fog weather, and is clear at noon', () => {
		const amount = (time: number, over: Partial<typeof DEFAULT_WORLD> = {}) =>
			mistAmount({ ...DEFAULT_WORLD, time, ...over }, time > 1260 || time < 300 ? 'dark' : 'day');
		expect(amount(780)).toBe(0);
		expect(amount(1200)).toBeGreaterThan(0.5);
		expect(amount(360)).toBeGreaterThan(0.5);
		expect(amount(0)).toBeGreaterThan(0);
		expect(amount(780, { haze: { density: 1, color: null } })).toBeGreaterThan(0.5);
		const fog = { kind: 'fog' as const, intensity: 1, seed: 0, since: 0 };
		expect(amount(780, { weather: fog })).toBeGreaterThan(0.5);
		const under = { ...DEFAULT_WORLD, sun: false };
		expect(mistAmount(under, 'dark')).toBeGreaterThan(mistAmount(under, 'day'));
		expect(mistAmount(null, 'day')).toBeGreaterThan(0);
	});
});

describe('secrecy', () => {
	/** Every input about an unexplored cell scrambled: its level, water, dark area, roof. */
	const scrambled = (seed: number): Partial<VeilInput> => {
		let s = seed;
		const r = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
		const mix = (a: ArrayLike<number> | null, top: number) =>
			Uint8Array.from({ length: size }, (_, i) =>
				explored[i] ? (a ? a[i] : 0) : Math.floor(r() * top)
			);
		return {
			levels: mix(levels, 16),
			water: mix(null, 2),
			darkness: mix(null, 2),
			interior: mix(null, 2)
		};
	};

	it('a hidden cell’s content cannot change the plan, for any tier, target or mist', () => {
		for (const tier of ['medium', 'high', 'ultra'] as const)
			for (const target of [
				{ x: 0, z: 0 },
				{ x: 7, z: -3 },
				{ x: -9, z: 5 }
			])
				for (const mist of [0, 0.4, 1]) {
					const plain = veilPlan(base({ tier, target, mist }));
					for (const seed of [1, 2, 3])
						expect(veilPlan(base({ tier, target, mist, ...scrambled(seed) }))).toEqual(plain);
				}
	});

	it('every recipe it names fades by the cell maps in the shader', () => {
		for (const id of ['fogBank', 'fogLow', 'mist', 'halo', 'haloSmall'] as const)
			expect(RECIPES[id].air, id).toBeGreaterThan(0);
	});
});
