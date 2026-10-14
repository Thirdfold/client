// The grass cell list (#302): which cells grow grass for a viewer, and the sides blades keep off.

import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, type FloorId, withGrass } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import {
	grassCells,
	grassSignature,
	HEIGHT_SCALES,
	INSET,
	NATURE_DENSITY,
	type GrassInput
} from './grass-cells';
import { waterCells } from './shore';
import { worldShape, type ShapeInput } from './shape';

const id = (name: FloorId) => FLOOR_IDS.indexOf(name);
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const bytes = (...v: number[]) => Uint8Array.from(v);
const prop = (assetId: Prop['assetId'], x: number, y: number) => ({
	assetId,
	pos: { x, y },
	rotation: 0 as const
});
const wall = (ax: number, ay: number, bx: number, by: number, extra = {}) =>
	({
		id: `w${ax}${ay}${bx}${by}`,
		kind: 'wall',
		a: { x: ax, y: ay },
		b: { x: bx, y: by },
		...extra
	}) as SceneObject;

function grassOf(
	g: SquareGrid,
	over: Partial<ShapeInput> & Partial<Omit<GrassInput, 'shape'>> = {}
) {
	const { interior = null, props = [], defaultIsGrass = false, isLiquid, paint, ...shape } = over;
	const input: ShapeInput = {
		grid: g,
		levels: null,
		floor: null,
		objects: [],
		known: null,
		...shape
	};
	return grassCells({ shape: worldShape(input), interior, props, defaultIsGrass, isLiquid, paint });
}

const grass = (n: number, ...except: [number, FloorId][]) => {
	const f = new Uint8Array(n).fill(id('grass'));
	for (const [i, name] of except) f[i] = id(name);
	return f;
};

describe('grassCells', () => {
	it('grows on grass floors and not on other floors', () => {
		const floor = bytes(id('grass'), id('stone'), id('plain'), id('dirt'));
		const out = grassOf(grid(4, 1), { floor });
		expect([...out.cells]).toEqual([0]);
		expect(out.density[0]).toBe(255);
	});

	it('grows on plain cells only where the default ground is grass and no roof covers them', () => {
		expect(grassOf(grid(3, 1)).count).toBe(0);
		const roofed = grassOf(grid(3, 1), { defaultIsGrass: true, interior: bytes(0, 1, 0) });
		expect([...roofed.cells]).toEqual([0, 2]);
		// A floor painted grass inside a house is the GM's choice: it stays.
		const painted = grassOf(grid(2, 1), { floor: grass(2), interior: bytes(1, 1) });
		expect(painted.count).toBe(2);
	});

	it('leaves out void, lava and water floors, and liquid props', () => {
		const floor = bytes(id('grass'), id('void'), id('lava'), id('water'), id('grass'), id('grass'));
		const g = grid(6, 1);
		const props = [prop('water-sm', 4, 0)];
		const isLiquid = (a: string) => a.startsWith('water');
		const water = waterCells(g, floor, props, isLiquid);
		const out = grassOf(g, { floor, props, isLiquid, water });
		expect([...out.cells]).toEqual([0, 5]);
	});

	it('leaves out prop footprints but nature props keep half density', () => {
		const out = grassOf(grid(5, 1), {
			floor: grass(5),
			props: [prop('crate', 1, 0), prop('tree', 2, 0), prop('rug', 3, 0)]
		});
		expect([...out.cells]).toEqual([0, 2]);
		expect([...out.density]).toEqual([255, NATURE_DENSITY]);
	});

	it('insets the sides toward walls, windows and doors', () => {
		// 3x3 all grass; the middle cell is checked: north a wall, east a door, south a window.
		const objects = [
			wall(1, 1, 2, 1),
			{ id: 'd', kind: 'door', a: { x: 2, y: 1 }, b: { x: 2, y: 2 }, open: false } as SceneObject,
			wall(1, 2, 2, 2, { window: true })
		];
		const out = grassOf(grid(3, 3), { floor: grass(9), objects });
		const middle = out.insets[out.cells.indexOf(4)];
		expect(middle).toBe(INSET.wall | (INSET.wall << 1) | (INSET.wall << 2));
	});

	it('insets the sides toward drops, steps down, void and water, not toward higher ground', () => {
		// North a step down, east a cliff down, south void, west water.
		const levels = bytes(0, 3, 0, 0, 4, 0, 0, 0, 0);
		const floor = grass(9, [7, 'void'], [3, 'water']);
		const out = grassOf(grid(3, 3), { floor, levels });
		expect(out.insets[out.cells.indexOf(4)]).toBe(INSET.wide * 15);
		const up = grassOf(grid(2, 1), { floor: grass(2), levels: bytes(0, 1) });
		expect([...up.insets]).toEqual([0, INSET.wide << 3]);
	});

	it('shows a player only explored cells, and the GM every cell', () => {
		const floor = grass(4);
		const known = bytes(1, 1, 0, 0);
		expect([...grassOf(grid(4, 1), { floor, known }).cells]).toEqual([0, 1]);
		expect(grassOf(grid(4, 1), { floor, known: null }).count).toBe(4);
		// Plain village ground too: unexplored cells read as plain to a player but grow nothing.
		const village = grassOf(grid(4, 1), { known, defaultIsGrass: true });
		expect([...village.cells]).toEqual([0, 1]);
	});

	it('puts nothing about an unexplored neighbour in an explored cell', () => {
		// A drop, a wall and water lie toward the unexplored cell: the explored one gets no inset.
		const objects = [wall(1, 0, 1, 1)];
		const floor = grass(2, [1, 'water']);
		const out = grassOf(grid(2, 1), { floor, objects, levels: bytes(3, 0), known: bytes(1, 0) });
		expect([...out.insets]).toEqual([0]);
	});

	it("grows the GM's paint: none where None, blades as a share of the densest, heights by rank", () => {
		const g = grid(4, 1);
		let paint = withGrass(null, g, { x: 0, y: 0 }, { x: 0, y: 0 }, 'none', 'tall');
		paint = withGrass(paint, g, { x: 1, y: 0 }, { x: 1, y: 0 }, 'lush', 'very-tall');
		paint = withGrass(paint, g, { x: 2, y: 0 }, { x: 2, y: 0 }, 'sparse', 'short');
		const out = grassOf(g, { floor: grass(4), paint, props: [prop('tree', 2, 0)] });
		expect([...out.cells]).toEqual([1, 2, 3]);
		expect(out.densest).toBe(2.5);
		expect(out.tallest).toBe(2.4);
		// Lush all of the densest; sparse 0.5 of 2.5 under a tree; normal 1 of 2.5.
		expect([...out.density]).toEqual([255, Math.round((0.5 * NATURE_DENSITY) / 2.5), 102]);
		expect([...out.heights].map((h) => HEIGHT_SCALES[h])).toEqual([2.4, 0.6, 1]);
		// No paint: every cell all of the tier's blades at Normal height.
		const plain = grassOf(g, { floor: grass(4) });
		expect([plain.densest, plain.tallest, [...plain.density]]).toEqual([
			1,
			1,
			[255, 255, 255, 255]
		]);
		// A paint of another size (a stale map) reads as none.
		expect(grassOf(g, { floor: grass(4), paint: new Uint8Array(3).fill(1) }).count).toBe(4);
		expect(grassSignature(out, 4)).not.toBe(grassSignature(plain, 4));
	});

	it('is deterministic and signs equal results equally', () => {
		const make = (x = 2) => grassOf(grid(5, 5), { floor: grass(25), props: [prop('tree', x, 2)] });
		const [a, b] = [make(), make()];
		expect(a).toEqual(b);
		expect(grassSignature(a, 5)).toBe(grassSignature(b, 5));
		expect(grassSignature(make(3), 5)).not.toBe(grassSignature(a, 5));
		expect(grassSignature(a, 6)).not.toBe(grassSignature(a, 5));
	});
});
