// The pipeline's vegetation inputs (#301): wind weights and round normals on part lists, the
// icosphere, decor's limits, the shared noise, flow, ramp and leaf recipes and the leaves'
// coverage-keeping mips; and each environment's wind (#300).

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LIMITS, limitClass } from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { checkGlb, writeGlb } from './glb';
import { gltfProblem } from './gltf-check';
import { bakeModel, readModelSource, type ModelSource } from './models';
import { coverageMips, coverageOf } from './noise';
import { buildAssets, type BuiltAssets } from './pipeline';
import { readTextureSource, recipeSize, renderTexture } from './textures';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

let built: BuiltAssets;
beforeAll(async () => {
	built = await buildAssets('assets');
});

const white = () => '#ffffff';
/** A trunk that stays still and a canopy of two icosphere clumps that sway, one centre. */
const tree: ModelSource = readModelSource(
	{
		parts: [
			{ shape: 'box', size: [0.2, 1, 0.2], at: [0, 0.5, 0], color: '#553311' },
			{
				shape: 'icosphere',
				size: [0.8, 0.6, 0.8],
				at: [-0.2, 1.2, 0],
				color: '#336622',
				wind: 0.8,
				normals: 'sphere',
				centre: [0, 1.3, 0]
			},
			{
				shape: 'icosphere',
				size: [0.8, 0.6, 0.8],
				at: [0.2, 1.4, 0],
				color: '#336622',
				wind: 0.8,
				normals: 'sphere',
				centre: [0, 1.3, 0]
			}
		]
	},
	new Set()
);

/** A GLB's JSON chunk. */
const gltfOf = (glb: Uint8Array) => {
	const length = Buffer.from(glb).readUInt32LE(12);
	return JSON.parse(
		Buffer.from(glb)
			.subarray(20, 20 + length)
			.toString('utf8')
	);
};
const attributesOf = (glb: Uint8Array): string[][] =>
	gltfOf(glb).meshes.map((m: { primitives: { attributes: object }[] }) =>
		Object.keys(m.primitives[0].attributes)
	);

describe('wind weights (#301)', () => {
	it('rise from 0 at a part`s foot to its wind at its top, 0 on parts that don`t sway', () => {
		const [body] = bakeModel(tree, white, true);
		const wind = body.wind!;
		let [trunkTop, crown] = [0, 0];
		for (let i = 0; i < wind.length; i++) {
			const y = body.positions[i * 3 + 1];
			if (y <= 1) trunkTop = Math.max(trunkTop, wind[i]); // the trunk (and the clumps' feet)
			crown = Math.max(crown, wind[i]);
			expect(wind[i]).toBeGreaterThanOrEqual(0);
		}
		expect(crown).toBeCloseTo(0.8);
		expect(trunkTop).toBeLessThan(0.1);
	});

	it('are written beside the bake on props, plants and decor, never on figures', async () => {
		expect(attributesOf(writeGlb(bakeModel(tree, white, true)))[0]).toContain('_WIND');
		expect(attributesOf(writeGlb(bakeModel(tree, white, false)))[0]).not.toContain('_WIND');
		const partLists = (kind: string) =>
			Object.values(built.manifest.models).filter((m) => m.kind === kind && !m.cooked);
		const meshesOf = (file: string) => attributesOf(built.files.get(file)!);
		for (const m of partLists('prop'))
			for (const mesh of meshesOf(m.file)) expect(mesh, m.file).toContain('_WIND');
		for (const kind of ['npc', 'enemy', 'kit'])
			for (const m of partLists(kind))
				for (const mesh of meshesOf(m.file)) expect(mesh, m.file).not.toContain('_WIND');
	});

	it('pass the model check, which still refuses an attribute it doesn`t know', async () => {
		const glb = writeGlb(bakeModel(tree, white, true));
		expect((await checkGlb(glb)).ok).toBe(true);
		const json = gltfOf(glb);
		const bin = json.buffers[0].byteLength;
		expect(gltfProblem(json, bin, LIMITS.prop)).toBeNull();
		const { attributes } = json.meshes[0].primitives[0];
		attributes._SECRET = attributes._WIND;
		expect(gltfProblem(json, bin, LIMITS.prop)).toMatch(/_SECRET/);
	});

	it('load in three.js as `_wind`, in 0..1', async () => {
		const glb = writeGlb(bakeModel(tree, white, true));
		const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
		const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, '');
		const mesh = gltf.scene.getObjectByName('body') as THREE.Mesh;
		const wind = mesh.geometry.getAttribute('_wind');
		let most = 0;
		for (let i = 0; i < wind.count; i++) most = Math.max(most, wind.getX(i));
		expect(most).toBeCloseTo(0.8, 2);
	});
});

describe('clumps (#301)', () => {
	it('merge icosphere parts with box parts into one indexed mesh of 80 triangles a clump', () => {
		const meshes = bakeModel(tree, white, true);
		expect(meshes.map((m) => m.name)).toEqual(['body']);
		const trunk = bakeModel({ parts: [tree.parts[0]] }, white, true)[0];
		expect((meshes[0].indices.length - trunk.indices.length) / 3).toBe(160);
	});

	it('shade as one ball: sphere normals point away from the clump`s centre', () => {
		const [body] = bakeModel(tree, white, true);
		const centre = new THREE.Vector3(0, 1.3, 0);
		const [p, n] = [new THREE.Vector3(), new THREE.Vector3()];
		// The trunk's vertices come first, as its part does.
		const trunk = bakeModel({ parts: [tree.parts[0]] }, white, true)[0].positions.length / 3;
		for (let i = trunk; i < body.positions.length / 3; i++) {
			p.fromArray(body.positions, i * 3);
			n.fromArray(body.normals!, i * 3);
			expect(n.dot(p.sub(centre).normalize())).toBeGreaterThan(0.5);
		}
	});

	it('are checked: wind 0 to 1, sphere normals, a centre only with them', () => {
		const part = { shape: 'icosphere', size: [1, 1, 1], at: [0, 0, 0], color: '#000000' };
		const read = (more: object) => () =>
			readModelSource({ parts: [{ ...part, ...more }] }, new Set());
		expect(read({ wind: 1.5 })).toThrow(/"wind" is 0 to 1/);
		expect(read({ normals: 'flat' })).toThrow(/"normals" is sphere/);
		expect(read({ centre: [0, 1, 0] })).toThrow(/"centre"/);
		expect(read({ normals: 'sphere', centre: [0, 1, 0], wind: 0.5 })).not.toThrow();
	});
});

describe('decor and plants (#301)', () => {
	it('hold decor to its own limits, and accept a plant for a catalogue prop', () => {
		expect(limitClass({ kind: 'decor' })).toBe('decor');
		expect(LIMITS.decor).toMatchObject({ triangles: 300, bytes: 32 * 1024 });
		const manifest = structuredClone(built.manifest);
		manifest.models.tree.kind = 'foliage';
		expect(parseManifest(manifest).ok).toBe(true);
	});
});

describe('the species (#304)', () => {
	const trees = ['tree', 'tree-pine', 'tree-bonsai'];
	const bushes = ['bush', 'bush-tall', 'bush-flowering'];

	it('are translucent foliage models within their budgets', () => {
		for (const id of [...trees, ...bushes]) {
			const entry = built.manifest.models[id];
			expect(entry.kind, id).toBe('foliage');
			expect(entry.triangles, id).toBeLessThanOrEqual(trees.includes(id) ? 6_000 : 2_000);
			expect(entry.translucency, id).toBeGreaterThan(0);
		}
		// `tree` keeps its id and stays lean: Bellweather's download has little to spare.
		expect(built.manifest.models.tree.bytes).toBeLessThan(30 * 1024);
	});

	it('are in the catalogue: trees block sight, bushes movement and take jitter, all 1 x 1', async () => {
		const { ASSETS } = await import('../../src/lib/game/catalog');
		const catalogue: Record<
			string,
			{ w: number; h: number; blocks: string; category: string; jitter?: object }
		> = ASSETS;
		for (const id of [...trees, ...bushes]) {
			expect(catalogue[id], id).toMatchObject({ w: 1, h: 1, category: 'nature' });
			expect(catalogue[id].blocks, id).toBe(trees.includes(id) ? 'sight' : 'movement');
			expect(catalogue[id].jitter !== undefined, id).toBe(bushes.includes(id));
		}
	});

	it('have green clumps with sphere normals: the shader finds a leaf by green over red', () => {
		const source = JSON.parse(readFileSync('assets/models/foliage/tree.json', 'utf8'));
		const clumps = source.parts.filter((p: { shape: string }) => p.shape === 'icosphere');
		expect(clumps.length).toBeGreaterThanOrEqual(5);
		expect(clumps.length).toBeLessThanOrEqual(8);
		for (const part of clumps) {
			expect(part.normals).toBe('sphere');
			const color = new THREE.Color(part.color);
			expect(color.g - color.r, part.color).toBeGreaterThan(0.045);
		}
	});
});

const recipe = (id: string) =>
	readTextureSource(
		JSON.parse(readFileSync(path.join('assets', 'textures', `${id}.json`), 'utf8'))
	);
const SHARED = ['perlin', 'worley', 'curl', 'grass-ramp', 'leaves', 'leaves-normal', 'wind'];

describe('the shared textures (#301)', () => {
	it('render the same bytes every time, at their own size', () => {
		for (const id of SHARED) {
			const source = recipe(id);
			const [w, h] = recipeSize(source, 512);
			const pixels = renderTexture(source);
			expect(pixels.length).toBe(w * h * 4);
			expect(renderTexture(source)).toEqual(pixels);
			expect(built.manifest.textures[id]).toMatchObject({ width: w, height: h });
		}
		expect(built.manifest.textures['grass-ramp']).toMatchObject({ colorSpace: 'srgb', height: 1 });
		for (const id of ['perlin', 'worley', 'curl', 'wind', 'leaves-normal'])
			expect(built.manifest.textures[id].colorSpace).toBe('linear');
	});

	it('tile: across each edge they change no more than between neighbours', () => {
		for (const id of ['perlin', 'worley', 'curl', 'wind']) {
			const source = recipe(id);
			const size = source.size;
			const px = renderTexture(source);
			const at = (x: number, y: number) => px[(y * size + x) * 4];
			let [inside, across] = [0, 0];
			for (let y = 0; y < size; y++) {
				inside = Math.max(
					inside,
					Math.abs(at(1, y) - at(0, y)),
					Math.abs(at(size - 1, y) - at(size - 2, y))
				);
				across = Math.max(
					across,
					Math.abs(at(0, y) - at(size - 1, y)),
					Math.abs(at(y, 0) - at(y, size - 1))
				);
			}
			expect(across, id).toBeLessThanOrEqual(inside + 2);
		}
	});

	it('flow without sources or sinks: curl`s divergence is about 0', () => {
		const source = recipe('curl');
		const size = source.size;
		const px = renderTexture(source);
		const v = (x: number, y: number, c: number) =>
			px[(((y + size) % size) * size + ((x + size) % size)) * 4 + c] / 255 - 0.5;
		let [div, flow] = [0, 0];
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const d = (v(x + 1, y, 0) - v(x - 1, y, 0) + v(x, y + 1, 1) - v(x, y - 1, 1)) / 2;
				div = Math.max(div, Math.abs(d));
				flow += Math.hypot(v(x, y, 0), v(x, y, 1)) / (size * size);
			}
		expect(flow).toBeGreaterThan(0.1);
		expect(div).toBeLessThan(0.01);
	});

	it('keep the leaves` coverage within 2% on every mip of 16 px and up', () => {
		const source = recipe('leaves');
		const levels = coverageMips(renderTexture(source), source.size, 128);
		expect(levels.map((l) => l.size)).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1]);
		const target = coverageOf(levels[0].rgba, 128);
		expect(target).toBeGreaterThan(0.1);
		for (const level of levels.filter((l) => l.size >= 16))
			expect(Math.abs(coverageOf(level.rgba, 128) - target), `${level.size}`).toBeLessThan(0.02);
	});

	it('add under 400 kB to the built assets', () => {
		const bytes = SHARED.reduce((sum, id) => sum + built.manifest.textures[id].bytes, 0);
		expect(bytes).toBeLessThan(400 * 1024);
	});

	it('refuse a data recipe of colour usage, and a ramp of no rows', () => {
		expect(() => readTextureSource({ recipe: 'perlin', size: 64, seed: 1 })).toThrow(/linear/);
		expect(() =>
			readTextureSource({
				recipe: 'ramp',
				width: 64,
				height: 0,
				colors: ['#000000', '#ffffff'],
				seed: 0
			})
		).toThrow(/height/);
		expect(() =>
			readTextureSource({ recipe: 'leaves', size: 64, colors: ['#000000', '#ffffff'], seed: 0 })
		).toThrow(/output/);
	});
});

describe('an environment`s wind (#300)', () => {
	it('is built into the manifest, and still air where an environment gives none', () => {
		expect(built.manifest.environments.village.wind).toEqual({
			direction: 60,
			strength: 0.45,
			gust: 0.5
		});
		const manifest = structuredClone(built.manifest);
		delete manifest.environments.village.wind;
		const parsed = parseManifest(manifest);
		expect(parsed.ok && parsed.manifest.environments.village.wind).toBeUndefined();
		manifest.environments.village.wind = { direction: 60, strength: 2, gust: 0 };
		expect(parseManifest(manifest)).toMatchObject({ ok: false, error: /bad wind/ });
	});

	it('is refused by the pipeline when out of range', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-assets-'));
		try {
			cpSync('assets', dir, { recursive: true });
			const file = path.join(dir, 'environments', 'village.json');
			const env = JSON.parse(readFileSync(file, 'utf8'));
			writeFileSync(
				file,
				JSON.stringify({ ...env, wind: { direction: 400, strength: 0.5, gust: 0 } })
			);
			await expect(buildAssets(dir)).rejects.toThrow(/village\.json: "wind" needs a direction/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
