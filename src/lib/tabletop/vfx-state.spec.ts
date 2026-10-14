import { describe, expect, it } from 'vitest';
import { groundFor } from './ground';
import {
	ATLAS,
	MAX_RECIPES,
	RECIPE_IDS,
	RECIPE_VEC4S,
	RECIPES,
	packRecipes,
	reachOf
} from './vfx-recipes';
import {
	DEAD,
	LOOP_SHARE,
	MAX_PARTICLES,
	STILL_MS,
	STRIDE,
	VfxState,
	cellOrigin
} from './vfx-state';

const at = { x: 1, y: 0, z: -2 };
/** The slots a pool's attribute `b` holds as births (seconds), for slots `from` to `to`. */
const births = (s: VfxState, pool: 'additive' | 'soft', from: number, to: number) =>
	Array.from({ length: to - from }, (_, i) => s.pools[pool].b[(from + i) * STRIDE]);

describe('VfxState', () => {
	it('writes a burst once: its slots, in one range, and nothing per frame', () => {
		const s = new VfxState();
		s.setCap(1000);
		expect(s.flush('additive')).toEqual([]); // a new cap rewrites nothing yet drawn
		expect(s.burst('sparks', at, 7, 1000)).toBe(true);
		const n = RECIPES.sparks.count;
		const ring = 1000 * LOOP_SHARE;
		expect(s.flush('additive')).toEqual([[ring, n]]);
		expect(s.pools.additive.drawn).toBe(ring + n);
		const a = s.pools.additive.a;
		expect([...a.subarray(ring * STRIDE, ring * STRIDE + 4)]).toEqual([1, 0, -2, 7]);
		// Particle k of the burst carries its index, so its look is the same on every client.
		const b = s.pools.additive.b;
		expect(b[(ring + 3) * STRIDE + 3]).toBe(3);
		expect(b[(ring + 3) * STRIDE + 1]).toBe(RECIPE_IDS.indexOf('sparks'));
		s.tick(1100);
		s.tick(1200);
		expect(s.flush('additive')).toEqual([]);
		expect(s.flush('soft')).toEqual([]);
	});

	it('takes burst slots from a ring that wraps onto its oldest, never onto the loops', () => {
		const s = new VfxState();
		s.setCap(100); // 50 for loops, a ring of 50
		s.flush('additive');
		s.loop('fire', 'embers', at, 1);
		s.flush('additive');
		const loops = births(s, 'additive', 0, RECIPES.embers.count);
		s.burst('sparks', at, 1, 0); // 32 slots: 50..81
		s.burst('sparks', at, 2, 10); // 18 to the end, then 14 from the ring's start
		expect(s.flush('additive')).toEqual([
			[50, 32],
			[82, 18],
			[50, 14]
		]);
		expect(births(s, 'additive', 0, RECIPES.embers.count)).toEqual(loops);
		// A burst never takes more than the ring.
		s.burst('dust', at, 3, 20);
		expect(s.flush('soft').reduce((sum, [, n]) => sum + n, 0)).toBe(50);
	});

	it('ends a burst at its birth plus its lifetime, then reports nothing to draw', () => {
		const s = new VfxState();
		const t0 = 5000;
		s.burst('sparks', at, 1, t0);
		const end = t0 + RECIPES.sparks.lifetime * 1000;
		expect(s.tick(t0)).toMatchObject({ bursting: true, looping: false, bounds: null });
		expect(s.shows('additive', end - 1)).toBe(true);
		expect(s.shows('soft', t0)).toBe(false);
		expect(s.tick(end - 1).bursting).toBe(true);
		expect(s.tick(end).bursting).toBe(false);
		expect(s.shows('additive', end)).toBe(false);
		expect(s.stats(end)).toEqual({ live: 0, bursts: 0, loops: 0 });
	});

	it('loops: AMBIENT within their bounds, laid out newest first, the oldest left out over the cap', () => {
		const s = new VfxState();
		s.setCap(2 * RECIPES.embers.count * 2); // room for two ember loops
		s.loop('a', 'embers', { x: 0, y: 0, z: 0 }, 1);
		s.loop('b', 'embers', { x: 10, y: 0, z: 0 }, 2);
		const frame = s.tick(0);
		expect(frame).toMatchObject({ bursting: false, looping: true });
		const reach = reachOf(RECIPES.embers);
		expect(frame.bounds!.min.x).toBeCloseTo(-reach);
		expect(frame.bounds!.max.x).toBeCloseTo(10 + reach);
		s.loop('c', 'embers', { x: 20, y: 0, z: 0 }, 3);
		expect(s.stats(0)).toEqual({ live: 2 * RECIPES.embers.count, bursts: 0, loops: 2 });
		expect(s.tick(0).bounds!.min.x).toBeCloseTo(10 - reach); // 'a', the oldest, is out
		// A loop's particles are born in turn over its period: stateless, so it runs on after idle.
		const n = RECIPES.embers.count;
		const ring = [...s.pools.additive.b.subarray(0, n * STRIDE)].filter((_, i) => i % STRIDE === 0);
		expect(ring.slice(0, 3)).toEqual(
			[0, 1, 2].map((k) => Math.fround((k * RECIPES.embers.lifetime) / n))
		);
		// Stopping 'c' brings 'a' back; stopping the rest frees every slot.
		expect(s.unloop('c')).toBe(true);
		expect(s.tick(0).bounds!.min.x).toBeCloseTo(-reach);
		s.unloop('a');
		s.unloop('b');
		expect(s.unloop('b')).toBe(false);
		expect(s.tick(0)).toEqual({ bursting: false, looping: false, bounds: null });
		expect(births(s, 'additive', 0, 2 * n).every((b) => b === DEAD)).toBe(true);
		expect(s.shows('additive', 0)).toBe(false);
	});

	it('under reduced motion a burst is its still frame, ending after STILL_MS', () => {
		const s = new VfxState();
		s.reduced = true;
		s.burst('ring', at, 1, 100);
		expect(s.tick(100 + STILL_MS - 1).bursting).toBe(true);
		expect(s.tick(100 + STILL_MS).bursting).toBe(false);
	});

	it('times births in seconds from its first event, and ignores unknown recipes', () => {
		const s = new VfxState();
		expect(s.burst('nope', at, 1, 0)).toBe(false);
		expect(s.loop('x', 'nope', at, 1)).toBe(false);
		expect(s.seconds(123_456)).toBe(0);
		s.burst('heal', at, 99_999, 125_456);
		const ring = MAX_PARTICLES * LOOP_SHARE;
		expect(s.pools.additive.b[ring * STRIDE]).toBe(2);
		expect(s.pools.additive.a[ring * STRIDE + 3]).toBeLessThan(4096); // the seed, reduced
	});

	it('a new cap frees every slot drawn and lays the loops out again', () => {
		const s = new VfxState();
		s.loop('fire', 'embers', at, 1);
		s.burst('sparks', at, 1, 0);
		s.flush('additive');
		s.setCap(400);
		const dirty = s.flush('additive');
		expect(dirty[0]).toEqual([0, MAX_PARTICLES * LOOP_SHARE + RECIPES.sparks.count]);
		expect(s.tick(0).bursting).toBe(false);
		expect(s.stats(0).loops).toBe(1);
	});
});

describe('the recipes', () => {
	it('pack into the uniform array, one row each, within its size', () => {
		const packed = packRecipes();
		expect(packed.length).toBe(MAX_RECIPES * RECIPE_VEC4S * 4);
		expect(RECIPE_IDS.length).toBeLessThanOrEqual(MAX_RECIPES);
		const row = RECIPE_IDS.indexOf('smoke') * RECIPE_VEC4S * 4;
		expect(packed[row]).toBe(RECIPES.smoke.lifetime);
		expect(packed[row + 16]).toBe(ATLAS.puff);
		expect(packed[row + 17]).toBe(RECIPES.smoke.frames);
		expect(packed[row + 18]).toBe(1); // lit
	});

	it('each fits a pool, the atlas and its counts', () => {
		for (const id of RECIPE_IDS) {
			const r = RECIPES[id];
			expect(r.count, id).toBeGreaterThan(0);
			expect(r.count, id).toBeLessThanOrEqual(256);
			expect(r.frame + r.frames, id).toBeLessThanOrEqual(16);
			expect(r.lifetime, id).toBeGreaterThan(0);
		}
	});
});

describe('cellOrigin', () => {
	it('stands an effect over a cell, on its floor', () => {
		const grid = { kind: 'square' as const, cellSize: 1, width: 4, height: 4 };
		const levels = new Uint8Array(16);
		levels[1 * 4 + 2] = 2;
		const o = cellOrigin(grid, groundFor(grid, levels), { x: 2, y: 1 }, 0.5);
		expect(o.x).toBeCloseTo(0.5);
		expect(o.z).toBeCloseTo(-0.5);
		expect(o.y).toBeCloseTo(2 * 0.4 + 0.5);
	});
});
