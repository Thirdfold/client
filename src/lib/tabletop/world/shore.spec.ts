// The shore field (#292): seeds, the chamfer, the boundary rule, and what a viewer was sent.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { obstaclesFor, type Prop } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { isLiquid, type Manifest } from '$lib/assets/manifest';
import { refreshShore, SHORE_MAX, SHORE_TEXELS, shoreField, waterCells } from './shore';
import { knownOf, worldShape, type EdgeMap } from './shape';

const T = SHORE_TEXELS;
/** The liquid props by the built manifest's flag (#294). */
const manifest = JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')) as Manifest;
const isLiquidProp = (assetId: string) => isLiquid(manifest, assetId);
const WATER = FLOOR_IDS.indexOf('water');
const VOID = FLOOR_IDS.indexOf('void');
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	width,
	height,
	cellSize: 1
});
/** The byte for d cells. */
const bytes = (d: number) => Math.round((255 * d) / SHORE_MAX);

/** A map of `w x h` cells, water wherever `wet(x, y)`. */
function lake(w: number, h: number, wet: (x: number, y: number) => boolean) {
	const water = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) water[y * w + x] = wet(x, y) ? 1 : 0;
	return water;
}
type Options = Partial<Parameters<typeof shoreField>[0]>;
const field = (w: number, h: number, water: Uint8Array, o: Options = {}) =>
	shoreField({
		grid: grid(w, h),
		water,
		levels: null,
		solid: null,
		edges: null,
		known: null,
		outside: 'water',
		...o
	});
/** One texel row of the field, for the texel row `ty`. */
const row = (f: Uint8Array, w: number, ty: number) =>
	Array.from(f.subarray(ty * w * T, (ty + 1) * w * T));
const edgeMap = (w: number, h: number): EdgeMap => ({
	h: new Uint8Array(w * (h + 1)),
	v: new Uint8Array((w + 1) * h)
});

describe('the shore field', () => {
	it('is (width x 4) x (height x 4) bytes', () => {
		expect(
			field(
				5,
				3,
				lake(5, 3, () => true)
			).length
		).toBe(5 * T * 3 * T);
	});

	it('peaks at half a cell for one water cell in land', () => {
		const f = field(
			5,
			5,
			lake(5, 5, (x, y) => x === 2 && y === 2)
		);
		const peak = Math.max(...f);
		expect(peak).toBe(bytes(0.5));
		const inCell = (tx: number, ty: number) =>
			tx >= 2 * T && tx < 3 * T && ty >= 2 * T && ty < 3 * T;
		for (let ty = 0; ty < 5 * T; ty++)
			for (let tx = 0; tx < 5 * T; tx++) if (!inCell(tx, ty)) expect(f[ty * 5 * T + tx]).toBe(0);
		// The cell's four middle texels are the farthest, its rim a texel from the land.
		expect(f[(2 * T + 1) * 5 * T + 2 * T + 1]).toBe(peak);
		expect(f[2 * T * 5 * T + 2 * T]).toBe(bytes(0.25));
	});

	it('rises monotonically off a straight beach, and tops out', () => {
		const w = 14;
		const f = field(
			w,
			3,
			lake(w, 3, (x) => x >= 4)
		);
		const r = row(f, w, 5);
		expect(r.slice(0, 4 * T).every((v) => v === 0)).toBe(true);
		for (let i = 4 * T + 1; i < r.length; i++) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
		expect(r[4 * T]).toBe(bytes(0.25));
		expect(r[4 * T + 3]).toBe(bytes(1));
		expect(r[r.length - 1]).toBe(255);
	});

	it('is 0 inside a rock in a lake, with a ring around it', () => {
		const w = 9;
		const solid = new Uint8Array(w * w);
		solid[4 * w + 4] = 1;
		const f = field(
			w,
			w,
			lake(w, w, () => true),
			{ solid }
		);
		for (let ty = 4 * T; ty < 5 * T; ty++)
			expect(row(f, w, ty).slice(4 * T, 5 * T)).toEqual([0, 0, 0, 0]);
		const mid = row(f, w, 4 * T + 1);
		expect(mid[4 * T - 1]).toBe(bytes(0.25));
		expect(mid[5 * T]).toBe(bytes(0.25));
		expect(mid[4 * T - 2]).toBeGreaterThan(mid[4 * T - 1]);
		expect(Math.max(...mid)).toBeLessThanOrEqual(255);
	});

	it('counts the void, walls and level changes between water cells as shore', () => {
		const w = 8;
		const wet = lake(w, w, () => true);
		const floor = new Uint8Array(w * w).fill(WATER);
		floor[3 * w + 3] = VOID;
		const viaVoid = field(w, w, waterCells(grid(w, w), floor, [], isLiquidProp));
		expect(viaVoid[(3 * T + 1) * w * T + 3 * T + 1]).toBe(0);
		expect(viaVoid[(3 * T + 1) * w * T + 3 * T - 1]).toBe(bytes(0.25));

		// A wall along x = 4 (the edge between columns 3 and 4), full height.
		const edges = edgeMap(w, w);
		for (let y = 0; y < w; y++) edges.v[y * (w + 1) + 4] = 1;
		const walled = field(w, w, wet, { edges });
		expect(row(walled, w, 2 * T)[4 * T - 1]).toBe(0);
		expect(row(walled, w, 2 * T)[4 * T]).toBe(0);
		expect(row(walled, w, 2 * T)[4 * T - 2]).toBeGreaterThan(0);

		// Row 4 a level higher: a lip along y = 4.
		const levels = new Uint8Array(w * w);
		for (let i = 4 * w; i < w * w; i++) levels[i] = 1;
		const stepped = field(w, w, wet, { levels });
		expect(row(stepped, w, 4 * T - 1)[2 * T]).toBe(0);
		expect(row(stepped, w, 4 * T)[2 * T]).toBe(0);
		expect(row(stepped, w, 4 * T - 2)[2 * T]).toBeGreaterThan(0);
		// The same level on both sides is no shore.
		expect(Math.min(...field(w, w, wet, { levels: new Uint8Array(w * w) }))).toBe(255);
	});

	it('treats the grid edge by `outside`', () => {
		const wet = lake(3, 3, () => true);
		const shore = field(3, 3, wet, { outside: 'shore' });
		expect(row(shore, 3, 0)[0]).toBe(bytes(0.25));
		expect(row(shore, 3, 0)[1]).toBe(bytes(0.25));
		expect(row(shore, 3, 1)[0]).toBe(bytes(0.25));
		expect(Math.max(...shore)).toBe(bytes(1.5));
		const sea = field(3, 3, wet, { outside: 'water' });
		expect(Array.from(new Set(sea))).toEqual([255]);
	});

	it('is byte-equal across runs', () => {
		const w = 20;
		const wet = lake(w, w, (x, y) => (x * 7 + y * 3) % 5 < 3);
		const a = field(w, w, wet, { outside: 'shore' });
		expect(Buffer.from(field(w, w, wet, { outside: 'shore' })).equals(Buffer.from(a))).toBe(true);
	});

	it('imports no three.js', () => {
		const source = readFileSync(new URL('./shore.ts', import.meta.url), 'utf8');
		const imports = [...source.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1]);
		expect(imports.length).toBeGreaterThan(0);
		expect(imports.filter((i) => /three/.test(i))).toEqual([]);
	});
});

describe('the water cells', () => {
	it('are the water floor and the liquid props` footprints', () => {
		const g = grid(8, 8);
		const floor = new Uint8Array(64);
		floor[0] = WATER;
		const props = [
			{ assetId: 'water', pos: { x: 3, y: 3 }, rotation: 0 },
			{ assetId: 'water-sm', pos: { x: 7, y: 7 }, rotation: 0 },
			{ assetId: 'water-lg', pos: { x: 6, y: 0 }, rotation: 0 }, // runs off the grid
			{ assetId: 'crystal', pos: { x: 1, y: 1 }, rotation: 0 }
		] as const;
		const water = waterCells(g, floor, props, isLiquidProp);
		const at = (x: number, y: number) => water[y * 8 + x];
		expect([at(0, 0), at(3, 3), at(4, 4), at(7, 7), at(6, 0), at(7, 3)]).toEqual([
			1, 1, 1, 1, 1, 1
		]);
		expect([at(1, 1), at(5, 5), at(5, 0)]).toEqual([0, 0, 0]);
	});
});

describe('what the viewer knows', () => {
	it('a lake half unknown has the same field as one fully known', () => {
		const [w, h] = [10, 6];
		const wet = lake(w, h, (x) => x >= 2);
		const known = new Uint8Array(w * h);
		for (let y = 0; y < h; y++) for (let x = 0; x <= 5; x++) known[y * w + x] = 1;
		const half = field(w, h, wet, { known });
		const full = field(w, h, wet);
		expect(Buffer.from(half).equals(Buffer.from(full))).toBe(true);
		// Nothing at the explored edge is shore: it is three cells from the land.
		const edge = row(half, w, 2 * T).slice(5 * T, 6 * T);
		expect(Math.min(...edge)).toBeGreaterThanOrEqual(bytes(3));
		// Unknown ground that reads as plain (not water) seeds nothing either.
		const asSent = lake(w, h, (x) => x >= 2 && x <= 5);
		expect(Buffer.from(field(w, h, asSent, { known })).equals(Buffer.from(half))).toBe(true);
	});

	it('leaves no trace of a hidden rock in a player`s field', () => {
		const [w, h] = [9, 9];
		const g = grid(w, h);
		const floor = new Uint8Array(w * h).fill(WATER);
		const rock: Prop = {
			id: 'rock',
			assetId: 'crystal', // blocks movement: solid
			pos: { x: 4, y: 4 },
			rotation: 0,
			scale: 1,
			hidden: true
		};
		const build = (props: Prop[]) =>
			shoreField({
				grid: g,
				water: waterCells(g, floor, props, isLiquidProp),
				levels: null,
				solid: obstaclesFor(g, [], props, null, floor).solid,
				edges: null,
				known: null,
				outside: 'water'
			});
		const gm = build([rock]); // the GM is sent every prop
		const player = build([rock].filter((p) => !p.hidden)); // viewFor drops a hidden one
		expect(gm[(4 * T + 1) * w * T + 4 * T + 1]).toBe(0);
		expect(Buffer.from(player).equals(Buffer.from(build([])))).toBe(true);
		expect(Math.min(...player)).toBe(255);
	});
});

describe("the shore map's rebuild", () => {
	it('copies the field into the texture`s corner, and only when an input changed', () => {
		const g = grid(3, 2);
		const floor = new Uint8Array(6).fill(WATER);
		const shape = worldShape({ grid: g, levels: null, floor, objects: [], known: null });
		const side = 16;
		const target = {
			texture: { image: { data: new Uint8Array(side * side) }, needsUpdate: false },
			last: [],
			side
		};
		const props: Prop[] = []; // the renderer's array, as it was sent
		let timed = 0;
		const perf = { time: <T>(_: string, fn: () => T) => (timed++, fn()) };
		const run = (backdrop?: string) =>
			refreshShore(target, g, shape, props, backdrop, perf, isLiquidProp);
		run();
		expect(timed).toBe(1);
		expect(target.texture.needsUpdate).toBe(true);
		const data = target.texture.image.data;
		const expected = field(
			3,
			2,
			lake(3, 2, () => true),
			{ outside: 'shore' }
		);
		for (let ty = 0; ty < 2 * T; ty++)
			expect(Array.from(data.subarray(ty * side, ty * side + 3 * T))).toEqual(row(expected, 3, ty));
		expect(data[3 * T]).toBe(0); // beyond the grid's own columns, untouched
		run();
		expect(timed).toBe(1); // idle: nothing changed
		run('sea');
		expect(timed).toBe(2); // the sea runs the water on past the grid
		expect(data[0]).toBe(255);
	});
});

describe('Blackwater`s river', () => {
	interface Sent {
		grid: SquareGrid;
		terrain: string | null;
		floor: string | null;
		props: Prop[];
		fog: FogView;
	}
	const views = JSON.parse(
		readFileSync('tests/fixtures/views/ghost-town.day.json', 'utf8')
	) as Record<'gm' | 'player', Sent>;

	/** The field for a floor and mask, with unexplored cells either as sent or all water. */
	function fieldOf(
		sent: Sent,
		floor: Uint8Array,
		known: Uint8Array | null,
		unknownIsWater: boolean
	) {
		const g = sent.grid;
		const props = sent.props;
		const water = waterCells(g, floor, props, isLiquidProp);
		if (unknownIsWater && known) for (let i = 0; i < water.length; i++) if (!known[i]) water[i] = 1;
		const size = g.width * g.height;
		const levels = sent.terrain ? decodeLevels(sent.terrain, size) : null;
		return shoreField({
			grid: g,
			water,
			levels,
			solid: obstaclesFor(g, [], props, levels, floor).solid,
			edges: null,
			known,
			outside: 'shore'
		});
	}

	it('as the player was sent it equals the field with the unexplored cells as water', () => {
		const sent = views.player;
		const size = sent.grid.width * sent.grid.height;
		const floor = decodeFloor(sent.floor!, size)!;
		const known = knownOf(sent.grid, sent.fog, false)!;
		const a = fieldOf(sent, floor, known, false);
		const b = fieldOf(sent, floor, known, true);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});

	it('across the explored edge equals the field of the whole river', () => {
		const sent = views.gm;
		const { width: w, height: h } = sent.grid;
		const full = decodeFloor(sent.floor!, w * h)!;
		// The player has explored up to column 19: the river's x = 18 and 19, not 20 or the void.
		const known = new Uint8Array(w * h);
		const asSent = new Uint8Array(w * h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x <= 19; x++) {
				known[y * w + x] = 1;
				asSent[y * w + x] = full[y * w + x];
			}
		const a = fieldOf(sent, asSent, known, false);
		const b = fieldOf(sent, asSent, known, true);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
		expect(full[0 * w + 20]).toBe(WATER);
		// Two cells from the bank at x = 17, the explored edge reads as open water, not shore.
		const edge = row(a, w, 2 * T)[20 * T - 1];
		expect(edge).toBeGreaterThanOrEqual(bytes(1.75));
	});
});
