// The particle layer's bookkeeping (#311), pure and Node-tested (vfx-state.spec.ts): which slots of
// each pool's instance buffers a burst or a loop writes, when the last burst ends, and what loops
// are on the table. The buffers are plain Float32Arrays that vfx.ts hands to three as instanced
// attributes, uploading only the ranges written (`flush`), so nothing is written per frame: every
// particle's place, size, colour and fade is a closed form of (seed, birth, now) in the graph
// (materials/vfx.ts).
//
// A pool's slots: loops first (`LOOP_SHARE` of the tier's cap, laid out again whenever one starts
// or stops, newest first, so over the cap the oldest loops are left out, never bursts), then a
// ring the bursts take slots from in turn, wrapping onto its own oldest (long ended at any
// reasonable rate). Never scanned per frame.

import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Ground } from './ground';
import {
	MAX_COUNT,
	POOLS,
	RECIPES,
	RECIPE_IDS,
	reachOf,
	type PoolName,
	type RecipeId
} from './vfx-recipes';

/** Floats per slot in each of a pool's two attributes. */
export const STRIDE = 4;
/** The most particles a pool holds (ultra's cap): the size of its buffers. */
export const MAX_PARTICLES = 8000;
/** How long a burst's still frame shows under reduced motion, fading, in ms. */
export const STILL_MS = 250;
/** The share of a pool's cap loops may hold; bursts ring through the rest. */
export const LOOP_SHARE = 0.5;
/** Seeds are taken modulo this, so a seed's random streams stay exact in a float (materials/vfx.ts). */
export const SEEDS = 4096;
/** A free slot's birth, in seconds: long dead. */
export const DEAD = -1e9;

export interface Origin {
	x: number;
	y: number;
	z: number;
}

export interface Bounds {
	min: Origin;
	max: Origin;
}

export interface Pool {
	/** Per slot: the origin's x, y and z, and the seed (`aVfxA`). */
	readonly a: Float32Array;
	/**
	 * Per slot: birth (seconds on the layer's clock), the recipe's index, its loop's ring size (0 a
	 * burst) and the particle's index in its burst or ring (`aVfxB`).
	 */
	readonly b: Float32Array;
	/** Slot ranges written since the last `flush`, as [first, count]. */
	dirty: [number, number][];
	/** Instances to draw: one past the highest slot written since the cap was set. */
	drawn: number;
	/** When its last burst ends (ms on the layer's clock). */
	until: number;
	/** Loop particles laid out in it. */
	looping: number;
}

/** What a frame reports (`VfxState.tick`). */
export interface VfxFrame {
	/** A burst is still playing: ACTIVE frames. */
	bursting: boolean;
	/** Loops are on the table: AMBIENT frames while `bounds` is in view. */
	looping: boolean;
	/** Where the loops' particles can be drawn; null with none. */
	bounds: Bounds | null;
}

/** The particle layer's counter under `?perf` (perf.ts). */
export interface VfxStats {
	/** Particles alive now, bursts playing and loops laid out. */
	live: number;
	bursts: number;
	loops: number;
}

interface Loop {
	recipe: RecipeId;
	origin: Origin;
	seed: number;
	share: number;
}

/** An emitter asked for in a group (`VfxState.replace`). */
export interface LoopItem {
	recipe: string;
	origin: Origin;
	seed: number;
	/** Its share of the recipe's particles, if not the layer's (the motes carry their tier's count already). */
	share?: number;
}

/** The world point over a cell's floor, `lift` world units up: where an effect on it starts. */
export function cellOrigin(grid: SquareGrid, ground: Ground, cell: GridPos, lift = 0): Origin {
	const { x, z } = gridToWorld(grid, cell);
	return { x, y: ground.floorY(cell) + lift, z };
}

/** A recipe's particles at the tier's `share` (low halves them), at least one, at most `most`. */
const countOf = (count: number, share: number, most: number) =>
	Math.min(Math.max(1, Math.round(Math.min(count, MAX_COUNT) * share)), most);

const seedOf = (seed: number) => Math.abs(Math.trunc(seed)) % SEEDS;

function emptyPool(): Pool {
	const b = new Float32Array(MAX_PARTICLES * STRIDE);
	for (let i = 0; i < b.length; i += STRIDE) b[i] = DEAD;
	return {
		a: new Float32Array(MAX_PARTICLES * STRIDE),
		b,
		dirty: [],
		drawn: 0,
		until: 0,
		looping: 0
	};
}

export class VfxState {
	readonly pools = Object.fromEntries(POOLS.map((p) => [p, emptyPool()])) as Record<PoolName, Pool>;
	/** Under reduced motion a burst lasts `STILL_MS` (its still frame, fading). */
	reduced = false;
	/** Where the laid-out loops can be drawn, or null. */
	bounds: Bounds | null = null;
	private cap = MAX_PARTICLES;
	private loopCap = Math.floor(MAX_PARTICLES * LOOP_SHARE);
	private readonly head = Object.fromEntries(POOLS.map((p) => [p, this.loopCap])) as Record<
		PoolName,
		number
	>;
	/** Every loop asked for, oldest first (some may be left out over the cap). */
	private readonly loops = new Map<string, Loop>();
	private laid = 0;
	private bursts: { end: number; n: number }[] = [];
	private epoch: number | null = null;

	/** `now` (ms) as seconds on the layer's clock, which starts at its first event: `vfxNow`. */
	seconds(now: number): number {
		this.epoch ??= now;
		return (now - this.epoch) / 1000;
	}

	/**
	 * A one-off effect: the recipe's particles born at `t0` (ms, the renderer's clock) at `origin`,
	 * their look drawn from `seed`. Writes its slots once. False for an unknown recipe.
	 */
	burst(id: string, origin: Origin, seed: number, t0: number, share = 1): boolean {
		if (!(RECIPE_IDS as string[]).includes(id)) return false;
		const r = RECIPES[id as RecipeId];
		const pool = this.pools[r.pool];
		const n = countOf(r.count, share, this.cap - this.loopCap);
		const [birth, seed0, index] = [
			this.seconds(t0),
			seedOf(seed),
			RECIPE_IDS.indexOf(id as RecipeId)
		];
		let [slot, first] = [this.head[r.pool], this.head[r.pool]];
		for (let k = 0; k < n; k++) {
			this.put(pool, slot, origin, seed0, birth, index, 0, k);
			if (++slot === this.cap) {
				pool.dirty.push([first, slot - first]);
				first = slot = this.loopCap;
			}
		}
		if (slot > first) pool.dirty.push([first, slot - first]);
		this.head[r.pool] = slot;
		const end = t0 + (this.reduced ? STILL_MS : r.lifetime * 1000);
		pool.until = Math.max(pool.until, end);
		this.bursts.push({ end, n });
		return true;
	}

	/** A running emitter under `id` (a new one replaces it): a ring of particles born in turn. */
	loop(id: string, recipe: string, origin: Origin, seed: number, share = 1): boolean {
		if (!(RECIPE_IDS as string[]).includes(recipe)) return false;
		this.loops.delete(id);
		this.loops.set(id, {
			recipe: recipe as RecipeId,
			origin: { ...origin },
			seed: seedOf(seed),
			share
		});
		this.layLoops();
		return true;
	}

	/**
	 * Replaces every loop whose id starts with `prefix` by `items` (ids `prefix` and their index),
	 * laid out once: a set of emitters that changes together (the motes round the camera, the
	 * effects a table's props make). False when there was nothing to replace or to add.
	 */
	replace(prefix: string, items: readonly LoopItem[], share = 1): boolean {
		let changed = false;
		for (const id of [...this.loops.keys()])
			if (id.startsWith(prefix)) changed = this.loops.delete(id) || changed;
		items.forEach((item, i) => {
			if (!(RECIPE_IDS as string[]).includes(item.recipe)) return;
			this.loops.set(prefix + i, {
				recipe: item.recipe as RecipeId,
				origin: { ...item.origin },
				seed: seedOf(item.seed),
				share: item.share ?? share
			});
			changed = true;
		});
		if (changed) this.layLoops();
		return changed;
	}

	/** Stops the loop `id`; false if there was none. */
	unloop(id: string): boolean {
		if (!this.loops.delete(id)) return false;
		this.layLoops();
		return true;
	}

	/** The tier's cap per pool (quality.ts `particles`): every slot laid out again, bursts ended. */
	setCap(cap: number): void {
		cap = Math.max(2, Math.min(MAX_PARTICLES, Math.floor(cap)));
		if (cap === this.cap) return;
		[this.cap, this.loopCap] = [cap, Math.floor(cap * LOOP_SHARE)];
		for (const name of POOLS) {
			const pool = this.pools[name];
			pool.a.fill(0);
			for (let i = 0; i < pool.b.length; i += STRIDE)
				pool.b.fill(0, i, i + STRIDE).fill(DEAD, i, i + 1);
			if (pool.drawn) pool.dirty.push([0, pool.drawn]);
			[pool.drawn, pool.until, pool.looping] = [0, 0, 0];
			this.head[name] = this.loopCap;
		}
		this.bursts = [];
		this.layLoops();
	}

	/** What is playing at `now` (ms). No work beyond forgetting ended bursts. */
	tick(now: number): VfxFrame {
		if (this.bursts.length && this.bursts[0].end <= now)
			this.bursts = this.bursts.filter((b) => b.end > now);
		const until = Math.max(...POOLS.map((p) => this.pools[p].until));
		return { bursting: now < until, looping: this.laid > 0, bounds: this.bounds };
	}

	/** Whether `pool` has anything to draw at `now`: a burst playing or a loop. */
	shows(pool: PoolName, now: number): boolean {
		const p = this.pools[pool];
		return now < p.until || p.looping > 0;
	}

	stats(now: number): VfxStats {
		const playing = this.bursts.filter((b) => b.end > now);
		const looping = POOLS.reduce((sum, p) => sum + this.pools[p].looping, 0);
		return {
			live: playing.reduce((sum, b) => sum + b.n, looping),
			bursts: playing.length,
			loops: this.laid
		};
	}

	/** The slot ranges written since the last call, cleared. */
	flush(pool: PoolName): [number, number][] {
		const p = this.pools[pool];
		const dirty = p.dirty;
		p.dirty = [];
		for (const [first, count] of dirty) p.drawn = Math.max(p.drawn, first + count);
		return dirty;
	}

	/**
	 * Lays every pool's loops out from slot 0, newest first, while they fit in its loop share; the
	 * slots they no longer take are freed. ponytail: rewrites the loop share on every change;
	 * swap-remove blocks if loops ever change often.
	 */
	private layLoops(): void {
		const box = {
			min: { x: Infinity, y: Infinity, z: Infinity },
			max: { x: -Infinity, y: -Infinity, z: -Infinity }
		};
		const used = Object.fromEntries(POOLS.map((p) => [p, 0])) as Record<PoolName, number>;
		const full = new Set<PoolName>();
		this.laid = 0;
		for (const { recipe, origin, seed, share } of [...this.loops.values()].reverse()) {
			const r = RECIPES[recipe];
			const n = countOf(r.count, share, MAX_COUNT);
			if (full.has(r.pool) || used[r.pool] + n > this.loopCap) {
				full.add(r.pool); // this and every older loop of the pool are left out
				continue;
			}
			const index = RECIPE_IDS.indexOf(recipe);
			for (let k = 0; k < n; k++)
				this.put(
					this.pools[r.pool],
					used[r.pool] + k,
					origin,
					seed,
					(k * r.lifetime) / n,
					index,
					n,
					k
				);
			used[r.pool] += n;
			this.laid++;
			const reach = reachOf(r);
			for (const axis of ['x', 'y', 'z'] as const) {
				box.min[axis] = Math.min(box.min[axis], origin[axis] - reach);
				box.max[axis] = Math.max(box.max[axis], origin[axis] + reach);
			}
		}
		for (const name of POOLS) {
			const pool = this.pools[name];
			for (let slot = used[name]; slot < pool.looping; slot++) {
				pool.b.fill(0, slot * STRIDE, (slot + 1) * STRIDE);
				pool.b[slot * STRIDE] = DEAD;
			}
			const span = Math.max(used[name], pool.looping);
			if (span) pool.dirty.push([0, span]);
			pool.looping = used[name];
		}
		this.bounds = this.laid ? box : null;
	}

	private put(
		pool: Pool,
		slot: number,
		o: Origin,
		seed: number,
		birth: number,
		recipe: number,
		ring: number,
		k: number
	): void {
		pool.a.set([o.x, o.y, o.z, seed], slot * STRIDE);
		pool.b.set([birth, recipe, ring, k], slot * STRIDE);
	}
}
