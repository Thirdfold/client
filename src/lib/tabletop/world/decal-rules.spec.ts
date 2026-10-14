// Decal rules (M74 #307): determinism, what they ignore (ids, unexplored ground), where they never
// lie, walls dressed alike whatever their id, and props the viewer was never sent.

import { describe, expect, it } from 'vitest';
import { readDecals, type DecalRule } from '$lib/assets/decals';
import { FLOOR_IDS, type FloorId } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { random, randomTable } from './random-table';
import { DECAL_STRIDE, decalsFor, FACE, FLOOR_FACE, type DecalInput } from './decal-rules';
import { MAX_NOISE, MAX_ROUND, worldShape, type ShapeInput } from './shape';

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
const rule = (over: Partial<DecalRule> & Pick<DecalRule, 'decal' | 'where'>): DecalRule => ({
	on: ['default', 'grass', 'stone', 'dirt', 'sand'],
	chance: 1,
	size: [0.5, 0.9],
	...over
});
const RULES: DecalRule[] = [
	rule({ decal: 'grime', where: 'wallFoot', chance: 0.6 }),
	rule({ decal: 'cracks', where: 'open', chance: 0.4 }),
	rule({ decal: 'soot', where: 'wall', beside: ['brazier', 'sconce'] }),
	rule({ decal: 'scorch', where: 'open', beside: ['brazier'] }),
	rule({ decal: 'leaves', where: 'open', beside: ['nature'], outdoor: true })
];

function inputOf(
	shape: Partial<ShapeInput> & { grid: SquareGrid },
	over: Partial<Omit<DecalInput, 'shape'>> = {}
): DecalInput {
	const sent: ShapeInput = { levels: null, floor: null, objects: [], known: null, ...shape };
	return {
		shape: worldShape(sent),
		interior: null,
		props: [],
		environment: 'stone-halls',
		rules: RULES,
		...over
	};
}

type Placed = {
	x: number;
	y: number;
	z: number;
	yaw: number;
	size: number;
	face: number;
	cell: number;
};
/** Every decal, with the cell it lies in (its centre's). */
function placed(input: DecalInput): Placed[] {
	const { width: w, height: h } = input.shape.grid;
	const f = decalsFor(input);
	const out: Placed[] = [];
	for (let k = 0; k < f.length; k += DECAL_STRIDE) {
		const [x, y, z, yaw, size, , , face] = f.subarray(k, k + DECAL_STRIDE);
		const [cx, cy] = [Math.floor(x + w / 2), Math.floor(z + h / 2)];
		out.push({ x, y, z, yaw, size, face, cell: cy * w + cx });
	}
	return out;
}
const asJson = (input: DecalInput) => JSON.stringify([...decalsFor(input)]);
const TABLES = [3, 7, 11, 19].map((seed) => randomTable(seed, 34, 20));

describe('decalsFor', () => {
	it('gives the same decals for the same input, and another environment its own', () => {
		const input = inputOf(TABLES[0]);
		expect(asJson(input)).toBe(asJson(inputOf(TABLES[0])));
		expect(placed(input).length).toBeGreaterThan(20);
		expect(asJson({ ...input, environment: 'cavern' })).not.toBe(asJson(input));
	});

	it('dresses a sealed secret door`s wall exactly as a plain wall', () => {
		const base = { grid: grid(6, 3) };
		const plain = inputOf({ ...base, objects: [wall(1, 1, 5, 1, 'wall-1')] });
		const sealed = inputOf({ ...base, objects: [wall(1, 1, 5, 1, 'secret-door-sealed')] });
		expect(asJson(sealed)).toBe(asJson(plain));
		expect(placed(plain).some((p) => p.face >= 0)).toBe(true);
	});

	it('lays nothing on void, lava, water, unexplored or roofed cells for outdoor rules', () => {
		const floor = Uint8Array.from(
			(['stone', 'void', 'lava', 'water', 'stone', 'stone', 'stone'] as FloorId[]).map(id)
		);
		const known = Uint8Array.from([1, 1, 1, 1, 0, 1, 1]);
		const rules = [
			rule({ decal: 'cracks', where: 'open' }),
			rule({ decal: 'leaves', where: 'open', outdoor: true })
		];
		const input = inputOf(
			{ grid: grid(7, 1), floor, known },
			{ rules, interior: Uint8Array.from([0, 0, 0, 0, 0, 1, 0]) }
		);
		const cells = placed(input).map((p) => p.cell);
		expect(new Set(cells)).toEqual(new Set([0, 5, 6]));
		expect(cells.filter((c) => c === 5)).toHaveLength(1); // cracks only, under the roof
	});

	it('keeps floor decals inside their cell, and in the flat middle by a step or the border', () => {
		const levels = new Uint8Array(25);
		levels[24] = 1; // a step down from (4, 4): cell (3, 3)'s ground rounds toward it
		let roomy = 0;
		for (const env of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
			const input = inputOf(
				{ grid: grid(5, 5), levels },
				{ environment: env, rules: [rule({ decal: 'cracks', where: 'open', size: [1, 1] })] }
			);
			for (const p of placed(input)) {
				const [x, y] = [p.cell % 5, Math.floor(p.cell / 5)];
				// A square turned by its yaw reaches this far along x and along z from its centre.
				const half = (p.size * (Math.abs(Math.cos(p.yaw)) + Math.abs(Math.sin(p.yaw)))) / 2;
				const reach = Math.max(Math.abs(p.x - x + 2), Math.abs(p.z - y + 2)) + half;
				expect(reach).toBeLessThanOrEqual(0.5);
				const flat = x > 0 && y > 0 && x < 4 && y < 4 && !(x === 3 && y === 3);
				if (!flat) expect(reach).toBeLessThanOrEqual(0.5 - MAX_ROUND - MAX_NOISE + 1e-6);
				else if (p.size > 0.5) roomy++;
			}
		}
		expect(roomy).toBeGreaterThan(0);
	});

	it('faces no unexplored cell, and stands on the wall`s face', () => {
		const objects = [wall(1, 0, 1, 1), wall(2, 0, 2, 1)];
		const rules = [rule({ decal: 'grime', where: 'wallFoot' })];
		const at = (known: number[] | null) =>
			placed(
				inputOf({ grid: grid(3, 1), objects, known: known && Uint8Array.from(known) }, { rules })
			);
		const all = at(null);
		expect(all.some((p) => p.cell === 1 && p.face === 1)).toBe(true); // cell 1's east wall
		for (const p of all.filter((p) => p.face === 1))
			expect(p.x - (p.cell - 1)).toBeCloseTo(0.5 - FACE, 5);
		const dark = at([1, 1, 0]);
		expect(dark.every((p) => p.cell < 2 && !(p.cell === 1 && p.face === 1))).toBe(true);
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
			expect(asJson(inputOf(scrambled))).toBe(asJson(inputOf(t)));
		}
	});

	it('leaves no soot or scorch for a brazier the viewer was not sent', () => {
		const base = { grid: grid(5, 5), objects: [wall(0, 1, 5, 1)] };
		const fire = (props: ReturnType<typeof prop>[]) =>
			placed(inputOf(base, { props, rules: RULES.slice(2, 4) }));
		const sent = fire([prop('brazier', 2, 2)]);
		expect(sent.some((p) => p.face === FLOOR_FACE && p.cell === 12)).toBe(true); // under it
		expect(sent.some((p) => p.face === 0)).toBe(true); // soot up the wall behind it
		expect(fire([])).toEqual([]);
		expect(fire([prop('crate', 2, 2)])).toEqual([]);
	});

	it('reads only well-formed rules', () => {
		expect(
			readDecals([
				{ decal: 'moss', where: 'wallFoot', on: ['grass'], chance: 0.5, size: [0.5, 0.8] }
			])
		).toHaveLength(1);
		expect(
			readDecals([{ decal: 'paint', where: 'open', on: ['grass'], chance: 1, size: [0.5, 1] }])
		).toBeNull();
		expect(
			readDecals([{ decal: 'moss', where: 'open', on: ['grass'], chance: 2, size: [0.5, 1] }])
		).toBeNull();
		expect(
			readDecals([{ decal: 'moss', where: 'open', on: ['grass'], chance: 1, size: [0.9, 0.5] }])
		).toBeNull();
	});
});
