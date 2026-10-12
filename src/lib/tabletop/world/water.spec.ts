// Water's classes and surfaces (#293): wadeable or deep from `obstaclesFor` and `canStep` alone,
// the Hollow's lake (#294) deep in all three bodies, Blackwater's river wadeable, and the chunks'
// quads at their class's height.

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
import { chunkWater, DEEP_SURFACE, dirtyWaterChunks, WADE_SURFACE } from './water';

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
