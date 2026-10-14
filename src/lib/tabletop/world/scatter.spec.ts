// Scatter (M74 #305): determinism, what it ignores (ids, unexplored ground), where it never lays,
// the height and footing rules against the world's invariant harness, chunk rebuilds and two
// viewers who know the same cells.

import { describe, expect, it } from 'vitest';
import { TOKEN_DISK } from '$lib/assets/kit';
import { DECOR_FLAT, DECOR_MAX_HEIGHT, type ScatterRule } from '$lib/assets/scatter';
import { FLOOR_IDS, type FloorId } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { checkEmitter, referenceBoxes, type EmitterMesh } from './invariants';
import { random, randomTable } from './random-table';
import {
	DECOR_STRIDE,
	scatter,
	scatterChunk,
	scatterContext,
	scatterDirty,
	thinKey,
	type ChunkDecor,
	type DecorSize,
	type ScatterInput
} from './scatter';
import { CHUNK, INTRUSION, worldShape, type ShapeInput } from './shape';

const id = (name: FloorId) => FLOOR_IDS.indexOf(name);
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const prop = (assetId: Prop['assetId'], x: number, y: number) => ({
	assetId,
	pos: { x, y },
	rotation: 0 as const
});
const wall = (ax: number, ay: number, bx: number, by: number, name = 'w'): SceneObject => ({
	id: name,
	kind: 'wall',
	a: { x: ax, y: ay },
	b: { x: bx, y: by }
});

/** Sizes as the models give them: a tall tuft, flat clover and pebbles, a moss patch, reeds. */
const SIZES: Record<string, DecorSize> = {
	tuft: { height: 0.1, radius: 0.06 },
	clover: { height: 0.017, radius: 0.1 },
	pebbles: { height: 0.019, radius: 0.1 },
	moss: { height: 0.017, radius: 0.13 },
	reeds: { height: 0.136, radius: 0.045 }
};
const rule = (over: Partial<ScatterRule> & Pick<ScatterRule, 'decor' | 'where'>): ScatterRule => ({
	on: ['default', 'grass', 'stone', 'dirt', 'sand'],
	density: 2,
	scale: [0.8, 1.05],
	...over
});
const RULES: ScatterRule[] = [
	rule({ decor: 'clover', where: 'open', density: 3, outdoor: true }),
	rule({ decor: 'tuft', where: 'wallFoot' }),
	rule({ decor: 'moss', where: 'cliffFoot' }),
	rule({ decor: 'pebbles', where: 'cliffTop' }),
	rule({ decor: 'reeds', where: 'shore' }),
	rule({ decor: 'tuft', where: 'voidRim', density: 1 })
];

function inputOf(
	shape: Partial<ShapeInput> & { grid: SquareGrid },
	over: Partial<Omit<ScatterInput, 'shape'>> = {}
): ScatterInput {
	const sent: ShapeInput = { levels: null, floor: null, objects: [], known: null, ...shape };
	return {
		shape: worldShape(sent),
		interior: null,
		props: [],
		environment: 'village',
		rules: RULES,
		sizes: SIZES,
		...over
	};
}

type Placed = { decor: string; x: number; y: number; z: number; yaw: number; s: number; t: number };
/** Every instance, with the cell it lies in. */
function placed(input: ScatterInput, chunks = scatter(input)): (Placed & { cell: number })[] {
	const { width: w, height: h } = input.shape.grid;
	const out: (Placed & { cell: number })[] = [];
	for (const chunk of chunks)
		for (const [decor, f] of chunk)
			for (let k = 0; k < f.length; k += DECOR_STRIDE) {
				const [x, y, z, yaw, s, t] = f.subarray(k, k + DECOR_STRIDE);
				const [cx, cy] = [Math.floor(x + w / 2), Math.floor(z + h / 2)];
				out.push({ decor, x, y, z, yaw, s, t, cell: cy * w + cx });
			}
	return out;
}
const asJson = (chunks: ChunkDecor[]) =>
	JSON.stringify(chunks.map((m) => [...m].map(([k, v]) => [k, [...v]])));

/** Tables with everything: levels, void, water, walls, windows and a fogged viewer. */
const TABLES = [3, 7, 11, 19].map((seed) => randomTable(seed, 34, 20));

describe('scatter', () => {
	it('gives the same decor for the same input, and another environment its own', () => {
		const input = inputOf(TABLES[0]);
		const a = asJson(scatter(input));
		expect(a).toBe(asJson(scatter(inputOf(TABLES[0]))));
		expect(placed(input).length).toBeGreaterThan(20);
		expect(asJson(scatter({ ...input, environment: 'ghost-town' }))).not.toBe(a);
	});

	it('is seeded by the environment, rule and place only, never an id', () => {
		const objects = (name: string): SceneObject[] => [wall(1, 1, 5, 1, name)];
		const base = { grid: grid(6, 3) };
		const plain = scatter(inputOf({ ...base, objects: objects('wall-1') }));
		// A sealed secret door is a wall named `<id>-sealed` until it is found.
		const sealed = scatter(inputOf({ ...base, objects: objects('secret-door-sealed') }));
		expect(asJson(sealed)).toBe(asJson(plain));
		expect(
			placed(inputOf({ ...base, objects: objects('x') })).some((p) => p.decor === 'tuft')
		).toBe(true);
		// The one thing the seed takes besides place is the rule's index (rules, not ids).
		const props = (assetId: Prop['assetId']) => [prop(assetId, 4, 2)];
		const a = asJson(scatter(inputOf({ ...base }, { props: props('table') })));
		expect(a).toBe(asJson(scatter(inputOf({ ...base }, { props: props('table') }))));
	});

	it('lays nothing on void, lava, water, unexplored or covered cells, or roofed ones for outdoor rules', () => {
		const g = grid(8, 1);
		const floor = Uint8Array.from([
			id('grass'),
			id('void'),
			id('lava'),
			id('water'),
			id('grass'),
			id('grass'),
			id('grass'),
			id('grass')
		]);
		const known = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1]);
		const clover = rule({ decor: 'clover', where: 'open', density: 4, outdoor: true });
		const input = inputOf(
			{ grid: g, floor, known },
			{
				rules: [clover],
				props: [prop('rock', 5, 0)],
				interior: Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 0])
			}
		);
		const cells = new Set(placed(input).map((p) => p.cell));
		expect([...cells]).toEqual([0, 7]);
	});

	it('lays nothing toward an unexplored cell', () => {
		const g = grid(3, 1);
		const objects = [wall(1, 0, 1, 1), wall(2, 0, 2, 1)];
		const floor = Uint8Array.from([id('grass'), id('grass'), id('void')]);
		const rules = [
			rule({ decor: 'tuft', where: 'wallFoot' }),
			rule({ decor: 'tuft', where: 'voidRim' })
		];
		const sides = (known: number[] | null) =>
			placed(
				inputOf({ grid: g, objects, floor, known: known && Uint8Array.from(known) }, { rules })
			);
		const open = sides(null);
		expect(open.some((p) => p.cell === 1 && p.x > 0.3)).toBe(true); // the rim and the wall at cell 1's east
		// Cell 1 knows nothing of cell 2: no wall dress and no rim toward it, and none for cell 2.
		const dark = sides([1, 1, 0]);
		expect(dark.every((p) => p.cell < 2 && !(p.cell === 1 && p.x > 0.3))).toBe(true);
		expect(dark.length).toBeGreaterThan(0);
	});

	it('ignores what the table holds under unexplored cells', () => {
		for (const t of TABLES) {
			const known = t.known!;
			const rnd = random(5);
			const scrambled = {
				...t,
				levels: t.levels!.map((l, i) => (known[i] ? l : Math.floor(rnd() * 6))),
				floor: t.floor!.map((f, i) => (known[i] ? f : Math.floor(rnd() * 5)))
			};
			expect(asJson(scatter(inputOf(scrambled)))).toBe(asJson(scatter(inputOf(t))));
		}
	});

	it('puts each rule on its own side of the ground', () => {
		const at = (floor: FloorId[], levels: number[] | null, where: ScatterRule['where']) =>
			placed(
				inputOf(
					{
						grid: grid(floor.length, 1),
						floor: Uint8Array.from(floor.map(id)),
						levels: levels && Uint8Array.from(levels)
					},
					{ rules: [rule({ decor: 'tuft', where, density: 4 })] }
				)
			);
		// Shore: the bank beside water, toward the water (cell 0 of two is centred on x = -0.5).
		const shore = at(['grass', 'water'], null, 'shore');
		expect(shore.length).toBeGreaterThan(0);
		expect(shore.every((p) => p.cell === 0 && p.x > -0.5)).toBe(true);
		// A void's rim is the walkable side.
		expect(at(['grass', 'void'], null, 'voidRim').every((p) => p.cell === 0)).toBe(true);
		expect(at(['grass', 'void'], null, 'voidRim').length).toBeGreaterThan(0);
		// A cliff's foot is the low cell, its top the high one; one level is a step: neither.
		expect(new Set(at(['grass', 'grass'], [0, 2], 'cliffFoot').map((p) => p.cell))).toEqual(
			new Set([0])
		);
		expect(new Set(at(['grass', 'grass'], [0, 2], 'cliffTop').map((p) => p.cell))).toEqual(
			new Set([1])
		);
		expect(at(['grass', 'grass'], [0, 1], 'cliffTop')).toEqual([]);
		// Lava is not a shore.
		expect(at(['grass', 'lava'], null, 'shore')).toEqual([]);
	});

	it('lays besideProp round a prop of the asset or category, never on it', () => {
		const around = (beside: string) =>
			new Set(
				placed(
					inputOf(
						{ grid: grid(5, 5) },
						{
							rules: [rule({ decor: 'tuft', where: 'besideProp', beside, density: 4 })],
							props: [prop('tree', 2, 2)]
						}
					)
				).map((p) => p.cell)
			);
		const ring = [6, 7, 8, 11, 13, 16, 17, 18];
		expect([...around('nature')].sort((a, b) => a - b)).toEqual(ring);
		expect([...around('tree')].sort((a, b) => a - b)).toEqual(ring);
		expect(around('furniture').size).toBe(0);
	});
});

describe('scatter heights and footing', () => {
	const cap = (size: DecorSize, r: ScatterRule) => size.height * r.scale[1];

	it('keeps every instance under the height cap on walkable cells', () => {
		for (const r of RULES) expect(cap(SIZES[r.decor], r)).toBeLessThanOrEqual(DECOR_MAX_HEIGHT);
		for (const t of TABLES)
			for (const p of placed(inputOf(t))) {
				const h = SIZES[p.decor].height * p.s;
				expect(h).toBeLessThanOrEqual(DECOR_MAX_HEIGHT);
			}
	});

	it('keeps decor taller than DECOR_FLAT out of a token footing, and lets flat decor lie in it', () => {
		const reach = TOKEN_DISK - INTRUSION;
		let tall = 0;
		let underBase = 0;
		for (const t of TABLES) {
			const input = inputOf(t, { rules: RULES.map((r) => ({ ...r, density: 4 })) });
			const { width: w, height: h } = input.shape.grid;
			for (const p of placed(input)) {
				const size = SIZES[p.decor];
				const [cx, cz] = [(p.cell % w) + 0.5 - w / 2, Math.floor(p.cell / w) + 0.5 - h / 2];
				const away = Math.hypot(p.x - cx, p.z - cz);
				if (size.height * p.s > DECOR_FLAT) {
					tall++;
					expect(away - size.radius * p.s).toBeGreaterThanOrEqual(reach - 1e-6);
				} else if (away < reach) underBase++;
			}
		}
		expect(tall).toBeGreaterThan(50);
		expect(underBase).toBeGreaterThan(20);
	});

	it('passes the world invariants as boxes round every tall instance', () => {
		let boxCount = 0;
		for (const t of TABLES) {
			const input = inputOf(t, { rules: RULES.map((r) => ({ ...r, density: 4 })) });
			const { shape } = input;
			const boxes: number[][] = [];
			const owners: number[] = [];
			for (const p of placed(input)) {
				const size = SIZES[p.decor];
				if (size.height * p.s <= DECOR_FLAT) continue;
				// The box inside the decor's circle: its footprint's radius is the decor's.
				const half = (size.radius * p.s) / Math.SQRT2;
				const top = p.y + size.height * p.s;
				for (const dy of [p.y, top])
					for (const [sx, sz] of [
						[-1, -1],
						[1, -1],
						[1, 1],
						[-1, 1]
					]) {
						boxes.push([p.x + sx * half, dy, p.z + sz * half]);
						owners.push(p.cell);
					}
			}
			const idx: number[] = [];
			for (let b = 0; b < boxes.length; b += 8) {
				const quad = (a: number, c: number, d: number, e: number) =>
					idx.push(b + a, b + c, b + d, b + a, b + d, b + e);
				quad(0, 1, 2, 3);
				quad(4, 5, 6, 7);
				quad(0, 1, 5, 4);
				quad(1, 2, 6, 5);
				quad(2, 3, 7, 6);
				quad(3, 0, 4, 7);
			}
			const mesh: EmitterMesh = {
				positions: Float32Array.from(boxes.flat()),
				indices: Uint32Array.from(idx),
				owners: Int32Array.from(owners)
			};
			boxCount += boxes.length;
			expect(checkEmitter(shape, referenceBoxes(shape), mesh)).toEqual([]);
		}
		expect(boxCount).toBeGreaterThan(0);
	});

	it('carries a thinning key in the tint that is not the colour', () => {
		const tints = placed(inputOf(TABLES[0])).map((p) => p.t);
		const keys = tints.map(thinKey);
		expect(keys.every((k) => k >= 0 && k < 1)).toBe(true);
		const kept = keys.filter((k) => k < 0.5).length / keys.length;
		expect(kept).toBeGreaterThan(0.35);
		expect(kept).toBeLessThan(0.65);
		// The coarse bits (the colour) do not follow the key.
		const low = tints.filter((_, i) => keys[i] < 0.5);
		expect(low.reduce((a, b) => a + b, 0) / low.length).toBeGreaterThan(0.4);
	});
});

describe('scatter chunks', () => {
	const big = (floor?: Uint8Array) =>
		inputOf({ grid: grid(40, 40), floor: floor ?? new Uint8Array(1600).fill(id('grass')) });

	it('a chunk rebuilt alone equals the same chunk of a full rebuild', () => {
		const input = inputOf(TABLES[1]);
		const all = scatter(input);
		const ctx = scatterContext(input);
		for (let c = 0; c < all.length; c++)
			expect(asJson([scatterChunk(input, c, ctx)])).toBe(asJson([all[c]]));
		expect(asJson([scatterChunk(input, 2)])).toBe(asJson([all[2]]));
	});

	it('names only the touched chunks when ground is painted, every chunk for anything else', () => {
		const a = big();
		const floor = new Uint8Array(1600).fill(id('grass'));
		floor[20 * 40 + 20] = id('wood'); // takes no rule: its clover goes
		const b = {
			...a,
			shape: worldShape({ grid: a.shape.grid, levels: null, floor, objects: [], known: null })
		};
		const dirty = scatterDirty(a, { ...b, props: a.props, rules: a.rules, sizes: a.sizes });
		expect(dirty).toEqual([4]);
		// The result for the clean chunks is what it was; the dirty one changed.
		const [was, now] = [scatter(a), scatter({ ...b, props: a.props })];
		for (let c = 0; c < was.length; c++)
			expect(asJson([now[c]]) === asJson([was[c]])).toBe(!dirty.includes(c));
		expect(scatterDirty(a, { ...a, props: [prop('rock', 3, 3)] })).toHaveLength(9);
		expect(scatterDirty(null, a)).toHaveLength(9);
		expect(scatterDirty(a, a)).toEqual([]);
		// A new wall dirties the chunks of its two sides.
		const walled = worldShape({
			grid: a.shape.grid,
			levels: null,
			floor: null,
			objects: [wall(15, 3, 17, 3)],
			known: null
		});
		const plain = {
			...a,
			shape: worldShape({ grid: a.shape.grid, levels: null, floor: null, objects: [], known: null })
		};
		expect(scatterDirty(plain, { ...plain, shape: walled })).toEqual([0, 1]);
		expect(CHUNK).toBe(16);
	});

	it('draws the same for two viewers who know the same cells round it', () => {
		const t = randomTable(23, 34, 20);
		const truth = { ...t, known: null };
		const knowing = (seed: number) => {
			const rnd = random(seed);
			const known = new Uint8Array(34 * 20).map(() => (rnd() < 0.97 ? 1 : 0));
			return inputOf({ ...truth, known });
		};
		const [a, b] = [knowing(1), knowing(2)];
		const surround = (input: ScatterInput, i: number) => {
			const { width: w, height: h } = input.shape.grid;
			const [x, y] = [i % w, Math.floor(i / w)];
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const [nx, ny] = [x + dx, y + dy];
					if (nx >= 0 && ny >= 0 && nx < w && ny < h && !input.shape.known![ny * w + nx])
						return false;
				}
			return true;
		};
		const byCell = (input: ScatterInput) => {
			const m = new Map<number, string[]>();
			for (const p of placed(input)) m.set(p.cell, [...(m.get(p.cell) ?? []), JSON.stringify(p)]);
			return m;
		};
		const [ma, mb] = [byCell(a), byCell(b)];
		let shared = 0;
		for (let i = 0; i < 34 * 20; i++) {
			if (!surround(a, i) || !surround(b, i)) continue;
			shared++;
			expect(ma.get(i) ?? []).toEqual(mb.get(i) ?? []);
		}
		expect(shared).toBeGreaterThan(100);
		expect([...ma.values()].flat().length).toBeGreaterThan(0);
	});
});
