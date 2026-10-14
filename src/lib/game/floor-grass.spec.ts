import { describe, expect, it } from 'vitest';
import {
	decodeGrass,
	encodeGrass,
	grassScales,
	isGrassDensity,
	isGrassHeight,
	knownGrass,
	withGrass
} from './floor';
import type { SquareGrid } from './grid';
import { blankScene, parseSceneFile, SCENE_FILE_VERSION, sharedScene } from './scene-file';

const grid: SquareGrid = { kind: 'square', width: 4, height: 3, cellSize: 1 };

describe('the grass map (M74)', () => {
	it('paints an area, packing density and height, and is null again once all Normal', () => {
		const lush = withGrass(null, grid, { x: 1, y: 0 }, { x: 2, y: 1 }, 'lush', 'tall')!;
		expect([...lush]).toEqual([0, 0x24, 0x24, 0, 0, 0x24, 0x24, 0, 0, 0, 0, 0]);
		expect(grassScales(lush[1])).toEqual({ density: 2.5, height: 1.6 });
		expect(grassScales(0)).toEqual({ density: 1, height: 1 });
		const none = withGrass(lush, grid, { x: 0, y: 0 }, { x: 0, y: 0 }, 'none', 'short')!;
		expect(grassScales(none[0])).toEqual({ density: 0, height: 0.6 });
		expect(lush[0]).toBe(0); // a copy
		expect(withGrass(none, grid, { x: 0, y: 0 }, { x: 3, y: 2 }, 'normal', 'normal')).toBeNull();
	});

	it('round-trips through base64 and refuses a wrong size or an unknown level', () => {
		const map = withGrass(null, grid, { x: 0, y: 0 }, { x: 3, y: 2 }, 'sparse', 'very-tall')!;
		expect(decodeGrass(encodeGrass(map), map.length)).toEqual(map);
		expect(decodeGrass(encodeGrass(map), map.length + 1)).toBeNull();
		expect(decodeGrass('not base64!', 12)).toBeNull();
		expect(decodeGrass(btoa(String.fromCharCode(5)), 1)).toBeNull(); // density 5
		expect(decodeGrass(btoa(String.fromCharCode(0x40)), 1)).toBeNull(); // height 4
	});

	it('masks to the cells a viewer knows', () => {
		const map = withGrass(null, grid, { x: 0, y: 0 }, { x: 3, y: 2 }, 'dense', 'short')!;
		const known = new Uint8Array(12);
		known[5] = 1;
		expect([...knownGrass(map, known)].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([
			5
		]);
		expect(knownGrass(map, null)).toBe(map);
	});

	it('names only its levels', () => {
		expect(['none', 'sparse', 'normal', 'dense', 'lush'].every(isGrassDensity)).toBe(true);
		expect(['short', 'normal', 'tall', 'very-tall'].every(isGrassHeight)).toBe(true);
		expect(isGrassDensity('thick') || isGrassHeight(2) || isGrassDensity('__proto__')).toBe(false);
	});
});

describe('grass in the scene file (v11)', () => {
	const blank = () =>
		JSON.parse(JSON.stringify(blankScene('Meadow', 4, 3, 'village', new Date(0))));

	it('saves it, migrates a v10 file to none, and refuses a damaged map', () => {
		const file = blank();
		expect(file).toMatchObject({ version: SCENE_FILE_VERSION, grass: null });
		const map = withGrass(null, grid, { x: 1, y: 1 }, { x: 2, y: 2 }, 'lush', 'tall')!;
		const painted = parseSceneFile({ ...file, grass: encodeGrass(map) });
		if (!painted.ok) throw new Error(painted.error);
		expect(decodeGrass(painted.scene.grass!, 12)).toEqual(map);
		// All Normal saves as none.
		const plain = parseSceneFile({ ...file, grass: encodeGrass(new Uint8Array(12)) });
		expect(plain.ok && plain.scene.grass).toBeNull();
		const v10 = { ...file, version: 10 };
		delete v10.grass;
		expect(parseSceneFile(v10)).toMatchObject({ ok: true, scene: { version: 11, grass: null } });
		expect(parseSceneFile({ ...file, grass: 'AAAA' })).toEqual({
			ok: false,
			error: 'The grass is not valid.'
		});
		expect(parseSceneFile({ ...file, grass: 7 }).ok).toBe(false);
	});

	it('keeps it when a table is shared: it is the table look', () => {
		const map = withGrass(null, grid, { x: 0, y: 0 }, { x: 0, y: 0 }, 'none', 'normal')!;
		const scene = { ...blankScene('Meadow', 4, 3, null, new Date(0)), grass: encodeGrass(map) };
		expect(sharedScene(scene).grass).toBe(scene.grass);
	});
});
