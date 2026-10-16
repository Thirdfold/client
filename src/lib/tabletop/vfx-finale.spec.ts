import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../game/grid';
import type { Prop } from '../game/props';
import { FLASH_MS } from '../game/chat';
import { countFlashes, type FrameSample } from './flash';
import type { FinaleEvent } from './finale-cues';
import { groundFor } from './ground';
import { playVfx, type PlayContext } from './vfx-play';
import { FLASH_BUDGET, FLASH_BUDGET_SOFT, FlashBudget, pulseLoops } from './vfx-finale';
import { RECIPE_IDS, RECIPES } from './vfx-recipes';

function table(patch: Partial<PlayContext> = {}, extra: Record<string, unknown> = {}) {
	const bursts: { recipe: string; seed: number; t: number }[] = [];
	const loops = new Map<string, string>();
	const heaves: number[] = [];
	const marks: unknown[] = [];
	const grid = DEFAULT_GRID;
	const ctx: PlayContext = {
		vfx: {
			burst: (recipe, _o, seed, t) => void bursts.push({ recipe, seed, t }),
			loop: (id, recipe) => void loops.set(id, recipe),
			unloop: (id) => void loops.delete(id),
			...extra
		},
		grid,
		ground: groundFor(grid, null),
		tokens: [],
		props: [],
		decals: { addTransient: (m) => void marks.push(m), fade: () => {} },
		effects: { heave: (now, reduced) => void (reduced || heaves.push(now)) },
		now: 1000,
		reduced: false,
		...patch
	};
	return { ctx, bursts, loops, heaves, marks };
}

const at = { x: 4, y: 4 };
const all: FinaleEvent[] = [
	{ kind: 'emerge', tokenId: 't', at, seed: 1 },
	{ kind: 'sink', tokenId: 't', at, seed: 2 },
	{ kind: 'rupture', propId: 'c', at, seed: 3 },
	{ kind: 'collapse', propId: 'c', at, seed: 4 },
	{ kind: 'shatter', propId: 'b', at, seed: 5 },
	{ kind: 'grasp', from: { x: 1, y: 1 }, to: at, seq: 6 },
	{ kind: 'heave', seed: 7 },
	{ kind: 'ending', at, seed: 8 }
];

describe('the finale on the particle layer', () => {
	it('names only recipes that exist', () => {
		const t = table();
		playVfx(all, t.ctx);
		for (const b of t.bursts) expect(RECIPE_IDS).toContain(b.recipe);
		for (const r of t.loops.values()) expect(RECIPE_IDS).toContain(r);
		expect(RECIPES.seam.pool).toBe('additive');
	});

	it('plays on the cell the event names, and the ground heaves once', () => {
		const t = table();
		playVfx([{ kind: 'heave', seed: 1 }], t.ctx);
		expect(t.heaves).toEqual([1000]);
	});

	it('lays one seam loop per crack, moves none that stays, and takes the rest away', () => {
		const t = table();
		const seams = (of: [string, { x: number; y: number }][]): FinaleEvent => ({
			kind: 'seams',
			of
		});
		playVfx(
			[
				seams([
					['a', at],
					['b', { x: 1, y: 1 }]
				])
			],
			t.ctx
		);
		expect([...t.loops.keys()].sort()).toEqual(['seam:a', 'seam:b']);
		playVfx([seams([['a', at]])], t.ctx);
		expect([...t.loops.keys()]).toEqual(['seam:a']);
		playVfx([seams([])], t.ctx);
		expect(t.loops.size).toBe(0);
	});

	it('under reduced motion nothing shakes and nothing travels: a static ring each', () => {
		const t = table({ reduced: true });
		playVfx(all, t.ctx);
		expect(t.heaves).toEqual([]);
		expect(new Set(t.bursts.map((b) => b.recipe))).toEqual(new Set(['ring']));
	});

	it("the low tier draws no debris but a shattering bell's first", () => {
		const low = table({}, { tier: 'low' });
		const medium = table({}, { tier: 'medium' });
		for (const t of [low, medium])
			playVfx(
				all.filter((e) => e.kind !== 'shatter'),
				t.ctx
			);
		expect(low.bursts.some((b) => b.recipe === 'debris')).toBe(false);
		expect(medium.bursts.some((b) => b.recipe === 'debris')).toBe(true);
	});

	it('leaves a scorch under a bursting crack', () => {
		const t = table();
		playVfx([{ kind: 'rupture', propId: 'c', at, seed: 3 }], t.ctx);
		expect(t.marks).toMatchObject([{ atlasKey: 'scorch', cell: at }]);
	});
});

const BRIGHT = new Set(['shock', 'sparks', 'ring', 'tollRing']);

describe('the flash budget', () => {
	it('lets 3 a second through, and 1 under Reduce flashing', () => {
		const b = new FlashBudget(FLASH_BUDGET);
		expect([0, 100, 200, 300, 900, 1000].map((t) => b.take(t))).toEqual([
			true,
			true,
			true,
			false,
			false,
			true
		]);
		const soft = new FlashBudget(FLASH_BUDGET_SOFT);
		expect([0, 500, 1000].map((t) => soft.take(t))).toEqual([true, false, true]);
	});

	it('a heaving, rupturing, grasping round draws at most 3 bright bursts in any second', () => {
		const t = table();
		// Ten events a few tens of ms apart, as a ringing round with many tendrils and cracks.
		for (let i = 0; i < 10; i++) {
			const ctx = { ...t.ctx, now: 5000 + i * 80 };
			playVfx(
				[
					{ kind: 'rupture', propId: `c${i}`, at, seed: i },
					{ kind: 'grasp', from: { x: 0, y: 0 }, to: at, seq: i * 10 },
					{ kind: 'shatter', propId: 'b', at, seed: i }
				],
				ctx
			);
		}
		const bright = t.bursts.filter((b) => BRIGHT.has(b.recipe));
		expect(bright.length).toBe(FLASH_BUDGET);
		// The dust is not refused.
		expect(t.bursts.filter((b) => b.recipe === 'dustpuff').length).toBeGreaterThan(10);
	});

	it('under Reduce flashing at most 1 a second, and a cue flash counts against it', () => {
		const t = table({}, { reduceFlashing: true });
		playVfx([{ kind: 'flash', at: null, seq: 1 }], t.ctx);
		playVfx([{ kind: 'rupture', propId: 'c', at, seed: 3 }], { ...t.ctx, now: 1200 });
		expect(t.bursts.filter((b) => BRIGHT.has(b.recipe))).toEqual([]);
		playVfx([{ kind: 'rupture', propId: 'c', at, seed: 3 }], { ...t.ctx, now: 2300 });
		expect(t.bursts.filter((b) => BRIGHT.has(b.recipe)).length).toBe(1);
	});

	it('its bursts, laid on the second as a frame sampler sees them, never exceed 3 flashes', () => {
		// Sample luminance 1 where a bright burst lives (its recipe's lifetime), else 0.3.
		const b = new FlashBudget(FLASH_BUDGET);
		const starts: number[] = [];
		for (let t = 0; t < 6000; t += 100) if (b.take(t)) starts.push(t);
		const life = 400;
		const samples: FrameSample[] = [];
		for (let t = 0; t < 6000; t += 16) {
			const on = starts.some((s) => t >= s && t < s + life);
			samples.push({ t, luminance: on ? 0.95 : 0.1, red: 0.3 });
		}
		expect(countFlashes(samples).flashes).toBeLessThanOrEqual(3);
		expect(FLASH_MS).toBeGreaterThan(0);
	});
});

describe('the pulse', () => {
	const prop = (id: string, assetId: string, x: number, y: number) =>
		({ id, assetId, pos: { x, y }, rotation: 0, scale: 1 }) as unknown as Prop;
	const hints = (a: string) => (a === 'heart' ? { idle: 'pulse', glowFrom: 'light' } : undefined);
	const origin = () => ({ x: 0, y: 0, z: 0 });

	it('throbs while a light that is on stands in its footprint, hued by it', () => {
		const props = [prop('h', 'heart', 5, 5)];
		const red = pulseLoops(props, [{ pos: { x: 6, y: 6 }, color: '#c0392b' }], hints, origin);
		const blue = pulseLoops(props, [{ pos: { x: 6, y: 6 }, color: '#7fb6ff' }], hints, origin);
		expect([...red.keys()]).toEqual(['pulse:h']);
		expect(red.get('pulse:h')!.recipe).toBe('heartPulse');
		expect(Math.floor(red.get('pulse:h')!.seed / 256)).not.toBe(
			Math.floor(blue.get('pulse:h')!.seed / 256)
		);
	});

	it('goes still when its light goes out or stands outside it', () => {
		const props = [prop('h', 'heart', 5, 5)];
		expect(pulseLoops(props, [], hints, origin).size).toBe(0);
		expect(pulseLoops(props, [{ pos: { x: 9, y: 9 }, color: '#fff' }], hints, origin).size).toBe(0);
	});

	it('is for models that say so', () => {
		const props = [prop('c', 'crate', 5, 5)];
		expect(pulseLoops(props, [{ pos: { x: 5, y: 5 }, color: '#fff' }], hints, origin).size).toBe(0);
	});
});
