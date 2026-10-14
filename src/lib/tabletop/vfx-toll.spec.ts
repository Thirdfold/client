import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { groundFor } from './ground';
import { RECIPES } from './vfx-recipes';
import {
	playToll,
	tollSpawns,
	wallTops,
	WALL_POINTS,
	WALL_POINTS_LOW,
	WALL_REACH,
	type TollEvent,
	type TollWorld
} from './vfx-toll';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 40, height: 40 };
const levels = new Uint8Array(40 * 40);
levels[10 * 40 + 10] = 10; // a belfry
const wall = (id: string, ax: number, ay: number, bx: number, by: number): SceneObject => ({
	id,
	kind: 'wall',
	a: { x: ax, y: ay },
	b: { x: bx, y: by }
});
const bell: Prop = {
	id: 'bell',
	assetId: 'belfry-bell',
	pos: { x: 10, y: 10 },
	rotation: 0,
	scale: 1
};
const world: TollWorld = {
	grid,
	ground: groundFor(grid, levels),
	props: [bell],
	// Two long walls through the middle of the table, a window and a door that have no top.
	objects: [
		wall('n', 5, 20, 35, 20),
		wall('e', 20, 5, 20, 35),
		wall('n2', 0, 22, 40, 22),
		wall('e2', 22, 0, 22, 40),
		{ ...wall('w', 8, 8, 12, 8), window: true },
		{ id: 'd', kind: 'door', a: { x: 20, y: 20 }, b: { x: 21, y: 20 }, open: false }
	],
	focus: { x: 0, z: 0 },
	heightOf: (id) => (id === 'belfry-bell' ? 2.55 : null)
};
const toll: TollEvent = { kind: 'toll', at: { x: 10, y: 10 }, propId: 'bell', seq: 7 };
const normal = { low: false, soft: false };

describe('wallTops', () => {
	it('picks at most max points over the tops of the walls near the focus', () => {
		const tops = wallTops(world, 7, WALL_POINTS);
		expect(tops.length).toBe(WALL_POINTS);
		for (const t of tops) {
			expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(WALL_REACH + 1);
			expect(t.y).toBeCloseTo(2); // a wall's height over level 0
		}
		expect(wallTops(world, 7, WALL_POINTS_LOW).length).toBe(WALL_POINTS_LOW);
	});

	it('is the same for the same cue and another for the next', () => {
		const [a, b, c] = [wallTops(world, 7, 8), wallTops(world, 7, 8), wallTops(world, 8, 8)];
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
	});

	it('leaves out windows, doors and walls past its reach, and has none with no walls', () => {
		const far = { ...world, focus: { x: 1000, z: 1000 } };
		expect(wallTops(far, 1, 64)).toEqual([]);
		expect(wallTops({ ...world, objects: [] }, 1, 64)).toEqual([]);
		expect(wallTops({ ...world, objects: world.objects.slice(-2) }, 1, 64)).toEqual([]);
	});

	it('stands on the higher floor beside a wall', () => {
		const high = new Uint8Array(40 * 40).fill(5);
		const tops = wallTops({ ...world, ground: groundFor(grid, high) }, 1, 4);
		expect(tops[0].y).toBeCloseTo(2 + 5 * 0.4);
	});
});

describe('tollSpawns', () => {
	it('dusts, rings and sprays debris from the bell at its pivot, and dusts the wall tops', () => {
		const spawns = tollSpawns(toll, world, normal);
		expect(spawns.map((s) => s.recipe).slice(0, 3)).toEqual(['tollDust', 'tollRing', 'debris']);
		expect(spawns.filter((s) => s.recipe === 'wallDust').length).toBe(WALL_POINTS);
		const [dust, shock] = spawns;
		// The belfry is level 10 (4 up): the dust hangs 2.55 over it, the ring lies on it.
		expect(dust.origin.y).toBeCloseTo(4 + 2.55);
		expect(shock.origin.y).toBeCloseTo(4.04);
		expect(dust.origin.x).toBeCloseTo(-9.5);
		expect(RECIPES.tollRing.flat).toBe(1);
		expect(RECIPES.tollDust.lit).toBe(1);
	});

	it('scales the bell by its prop and puts a Keeper’s toll above its token', () => {
		const big = tollSpawns(toll, { ...world, props: [{ ...bell, scale: 2 }] }, normal)[0];
		expect(big.origin.y).toBeCloseTo(4 + 5.1);
		const keeper = tollSpawns(
			{ kind: 'toll', at: { x: 3, y: 3 }, propId: null, seq: 9 },
			world,
			normal
		)[0];
		expect(keeper.origin).toMatchObject({ y: 1.6 });
	});

	it('draws half the dust and no debris on the low tier', () => {
		const spawns = tollSpawns(toll, world, { low: true, soft: false });
		expect(spawns.map((s) => s.recipe)).not.toContain('debris');
		expect(spawns.filter((s) => s.recipe === 'wallDust').length).toBe(WALL_POINTS_LOW);
	});

	it('with no bell in view (at null) only dusts the walls', () => {
		const spawns = tollSpawns({ kind: 'toll', at: null, propId: null, seq: 1 }, world, normal);
		expect(new Set(spawns.map((s) => s.recipe))).toEqual(new Set(['wallDust']));
	});

	it('sends a flash wave from a source in view, a slower one under Reduce flashing, none otherwise', () => {
		const flash: TollEvent = { kind: 'flash', at: { x: 10, y: 10 }, seq: 3 };
		expect(tollSpawns(flash, world, normal).map((s) => s.recipe)).toEqual(['flashWave']);
		expect(tollSpawns(flash, world, { low: false, soft: true }).map((s) => s.recipe)).toEqual([
			'flashWaveSoft'
		]);
		expect(RECIPES.flashWaveSoft.lifetime).toBeGreaterThanOrEqual(0.5 * 4);
		expect(RECIPES.flashWaveSoft.from[3]).toBeLessThan(RECIPES.flashWave.from[3]);
		expect(tollSpawns({ kind: 'flash', at: null, seq: 3 }, world, normal)).toEqual([]);
	});
});

describe('playToll', () => {
	const layer = (reduced: boolean, tier = 'high') => {
		const bursts: string[] = [];
		return {
			bursts,
			vfx: {
				burst: (recipe: string) => void bursts.push(recipe),
				state: { reduced },
				tier,
				reduceFlashing: false
			}
		};
	};

	it('bursts the spawns, and nothing under reduced motion', () => {
		const { vfx, bursts } = layer(false);
		const { heightOf: _, ...rest } = world;
		void _;
		playToll(vfx, { kind: 'flash', at: { x: 10, y: 10 }, seq: 1 }, rest, 0);
		expect(bursts).toEqual(['flashWave']);
		const still = layer(true);
		playToll(still.vfx, toll, rest, 0);
		expect(still.bursts).toEqual([]);
	});
});
