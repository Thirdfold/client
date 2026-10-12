// Water's classes and surfaces (#293): wadeable or deep from `obstaclesFor` and `canStep` alone,
// the Hollow's lake (#294) deep in all three bodies, Blackwater's river wadeable, and the chunks'
// quads at their class's height; lava's quads (#297) and the waterfalls' (#295).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { isLiquid, type Manifest } from '$lib/assets/manifest';
import { STEP_HEIGHT } from '../ground';
import { chunkWorld } from './cliffs';
import { checkEmitter } from './invariants';
import { knownOf, WATER_BED, worldShape, type WorldShape } from './shape';
import { wadeable, WATER_CLASS, waterCells, waterClasses } from './shore';
import { dropEdges } from './flow';
import {
	chunkFalls,
	chunkWater,
	DEEP_SURFACE,
	dirtyWaterChunks,
	FALL_FRONT,
	surfaceY,
	WADE_SURFACE
} from './water';

const WATER = FLOOR_IDS.indexOf('water');
const manifest = JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')) as Manifest;
const liquid = (assetId: string) => isLiquid(manifest, assetId);
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	width,
	height,
	cellSize: 1
});

/** A 9x9 meadow with a 3x3 pond in its middle, the pond's floor `sunk` levels below the rest. */
function pond(sunk: number, props: Prop[] = [], objects: SceneObject[] = []) {
	const g = grid(9, 9);
	const floor = new Uint8Array(81);
	const levels = new Uint8Array(81).fill(sunk);
	const inPond = (i: number) => Math.abs((i % 9) - 4) <= 1 && Math.abs(Math.floor(i / 9) - 4) <= 1;
	for (let i = 0; i < 81; i++) if (inPond(i)) [floor[i], levels[i]] = [WATER, 0];
	const water = waterCells(g, floor, props, liquid);
	const shape = worldShape({ grid: g, levels, floor, objects, known: null, water });
	return { shape, classes: waterClasses(shape, obstaclesFor(g, objects, props, levels, floor)) };
}
const centre = 4 * 9 + 4;

describe('wadeable water', () => {
	it('is a pond at ground level', () => {
		expect(pond(0).classes[centre]).toBe(WATER_CLASS.wade);
	});

	it('is not a pond sunk two levels: nobody steps down into it', () => {
		expect(pond(2).classes[centre]).toBe(WATER_CLASS.deep);
		expect(pond(1).classes[centre]).toBe(WATER_CLASS.wade); // a step down is a step
	});

	it('is not a pond ringed by props that block', () => {
		const ring: Prop[] = [];
		for (let y = 2; y <= 6; y++)
			for (let x = 2; x <= 6; x++)
				if (Math.max(Math.abs(x - 4), Math.abs(y - 4)) === 2)
					ring.push({ id: `r${x},${y}`, assetId: 'crystal', pos: { x, y }, rotation: 0, scale: 1 });
		expect(pond(0, ring).classes[centre]).toBe(WATER_CLASS.deep);
		const gap = ring.filter((p) => p.pos.x !== 4 || p.pos.y !== 2); // one gap is enough
		expect(pond(0, gap).classes[centre]).toBe(WATER_CLASS.wade);
	});

	it('is decided by `canStep` from known banks only', () => {
		const { shape } = pond(0);
		const g = shape.grid;
		const obstacles = obstaclesFor(g, [], [], shape.levels, shape.floor);
		const body = [...shape.water.keys()].filter((i) => shape.water[i]);
		expect(wadeable(body, shape.water, obstacles, null)).toBe(true);
		// Only the pond known: no bank seen, so it looks deep until one is explored.
		const known = new Uint8Array(81).map((_, i) => shape.water[i]);
		expect(wadeable(body, shape.water, obstacles, known)).toBe(false);
	});
});

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	props: Prop[];
	objects: SceneObject[];
	fog: FogView;
}
const views = (fixture: string) =>
	JSON.parse(readFileSync(`tests/fixtures/views/${fixture}.day.json`, 'utf8')) as Record<
		'gm' | 'player',
		Sent
	>;
function classesOf(
	sent: Sent,
	known: Uint8Array | null = knownOf(sent.grid, sent.fog, true)
): { shape: WorldShape; classes: Uint8Array } {
	const g = sent.grid;
	const n = g.width * g.height;
	const levels = sent.terrain ? decodeLevels(sent.terrain, n) : null;
	const floor = sent.floor ? decodeFloor(sent.floor, n) : null;
	const walls = sent.objects.filter((o) => o.kind === 'wall');
	const water = waterCells(g, floor, sent.props, liquid);
	const shape = worldShape({ grid: g, levels, floor, objects: walls, known, water });
	const obstacles = obstaclesFor(g, walls, sent.props, shape.levels, shape.floor);
	return { shape, classes: waterClasses(shape, obstacles) };
}

describe("the Hollow's lake (#294)", () => {
	const { gm } = views('hollow');
	const { shape, classes } = classesOf(gm);

	it('is the 940 cells at level 0 under its sheets, in three bodies', () => {
		const lake = [...classes.keys()].filter((i) => classes[i]);
		expect(lake.length).toBe(940);
		expect(lake.every((i) => shape.levels[i] === 0)).toBe(true);
		// Three bodies: flood fill over the classes.
		const seen = new Uint8Array(classes.length);
		const w = gm.grid.width;
		let bodies = 0;
		for (const start of lake) {
			if (seen[start]) continue;
			bodies++;
			const stack = [start];
			seen[start] = 1;
			while (stack.length) {
				const i = stack.pop()!;
				for (const j of [i - w, i + w, i % w ? i - 1 : -1, (i + 1) % w ? i + 1 : -1])
					if (j >= 0 && j < classes.length && classes[j] && !seen[j]) {
						seen[j] = 1;
						stack.push(j);
					}
			}
		}
		expect(bodies).toBe(3);
	});

	it('is deep everywhere: nobody climbs out of it or steps off into it', () => {
		expect([...classes].every((c) => c !== WATER_CLASS.wade)).toBe(true);
	});

	it('draws as deep surfaces only, below the shore by its lip', () => {
		const quads = chunkWater(shape, classes, 0);
		expect(quads.wade.positions.length).toBe(0);
		expect(quads.deep.positions.length).toBeGreaterThan(0);
		for (let k = 1; k < quads.deep.positions.length; k += 3)
			expect(quads.deep.positions[k]).toBeCloseTo(-DEEP_SURFACE * STEP_HEIGHT);
	});
});

describe("the outdoor fixture's ponds", () => {
	it('are wadeable at ground level and deep sunk two levels into the meadow', () => {
		const { gm } = views('outdoor-64');
		const { classes } = classesOf(gm);
		const at = (x: number, y: number) => classes[y * gm.grid.width + x];
		expect(at(44, 20)).toBe(WATER_CLASS.wade);
		expect(at(14, 53)).toBe(WATER_CLASS.deep);
		expect(at(10, 47)).toBe(WATER_CLASS.none); // the meadow round it
	});
});

describe('Blackwater`s river', () => {
	const sent = views('ghost-town');

	it('is wadeable, for the GM and for a player who has seen only its west bank', () => {
		// The player has explored up to column 19: the river's x = 18 and 19, not 20 or the void.
		const { width: w, height: h } = sent.gm.grid;
		const west = new Uint8Array(w * h).map((_, i) => (i % w <= 19 ? 1 : 0));
		for (const known of [null, west]) {
			const { shape, classes } = classesOf(sent.gm, known);
			const river = [...classes.keys()].filter((i) => classes[i]);
			expect(river.length).toBeGreaterThan(0);
			expect(river.every((i) => classes[i] === WATER_CLASS.wade)).toBe(true);
			const { wade } = chunkWater(shape, classes, 1);
			for (let k = 1; k < wade.positions.length; k += 3)
				expect(wade.positions[k]).toBeCloseTo(-WADE_SURFACE);
		}
	});
});

describe('the bed', () => {
	it('is the ground under water, half a level down, with banks to it and no other change', () => {
		const { shape } = pond(0);
		const { top, sides } = chunkWorld(shape, 0);
		for (let v = 0; v < top.owners.length; v++) {
			const wet = shape.water[top.owners[v]] === 1;
			expect(top.positions[v * 3 + 1]).toBeCloseTo(wet ? -WATER_BED * STEP_HEIGHT : 0);
		}
		expect(sides.reduce((n, m) => n + m.indices.length, 0)).toBeGreaterThan(0);
		expect(checkEmitter(shape, top)).toEqual([]);
	});
});

describe('the surfaces', () => {
	it('are a quad a cell, reaching under higher ground beside them', () => {
		const { shape, classes } = pond(1);
		const { wade, deep } = chunkWater(shape, classes, 0);
		expect(deep.positions.length).toBe(0);
		expect(wade.indices.length).toBe(9 * 6);
		const xs = [...wade.positions].filter((_, k) => k % 3 === 0);
		// The pond spans cells 3 to 5, x -1.5 to 1.5, and reaches past its banks.
		expect(Math.min(...xs)).toBeLessThan(-1.5);
		expect(Math.max(...xs)).toBeGreaterThan(1.5);
	});

	it('rebuild only the chunks whose water changed, with a cell round them', () => {
		const g = grid(40, 20);
		const shape = worldShape({ grid: g, levels: null, floor: null, objects: [], known: null });
		const a = new Uint8Array(800);
		const b = a.slice();
		b[5 * 40 + 16] = WATER_CLASS.wade; // the first cell of chunk 1, beside chunk 0
		expect(dirtyWaterChunks(shape, a, b)).toEqual([0, 1]);
		expect(dirtyWaterChunks(shape, a, a)).toEqual([]);
		expect(dirtyWaterChunks(shape, null, a)).toEqual([0, 1, 2, 3, 4, 5]);
	});
});

/**
 * A 3-wide river running south down a 3x8 strip: rows 0-2 at level 3, 3-5 at level 2, 6-7 at 0
 * (a step of one, then of two), with terrace land either side at the top level.
 */
function river(known: Uint8Array | null = null) {
	const g = grid(5, 8);
	const floor = new Uint8Array(40);
	const levels = new Uint8Array(40).fill(3);
	for (let y = 0; y < 8; y++)
		for (let x = 1; x <= 3; x++) {
			const i = y * 5 + x;
			[floor[i], levels[i]] = [WATER, y < 3 ? 3 : y < 6 ? 2 : 0];
		}
	const water = waterCells(g, floor, [], liquid);
	const shape = worldShape({ grid: g, levels, floor, objects: [], known, water });
	const classes = waterClasses(shape, obstaclesFor(g, [], [], levels, floor));
	const edges = dropEdges(g, shape.water, shape.levels, known, shape.floor);
	return { g, shape, classes, falls: chunkFalls(shape, classes, edges, 0) };
}

describe('the waterfalls (#295)', () => {
	it('are one quad a run of drop edges, from surface to surface, in front of the edge', () => {
		const { shape, classes, falls } = river();
		expect(falls.falls).toHaveLength(2);
		const [upper, lower] = falls.falls;
		expect(upper.width).toBeCloseTo(3);
		expect(upper.height).toBeCloseTo(surfaceY(shape, classes, 6) - surfaceY(shape, classes, 21));
		expect(lower.height).toBeCloseTo(surfaceY(shape, classes, 21) - surfaceY(shape, classes, 36));
		// The edge between rows 2 and 3 is z = 3 - 4 = -1, the fall a hair south of it.
		expect(upper.pos).toMatchObject({ x: expect.closeTo(0), z: expect.closeTo(-1 + FALL_FRONT) });
		expect(falls.indices).toHaveLength(12);
		expect(falls.uvs).toHaveLength(16);
	});

	it('face the drop: every triangle`s normal agrees with the fall`s', () => {
		const { falls } = river();
		const p = falls.positions;
		for (let t = 0; t < falls.indices.length; t += 3) {
			const [a, b, c] = [0, 1, 2].map((k) => falls.indices[t + k] * 3);
			const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
			const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
			const n = [
				e1[1] * e2[2] - e1[2] * e2[1],
				e1[2] * e2[0] - e1[0] * e2[2],
				e1[0] * e2[1] - e1[1] * e2[0]
			];
			const want = falls.normals.subarray(a, a + 3);
			expect(n[0] * want[0] + n[1] * want[1] + n[2] * want[2]).toBeGreaterThan(0);
		}
	});

	it('never fall toward a cell the viewer has not explored', () => {
		const known = new Uint8Array(40).fill(1);
		for (let i = 30; i < 40; i++) known[i] = 0; // the lowest pool, rows 6-7
		expect(river(known).falls.falls).toHaveLength(1);
	});

	it('never fall from lava, a mesh of its own at deep water`s height', () => {
		const LAVA = FLOOR_IDS.indexOf('lava');
		const g = grid(3, 3);
		const floor = new Uint8Array(9).fill(LAVA);
		const levels = new Uint8Array(9).fill(1);
		levels[2] = 0;
		const water = new Uint8Array(9).fill(1);
		const shape = worldShape({ grid: g, levels, floor, objects: [], known: null, water });
		const classes = new Uint8Array(9).fill(WATER_CLASS.lava);
		const edges = dropEdges(g, shape.water, shape.levels, null, shape.floor);
		expect(edges.length).toBeGreaterThan(0);
		expect(chunkFalls(shape, classes, edges, 0).falls).toEqual([]);
		const quads = chunkWater(shape, classes, 0);
		expect(quads.lava.indices).toHaveLength(9 * 6);
		expect(quads.wade.indices.length + quads.deep.indices.length).toBe(0);
		expect(quads.lava.positions[1]).toBeCloseTo((1 - DEEP_SURFACE) * STEP_HEIGHT);
	});
});
