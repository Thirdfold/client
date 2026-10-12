// Waterfalls and flow (#295): the drop edges, the flow field and the two-phase weights.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { isLiquid, type Manifest } from '$lib/assets/manifest';
import type { Prop } from '$lib/game/props';
import { waterCells } from './shore';
import { knownOf } from './shape';
import { DRIFT, dropEdges, FLOW_ZERO, flowField, flowOf, flowWeights, waterBodies } from './flow';

/** The liquid props by the built manifest's flag (#294). */
const manifest = JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')) as Manifest;
const isLiquidProp = (assetId: string) => isLiquid(manifest, assetId);

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	width,
	height,
	cellSize: 1
});

/** Water wherever `wet(x, y)`, levels from `level(x, y)`, on a `w x h` map. */
function map(
	w: number,
	h: number,
	wet: (x: number, y: number) => boolean,
	level: (x: number, y: number) => number = () => 0
) {
	const water = new Uint8Array(w * h);
	const levels = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			water[y * w + x] = wet(x, y) ? 1 : 0;
			levels[y * w + x] = level(x, y);
		}
	return { grid: grid(w, h), water, levels };
}

/** A flow vector of cell (x, y). */
const at = (f: Uint8Array, w: number, x: number, y: number) => [
	flowOf(f[(y * w + x) * 2]),
	flowOf(f[(y * w + x) * 2 + 1])
];

/** Two pools in a row, 3 wide: columns 0-3 at level 1 above columns 4-7 at level 0. */
const steps = () =>
	map(
		8,
		5,
		(x, y) => y >= 1 && y <= 3,
		(x) => (x < 4 ? 1 : 0)
	);

describe('dropEdges', () => {
	it('gives one edge per shared side of a one-level step', () => {
		const { grid, water, levels } = steps();
		const edges = dropEdges(grid, water, levels, null);
		expect(edges).toHaveLength(3);
		for (const e of edges) {
			expect(e).toMatchObject({ dir: 1, upper: 1, lower: 0, toWater: true });
			expect(e.to).toBe(e.from + 1);
		}
	});

	it('gives an edge where water sits above land, and none where land sits above water', () => {
		const m = map(
			3,
			1,
			(x) => x === 1,
			(x) => (x === 0 ? 3 : x === 1 ? 2 : 0)
		);
		const edges = dropEdges(m.grid, m.water, m.levels, null);
		expect(edges.map((e) => [e.from, e.to, e.upper, e.lower, e.toWater])).toEqual([
			[1, 2, 2, 0, false]
		]);
	});

	it('drops edges toward unknown cells and toward the void, and has none on a flat table', () => {
		const { grid, water, levels } = steps();
		const known = new Uint8Array(8 * 5).fill(1);
		for (let y = 0; y < 5; y++) known[y * 8 + 4] = 0;
		expect(dropEdges(grid, water, levels, known)).toEqual([]);
		const floor = new Uint8Array(8 * 5);
		for (let y = 0; y < 5; y++) floor[y * 8 + 4] = FLOOR_IDS.indexOf('void');
		expect(dropEdges(grid, water, levels, null, floor)).toEqual([]);
		expect(dropEdges(grid, water, null, null)).toEqual([]);
	});

	it('does not list an unexplored water cell as a source', () => {
		const { grid, water, levels } = steps();
		const known = new Uint8Array(8 * 5).fill(1);
		known[1 * 8 + 3] = 0;
		expect(dropEdges(grid, water, levels, known)).toHaveLength(2);
	});
});

describe('flowField', () => {
	it('points downhill at the lip of a fall', () => {
		const { grid, water, levels } = steps();
		const f = flowField(grid, water, levels, null);
		const [x, y] = at(f, 8, 3, 2);
		expect(x).toBeGreaterThan(0.3);
		expect(Math.abs(y)).toBeLessThan(1e-9);
	});

	it('points toward the lower land when a pond sits above it', () => {
		const m = map(
			3,
			3,
			(x, y) => x === 1 && y === 1,
			(x, y) => (x === 1 && y === 1 ? 2 : y === 2 ? 0 : 2)
		);
		const f = flowField(m.grid, m.water, m.levels, null);
		const [x, y] = at(f, 3, 1, 1);
		expect(y).toBeGreaterThan(0);
		expect(Math.abs(x)).toBeLessThan(1e-9);
	});

	it('drifts a flat elongated body along its long axis, toward +x or +y', () => {
		const east = map(10, 5, (x, y) => y >= 1 && y <= 3);
		const fe = flowField(east.grid, east.water, east.levels, null);
		const [x, y] = at(fe, 10, 5, 2);
		expect(x).toBeCloseTo(DRIFT, 1);
		expect(y).toBe(0);
		const south = map(5, 10, (x) => x >= 1 && x <= 3);
		const fs = flowField(south.grid, south.water, south.levels, null);
		const [sx, sy] = at(fs, 5, 2, 5);
		expect(sx).toBe(0);
		expect(sy).toBeCloseTo(DRIFT, 1);
	});

	it('leaves a flat square pond still, and dry and unknown cells too', () => {
		const m = map(7, 7, (x, y) => x >= 1 && x <= 4 && y >= 1 && y <= 4);
		expect(
			Array.from(flowField(m.grid, m.water, m.levels, null)).every((b) => b === FLOW_ZERO)
		).toBe(true);
		const river = map(10, 5, (x, y) => y >= 1 && y <= 3);
		const known = new Uint8Array(50).fill(1);
		known[2 * 10 + 5] = 0;
		const f = flowField(river.grid, river.water, river.levels, known);
		expect(at(f, 10, 5, 2)).toEqual([0, 0]);
		expect(at(f, 10, 5, 0)).toEqual([0, 0]);
	});

	it('takes bodies given, and builds the same ones when it is not', () => {
		const { grid, water, levels } = steps();
		const bodies = waterBodies(grid, water, levels, null);
		expect(bodies.map((b) => [b.level, b.cells.length])).toEqual([
			[1, 12],
			[0, 12]
		]);
		expect(flowField(grid, water, levels, null, bodies)).toEqual(
			flowField(grid, water, levels, null)
		);
	});

	it('is byte-equal between runs', () => {
		const { grid, water, levels } = steps();
		const a = flowField(grid, water, levels, null);
		const b = flowField(grid, water, levels, null);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});
});

describe('flowWeights', () => {
	it('sum to 1, and each is 0 when its own phase wraps', () => {
		for (let p = -2; p <= 2; p += 0.125) {
			const [a, b] = flowWeights(p);
			expect(a + b).toBeCloseTo(1, 12);
			expect(a).toBeGreaterThanOrEqual(0);
			expect(b).toBeGreaterThanOrEqual(0);
		}
		expect(flowWeights(3)[0]).toBe(0); // the first offset, fract(p), wraps at a whole phase
		expect(flowWeights(3.5)[1]).toBe(0); // the second, fract(p + 0.5), a half later
		expect(flowWeights(-0.5)[1]).toBe(0);
	});

	it('hands the weight over smoothly across a wrap', () => {
		const [before] = flowWeights(1 - 1e-6);
		const [after] = flowWeights(1 + 1e-6);
		expect(before).toBeLessThan(1e-5);
		expect(after).toBeLessThan(1e-5);
	});
});

describe('the outdoor stress table', () => {
	const views = JSON.parse(
		readFileSync('tests/fixtures/views/outdoor-64.day.json', 'utf8')
	) as Record<
		'gm' | 'player',
		{ grid: SquareGrid; terrain: string; floor: string; fog: FogView; props: Prop[] }
	>;
	const edgesFor = (who: 'gm' | 'player') => {
		const sent = views[who];
		const size = sent.grid.width * sent.grid.height;
		const floor = decodeFloor(sent.floor, size)!;
		const water = waterCells(sent.grid, floor, sent.props, isLiquidProp);
		const known = knownOf(sent.grid, sent.fog, who === 'gm');
		return dropEdges(sent.grid, water, decodeLevels(sent.terrain, size), known, floor);
	};

	it('has its stepped river fall at two places, three cell sides each', () => {
		const edges = edgesFor('gm');
		expect(edges.map((e) => [e.upper, e.lower, e.dir])).toEqual([
			...Array(3).fill([3, 2, 2]),
			...Array(3).fill([2, 0, 2])
		]);
	});

	it('shows a fogged player no fall toward ground it has not explored', () => {
		expect(edgesFor('player')).toEqual([]);
	});
});
