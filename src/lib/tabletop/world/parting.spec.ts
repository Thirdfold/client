// Which footprints the grass parts round (#303).

import { describe, expect, it } from 'vitest';
import { liftWeight, partingSet, setFootprint, slotAt, type Footprint } from './parting';

const fp = (id: string, x: number, z: number, weight = 1): Footprint => ({
	id,
	x,
	z,
	radius: 0.5,
	weight
});
/** The x of each packed footprint. */
const xs = (out: ReturnType<typeof partingSet>) =>
	Array.from({ length: out.count }, (_, k) => out.data[k * 4]);

describe('liftWeight', () => {
	it('is 1 on the ground, fades with the lift and is 0 from one level up', () => {
		expect(liftWeight(0, 0.4)).toBe(1);
		expect(liftWeight(0.2, 0.4)).toBeCloseTo(0.5);
		expect(liftWeight(0.4, 0.4)).toBe(0);
		expect(liftWeight(2, 0.4)).toBe(0);
	});
});

describe('partingSet', () => {
	it('packs x, z, radius and weight, nearest the target first', () => {
		const out = partingSet([fp('a', 5, 0), fp('b', 1, 0.5, 0.25)], { x: 0, z: 0 });
		expect(out.count).toBe(2);
		expect(Array.from(out.data.slice(0, 8))).toEqual([1, 0.5, 0.5, 0.25, 5, 0, 0.5, 1]);
		expect(out.data.length).toBe(32 * 4);
		expect(out.data[8]).toBe(0);
	});

	it('keeps the nearest 32', () => {
		const all = Array.from({ length: 40 }, (_, i) => fp(`t${i}`, 40 - i, 0));
		const out = partingSet(all, { x: 0, z: 0 });
		expect(out.count).toBe(32);
		expect(xs(out)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
	});

	it('breaks ties by id, whatever the order', () => {
		const [a, b] = [fp('a', -1, 0), fp('b', 1, 0)];
		expect(xs(partingSet([b, a], { x: 0, z: 0 }, 1))).toEqual([-1]);
		expect(xs(partingSet([a, b], { x: 0, z: 0 }, 1))).toEqual([-1]);
		expect(xs(partingSet([b, a], { x: 0, z: 0 }, 2))).toEqual([-1, 1]);
	});

	it('leaves out weightless (lifted) footprints', () => {
		const out = partingSet([fp('up', 0, 0, 0), fp('down', 3, 0)], { x: 0, z: 0 });
		expect(xs(out)).toEqual([3]);
	});

	it('reuses a buffer, honours a live count and clears what it no longer uses', () => {
		const pool: Footprint[] = [];
		setFootprint(slotAt(pool, 0), 'a', 1, 1, 0.4, 1);
		setFootprint(slotAt(pool, 1), 'b', 2, 2, 0.4, 1);
		setFootprint(slotAt(pool, 2), 'stale', 0, 0, 0.4, 1);
		const into = { data: new Float32Array(32 * 4), count: 0 };
		expect(partingSet(pool, { x: 0, z: 0 }, 32, into, 3)).toBe(into);
		expect(into.count).toBe(3);
		partingSet(pool, { x: 0, z: 0 }, 32, into, 2);
		expect(into.count).toBe(2);
		expect(Array.from(into.data.slice(8, 12))).toEqual([0, 0, 0, 0]);
	});

	it('is the same whatever order the footprints come in', () => {
		const list = Array.from({ length: 50 }, (_, i) => fp(`m${i}`, (i * 7) % 13, (i * 5) % 11));
		const a = partingSet(list, { x: 4, z: 4 });
		const b = partingSet([...list].reverse(), { x: 4, z: 4 });
		expect(Array.from(a.data)).toEqual(Array.from(b.data));
	});
});
