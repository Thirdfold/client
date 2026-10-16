import { describe, expect, it } from 'vitest';
import { ribbonOf, RIBBON_LIFT } from './path-ribbon';

const grid = { kind: 'square', cellSize: 1, width: 8, height: 8 } as const;
const flat = () => 0;
const cells = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 }));

describe('ribbonOf (#286)', () => {
	it('is solid to the movement left and dashed beyond, sharing the cell between', () => {
		const r = ribbonOf(cells, 2, grid, flat);
		expect(r.solid).toHaveLength(3 * 3);
		expect(r.beyond).toHaveLength(3 * 3);
		expect(r.solid.slice(-3)).toEqual(r.beyond.slice(0, 3));
		expect(r.solid[1]).toBeCloseTo(RIBBON_LIFT);
	});

	it('is all solid within reach and all dashed with no movement left', () => {
		expect(ribbonOf(cells, 4, grid, flat).beyond).toEqual([]);
		expect(ribbonOf(cells, 9, grid, flat).beyond).toEqual([]);
		const none = ribbonOf(cells, 0, grid, flat);
		expect(none.solid).toEqual([]);
		expect(none.beyond).toHaveLength(5 * 3);
	});

	it('climbs a riser at the shared edge', () => {
		const up = (c: { x: number }) => (c.x >= 2 ? 0.4 : 0);
		const { solid } = ribbonOf(cells, 4, grid, up);
		// Two extra points between cells 1 and 2, on the same xz: low first, then high.
		expect(solid).toHaveLength((5 + 2) * 3);
		const [a, b] = [solid.slice(6, 9), solid.slice(9, 12)];
		expect(a[0]).toBeCloseTo(b[0]);
		expect(a[2]).toBeCloseTo(b[2]);
		expect(b[1] - a[1]).toBeCloseTo(0.4);
		// And down the other way, high first.
		const down = ribbonOf([...cells].reverse(), 4, grid, up).solid;
		expect(down[13] - down[10]).toBeCloseTo(-0.4);
	});

	it('points the arrow along the last step and is absent for a path of one', () => {
		const r = ribbonOf(cells, 4, grid, flat);
		expect(r.tip).toMatchObject({ dx: 1, dz: 0 });
		expect(ribbonOf([cells[0]], 0, grid, flat).tip).toBeNull();
	});
});
