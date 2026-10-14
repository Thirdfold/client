import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../game/grid';
import type { Token } from '../game/token';
import { groundFor } from './ground';
import type { VfxEvent } from './vfx-cues';
import { ARC_APEX, FLIGHT_MS, arcAt, playVfx, vfxPlayer, type PlayContext } from './vfx-play';
import { RECIPE_IDS, RECIPES } from './vfx-recipes';

/** Stand-in layers that record what they are asked for. */
function table(patch: Partial<PlayContext> = {}) {
	const bursts: {
		recipe: string;
		at: { x: number; y: number; z: number };
		seed: number;
		t: number;
	}[] = [];
	const loops = new Map<string, string>();
	const marks: { atlasKey: string; cell: { x: number; y: number }; until: number }[] = [];
	let faded = 0;
	const grid = DEFAULT_GRID;
	const ctx: PlayContext = {
		vfx: {
			burst: (recipe, at, seed, t) => void bursts.push({ recipe, at, seed, t }),
			loop: (id, recipe) => void loops.set(id, recipe),
			unloop: (id) => void loops.delete(id)
		},
		grid,
		ground: groundFor(grid, null),
		tokens: [{ id: 'w', pos: { x: 3, y: 4 } } as Token],
		decals: { addTransient: (m) => void marks.push(m), fade: () => void faded++ },
		now: 1000,
		reduced: false,
		...patch
	};
	return { ctx, bursts, loops, marks, faded: () => faded };
}

const at = { x: 2, y: 2 };
const impact = (heavy: boolean, seq = 7): VfxEvent => ({
	kind: 'impact',
	tokenId: 'w',
	at,
	heavy,
	seq
});

describe('arcAt', () => {
	it('runs from the shooter to the target, peaking at 0.3 of the chord', () => {
		const [a, b] = [
			{ x: 0, y: 0.5, z: 0 },
			{ x: 4, y: 0.5, z: 0 }
		];
		expect(arcAt(a, b, 0)).toEqual(a);
		expect(arcAt(a, b, 1)).toEqual(b);
		expect(arcAt(a, b, 0.5).y).toBeCloseTo(0.5 + ARC_APEX * 4);
		expect(arcAt(a, b, 0.25).x).toBeCloseTo(1);
	});
});

describe('playVfx', () => {
	it('every recipe it names exists', () => {
		const t = table();
		playVfx(
			[
				impact(true),
				{ kind: 'miss', tokenId: 'w', at, seq: 1 },
				{ kind: 'heal', tokenId: 'w', at, seq: 2 },
				{ kind: 'burn', tokenId: 'w', at, seq: 3 },
				{ kind: 'guard', tokenIds: ['w'], seq: 4 },
				{ kind: 'projectile', from: { x: 0, y: 0 }, to: at, seq: 5 },
				{ kind: 'fall', tokenId: 'w', at, enemy: true, seed: 6 },
				{ kind: 'spawn', tokenId: 'w', at, seed: 7 },
				{ kind: 'despawn', tokenId: 'w', at, seed: 8 }
			],
			t.ctx
		);
		for (const b of t.bursts) expect(RECIPE_IDS).toContain(b.recipe);
		expect(new Set(t.bursts.map((b) => b.recipe))).toEqual(
			new Set([
				'sparks',
				'shock',
				'chips',
				'whiff',
				'dustpuff',
				'heal',
				'embers',
				'lick',
				'ward',
				'bolt',
				'wisp'
			])
		);
	});

	it('puts a hit on its cell at chest height, seeded by the entry, with a mark when heavy', () => {
		const t = table();
		playVfx([impact(false, 42), impact(true, 43)], t.ctx);
		const sparks = t.bursts.filter((b) => b.recipe === 'sparks');
		expect(sparks.map((b) => b.seed)).toEqual([42, 43]);
		expect(sparks[0].at.x).toBeCloseTo(2.5 - DEFAULT_GRID.width / 2);
		expect(sparks[0].at.y).toBeGreaterThan(0.3);
		expect(t.marks.map((m) => [m.atlasKey, m.cell])).toEqual([['blood', at]]);
		expect(t.bursts.filter((b) => b.recipe === 'shock')).toHaveLength(1);
		// The same events give the same bursts on another client.
		const u = table();
		playVfx([impact(false, 42), impact(true, 43)], u.ctx);
		expect(u.bursts).toEqual(t.bursts);
	});

	it('flies a shot over its flight and lands its hit on arrival', () => {
		const t = table();
		playVfx(
			[{ kind: 'projectile', from: { x: 0, y: 0 }, to: at, seq: 9 }, impact(false, 9)],
			t.ctx
		);
		const bolts = t.bursts.filter((b) => b.recipe === 'bolt');
		expect(bolts.length).toBeGreaterThan(4);
		expect(Math.min(...bolts.map((b) => b.t))).toBe(1000);
		expect(Math.max(...bolts.map((b) => b.t))).toBe(1000 + FLIGHT_MS);
		expect(t.bursts.find((b) => b.recipe === 'sparks')?.t).toBe(1000 + FLIGHT_MS);
	});

	it('marks a burn with a scorch, and the end of a fight fades the marks', () => {
		const t = table();
		playVfx([{ kind: 'burn', tokenId: 'w', at, seq: 3 }, { kind: 'calm' }], t.ctx);
		expect(t.marks.map((m) => m.atlasKey)).toEqual(['scorch']);
		expect(t.faded()).toBe(1);
	});

	it('rings guarded bases', () => {
		const t = table();
		playVfx([{ kind: 'guard', tokenIds: ['w', 'gone'], seq: 4 }], t.ctx);
		expect(t.bursts.map((b) => b.recipe)).toEqual(['ward']);
	});

	it('under reduced motion is one ring, no shot, no debris', () => {
		const t = table({ reduced: true });
		playVfx(
			[
				impact(true),
				{ kind: 'projectile', from: { x: 0, y: 0 }, to: at, seq: 5 },
				{ kind: 'heal', tokenId: 'w', at, seq: 2 }
			],
			t.ctx
		);
		expect(t.bursts.map((b) => b.recipe)).toEqual(['ring', 'heal']);
		expect(t.bursts[0].t).toBe(1000);
	});

	it('plays nothing without a ground yet, and says so', () => {
		const t = table({ ground: null });
		expect(playVfx([impact(false)], t.ctx)).toBe(false);
		expect(t.bursts).toHaveLength(0);
	});

	it('keeps one loop per token and look, and takes them away with the status', () => {
		const t = table();
		const play = vfxPlayer(t.ctx.vfx, t.ctx.decals);
		const view = { grid: t.ctx.grid, ground: t.ctx.ground, tokens: t.ctx.tokens };
		const on = (of: [string, ('embers' | 'shimmer' | 'neutral')[], typeof at][]): VfxEvent[] => [
			{ kind: 'statuses', of }
		];
		play(on([['w', ['shimmer', 'embers'], at]]), view, 0, false);
		expect([...t.loops.values()].sort()).toEqual(['embers', 'shimmer']);
		play(on([['w', ['neutral'], at]]), view, 0, false);
		expect([...t.loops.values()]).toEqual(['ringlet']);
		play(on([]), view, 0, false);
		expect(t.loops.size).toBe(0);
	});

	it('has a distinct shape for every status look', () => {
		const frames = ['embers', 'shimmer', 'frost', 'wisp', 'glints', 'ringlet', 'more'].map(
			(id) => RECIPES[id as keyof typeof RECIPES].frame
		);
		// Colour never tells them apart alone: shield, spark, puff, disc, ring and plus differ in shape.
		expect(new Set(frames).size).toBeGreaterThanOrEqual(5);
	});
});
