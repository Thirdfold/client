import { Document, type Material, type Node } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_STYLES } from '../../src/lib/assets/manifest';
import { cc0Io, glue, readMember, resample, type SurfaceMaps } from './cc0-assemble';
import { fetchPinned, hostAllowed, itchDownload, sha256, UNPINNED } from './cc0-fetch';
import { boxNode, glbOf, skinnedStrip, zipOf } from './cc0-fixtures';
import { isCc0, readCc0Meta } from './cc0-meta';
import { checkGlb, normalProblem, writeGlb, type GlbInfo } from './glb';
import { readMeta } from './licence';
import { bakeModel, readModelSource } from './models';
import { buildModels } from './pipeline-models';
import { emitter } from './pipeline-files';
import { decodePng, encodePng } from './png';
import { openZip } from './zip';

const tmp: string[] = [];
const temp = () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-cc0-'));
	tmp.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);
/** Pixels that differ, so prune keeps the texture (it swaps a solid one for its colour). */
const grey = (w: number, h: number, v = 128) =>
	Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : (v + i * 7) % 256));
const png = (w: number, h: number, v = 128) => encodePng(w, h, grey(w, h, v));
/** `material` with a colour map and a normal map: what a textured model needs. */
const withNormal = (doc: Document, material: Material, name: string) =>
	material
		.setBaseColorTexture(doc.createTexture(name).setImage(png(4, 4)).setMimeType('image/png'))
		.setNormalTexture(
			doc
				.createTexture(`${name}-n`)
				.setImage(png(4, 4, 9))
				.setMimeType('image/png')
		);
const u8 = (a: Uint8Array) => new Uint8Array(a);

describe('the zip reader', () => {
	const files = {
		'a/one.txt': bytes('one'.repeat(100)),
		'b/two.bin': bytes('two'),
		'dir/': new Uint8Array()
	};
	const zip = openZip(zipOf(files));

	it('reads deflated and stored members by path, and not the directories', () => {
		expect(zip.names()).toEqual(['a/one.txt', 'b/two.bin']);
		expect(new TextDecoder().decode(zip.read('a/one.txt'))).toBe('one'.repeat(100));
		expect(new TextDecoder().decode(zip.read('b/two.bin'))).toBe('two');
		expect(() => zip.read('c')).toThrow('"c" is not in the zip');
	});

	it('refuses what is not a zip', () => {
		expect(() => openZip(bytes('not a zip at all, just text of some length'))).toThrow('not a zip');
	});
});

describe('hosts and pinned downloads', () => {
	it('lists the hosts one by one: the pack sites, itch.io pages and its mirror, nothing like them', () => {
		for (const h of [
			'kenney.nl',
			'opengameart.org',
			'static.poly.pizza',
			'raw.githubusercontent.com',
			'dl.polyhaven.org'
		]) {
			expect(hostAllowed(h)).toBe(true);
		}
		expect(hostAllowed('sigilsvault.itch.io')).toBe(true);
		expect(hostAllowed('itchio-mirror.example.r2.cloudflarestorage.com')).toBe(true);
		for (const h of [
			'example.com',
			'itch.io.evil.com',
			'evilopengameart.org',
			'cloudflarestorage.com'
		]) {
			expect(hostAllowed(h)).toBe(false);
		}
	});

	const pack = bytes('a pack');
	const url = 'https://kenney.nl/media/pack.zip';

	it('keeps a download by its hash and reads it from there afterwards', async () => {
		const cache = temp();
		const fetchFn = vi.fn(async () => new Response(pack));
		const pin = { url, sha256: sha256(pack) };
		expect(u8(await fetchPinned(pin, { cache, fetchFn }))).toEqual(pack);
		expect(readdirSync(cache)).toEqual([`${pin.sha256}.zip`]);
		await fetchPinned(pin, { cache, fetchFn });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('refuses a hash that differs, a host not listed and a redirect to one, keeping nothing', async () => {
		const cache = temp();
		const fetchFn = vi.fn(async () => new Response(pack));
		await expect(
			fetchPinned({ url, sha256: sha256(bytes('other')) }, { cache, fetchFn })
		).rejects.toThrow("the download's SHA-256 is");
		await expect(
			fetchPinned({ url: 'https://example.com/a.zip', sha256: sha256(pack) }, { cache, fetchFn })
		).rejects.toThrow('not a CC0 host');
		const bounce = vi.fn(
			async () =>
				new Response(null, { status: 302, headers: { location: 'https://example.com/x' } })
		);
		await expect(
			fetchPinned({ url, sha256: sha256(pack) }, { cache, fetchFn: bounce })
		).rejects.toThrow('not a CC0 host');
		expect(readdirSync(cache)).toEqual([]);
	});

	it('follows a redirect between listed hosts, and records the hash of an unpinned file', async () => {
		const cache = temp();
		const fetchFn = vi.fn(async (u: string | URL | Request) =>
			String(u).startsWith('https://github.com')
				? new Response(null, {
						status: 302,
						headers: { location: 'https://codeload.github.com/z' }
					})
				: new Response(pack)
		);
		const record = vi.fn();
		const got = await fetchPinned(
			{ url: 'https://github.com/o/r/archive/c.zip', sha256: UNPINNED },
			{ cache, fetchFn: fetchFn as typeof fetch, record }
		);
		expect(u8(got)).toEqual(pack);
		expect(record).toHaveBeenCalledWith(sha256(pack));
	});

	/** itch.io's four steps, with cookies and csrf tokens checked. */
	const itch = (zip: Uint8Array) =>
		vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
			const url = String(u);
			const headers = new Headers(init?.headers);
			const form = new URLSearchParams(String(init?.body ?? ''));
			if (url === 'https://dev.itch.io/game') {
				return new Response('<input name="csrf_token" value="TOK1">', {
					headers: { 'set-cookie': 'itchio=abc; path=/' }
				});
			}
			if (url === 'https://dev.itch.io/game/download_url') {
				if (headers.get('cookie') !== 'itchio=abc' || form.get('csrf_token') !== 'TOK1') {
					return new Response('no', { status: 403 });
				}
				return Response.json({ url: 'https://dev.itch.io/game/download/xyz' });
			}
			if (url === 'https://dev.itch.io/game/download/xyz') {
				return new Response(
					'<input name="csrf_token" value="TOK2"><a data-upload_id="111"></a><a data-upload_id="222"></a>'
				);
			}
			if (
				url.startsWith('https://dev.itch.io/game/file/222?') &&
				form.get('csrf_token') === 'TOK2'
			) {
				return Response.json({ url: 'https://itchio-mirror.x.r2.cloudflarestorage.com/z?sig=1' });
			}
			if (url.startsWith('https://itchio-mirror.x.r2.cloudflarestorage.com/z'))
				return new Response(zip);
			return new Response('?', { status: 404 });
		}) as unknown as typeof fetch;

	it("takes an itch.io page's pack through its anonymous flow, pinned by hash only", async () => {
		const zip = zipOf({ 'a.txt': bytes('a') });
		expect(u8(await itchDownload('https://dev.itch.io/game', '222', itch(zip)))).toEqual(u8(zip));
		await expect(itchDownload('https://dev.itch.io/game', '999', itch(zip))).rejects.toThrow(
			'upload 999 not found (it has 111, 222)'
		);
		const cache = temp();
		const pin = { url: 'https://dev.itch.io/game', sha256: sha256(zip) };
		await fetchPinned(pin, { cache, upload: '222', fetchFn: itch(zip) });
		expect(readdirSync(cache)).toEqual([`${pin.sha256}.zip`]);
	});
});

describe("a pack model's meta.json", () => {
	const meta = (extra: object = {}) => ({
		provenance: {
			license: 'CC0-1.0',
			author: 'Quaternius',
			source: {
				url: 'https://opengameart.org/sites/default/files/pack.zip',
				sha256: 'a'.repeat(64)
			},
			modified: true
		},
		member: 'Exports/glTF/Anvil.gltf',
		fit: [0.9, null, null],
		triangles: 600,
		...extra
	});

	it('reads the source, the member and how it is glued; a Poly Haven meta (maps) is not one', () => {
		const full = readCc0Meta(
			meta({
				textures: 'Textures',
				keep: ['Knight_*'],
				drop: ['Cap'],
				roles: { accent: ['Lid'] },
				turn: 1,
				error: 0.05,
				pose: { clip: 'Idle', time: 0.5 },
				swap: { Metal: 'cobble' }
			})
		);
		expect(full).toMatchObject({
			member: 'Exports/glTF/Anvil.gltf',
			textures: 'Textures',
			glue: { keep: ['Knight_*'], roles: { accent: ['Lid'] }, pose: { clip: 'Idle', time: 0.5 } }
		});
		expect(isCc0(meta())).toBe(true);
		expect(isCc0({ ...meta(), maps: [] })).toBe(false);
	});

	it('names what is wrong', () => {
		const bad = (extra: object, message: string) =>
			expect(() => readCc0Meta(meta(extra))).toThrow(message);
		bad({ member: undefined }, 'a zip needs "member"');
		bad({ member: 'a.fbx' }, '"member" is a .gltf or .glb path');
		bad({ fit: [1, 1] }, '"fit"');
		bad({ triangles: 3 }, '"triangles"');
		bad({ roles: { body: ['x'] } }, '"roles"');
		bad({ upload: '12' }, '"upload"');
		bad({ pose: { time: -1 } }, 'pose.time');
		bad({ swap: { Metal: 4 } }, '"swap"');
		expect(() => readCc0Meta({ provenance: {} })).toThrow('provenance.source');
		const lone = meta({ member: undefined });
		lone.provenance.source.url = 'https://static.poly.pizza/abc.glb';
		expect(readCc0Meta(lone).member).toBeUndefined();
		lone.provenance.source.url = 'https://static.poly.pizza/abc.gltf';
		expect(() => readCc0Meta(lone)).toThrow('a zip, an itch.io page or a .glb');
	});
});

/** A prop of several nodes: two wood crates (tiled UVs), an iron lid and a marker. */
function crates(): Document {
	const doc = new Document();
	doc.createScene();
	const textured = (name: string) => withNormal(doc, doc.createMaterial(name), name);
	const [wood, iron] = [textured('Wood'), textured('Iron')];
	boxNode(doc, 'Crate_A', wood, [0, 0.5, 0], [1, 1, 1], { tile: 3 });
	boxNode(doc, 'Crate_B', wood, [2, 0.5, 0], [1, 1, 1]);
	boxNode(doc, 'Lid', iron, [0, 1.1, 0], [1, 0.2, 1]);
	boxNode(doc, 'Debug_Marker', wood, [9, 9, 9], [1, 1, 1]);
	return doc;
}

const meshOf = (doc: Document, name: string) =>
	doc
		.getRoot()
		.listNodes()
		.find((n) => n.getName() === name)
		?.getMesh();
const extent = (nodes: Node[]) => {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const n of nodes) {
		for (const p of n.getMesh()!.listPrimitives()) {
			const a = p.getAttribute('POSITION')!;
			const e = [0, 0, 0];
			for (let i = 0; i < a.getCount(); i++) {
				a.getElement(i, e);
				e.forEach((v, k) => ((min[k] = Math.min(min[k], v)), (max[k] = Math.max(max[k], v))));
			}
		}
	}
	return { min, max };
};

describe('gluing a pack model', () => {
	it('drops and roles nodes by name, joins them by material and keeps tiled UVs', async () => {
		const doc = crates();
		await glue(doc, {
			drop: ['Debug*'],
			roles: { accent: ['Lid'] },
			fit: [null, null, 1],
			triangles: 1000
		});
		const nodes = doc.getRoot().listNodes();
		expect(nodes.map((n) => n.getName()).sort()).toEqual(['accent', 'body']);
		const body = meshOf(doc, 'body')!;
		expect(body.listPrimitives()).toHaveLength(1); // both crates, one wood
		expect(body.listPrimitives()[0].getIndices()!.getCount()).toBe(2 * 36);
		expect(meshOf(doc, 'accent')!.listPrimitives()[0].getMaterial()!.getName()).toBe('Iron');
		expect(
			doc
				.getRoot()
				.listMaterials()
				.map((m) => m.getName())
				.sort()
		).toEqual(['Iron', 'Wood']);
		const uv = body.listPrimitives()[0].getAttribute('TEXCOORD_0')!;
		expect(Math.max(...(uv.getArray() as Float32Array))).toBeCloseTo(3); // repeat kept
		// 3 cells wide, its base at 0, its footprint centred (a lid does not widen it).
		const { min, max } = extent(nodes);
		expect(min[1]).toBeCloseTo(0);
		expect([min[0], max[0], min[2], max[2]].map((v) => +v.toFixed(3))).toEqual([
			-1.5, 1.5, -0.5, 0.5
		]);
	});

	it('turns by quarters, scales the free axes like the smallest given, and simplifies to the target', async () => {
		const doc = new Document();
		doc.createScene();
		boxNode(doc, 'Beam', doc.createMaterial('Wood'), [0, 0, 0], [4, 1, 1]);
		await glue(doc, { fit: [null, null, 2], turn: 1, triangles: 100 });
		const { min, max } = extent(doc.getRoot().listNodes());
		expect(max[2] - min[2]).toBeCloseTo(2); // the beam lay along x; turned, along z
		expect(max[0] - min[0]).toBeCloseTo(0.5);
		expect(max[1] - min[1]).toBeCloseTo(0.5);
		await expect(
			glue(crates(), { keep: ['Nothing'], fit: [1, 1, 1], triangles: 100 })
		).rejects.toThrow('no mesh is left');
	});

	it('bakes KHR_texture_transform into the UVs', async () => {
		const doc = new Document();
		doc.createScene();
		const wood = withNormal(doc, doc.createMaterial('Wood'), 't');
		const ext = doc.createExtension(KHRTextureTransform);
		wood
			.getBaseColorTextureInfo()!
			.setExtension(
				'KHR_texture_transform',
				ext.createTransform().setOffset([0.5, 0]).setScale([0.5, 0.25])
			);
		boxNode(doc, 'Crate', wood, [0, 0, 0], [1, 1, 1]);
		await glue(doc, { fit: [1, 1, 1], triangles: 100 });
		const uv = meshOf(doc, 'body')!
			.listPrimitives()[0]
			.getAttribute('TEXCOORD_0')!
			.getArray() as Float32Array;
		expect([Math.min(...uv), Math.max(...uv)].map((v) => +v.toFixed(3))).toEqual([0, 1]);
		const us = Array.from(uv).filter((_, i) => i % 2 === 0);
		const vs = Array.from(uv).filter((_, i) => i % 2 === 1);
		expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([
			0.5, 1, 0, 0.25
		]);
		expect(doc.getRoot().listExtensionsUsed()).toEqual([]);
	});

	it('makes textures PNGs with power-of-two sides, and wears a library surface where asked', async () => {
		const doc = new Document();
		doc.createScene();
		const wood = withNormal(doc, doc.createMaterial('Wood'), 'wood');
		wood.getBaseColorTexture()!.setImage(png(6, 10));
		const iron = doc.createMaterial('Iron');
		boxNode(doc, 'A', wood, [0, 0, 0], [1, 1, 1]);
		boxNode(doc, 'B', iron, [2, 0, 0], [1, 1, 1]);
		const surface: SurfaceMaps = {
			color: { width: 8, height: 8, data: grey(8, 8, 200) },
			normal: { width: 8, height: 8, data: grey(8, 8, 128) },
			roughness: { width: 4, height: 4, data: grey(4, 4, 90) },
			ao: { width: 8, height: 8, data: grey(8, 8, 250) }
		};
		await glue(doc, { fit: [3, null, null], triangles: 100, swap: { Iron: 'cobble' } }, (id) => {
			expect(id).toBe('cobble');
			return surface;
		});
		const worn = doc
			.getRoot()
			.listMaterials()
			.find((m) => m.getName() === 'Iron')!;
		expect(worn.getBaseColorTexture()!.getSize()).toEqual([8, 8]);
		expect(worn.getNormalTexture()).not.toBeNull();
		const orm = worn.getMetallicRoughnessTexture()!;
		expect(orm).toBe(worn.getOcclusionTexture());
		// R occlusion, G roughness (resampled to the colour map's size), no metal.
		expect(Array.from(decodePng(orm.getImage()!).data.subarray(0, 4))).toEqual([250, 90, 0, 255]);
		expect(
			doc
				.getRoot()
				.listMaterials()
				.find((m) => m.getName() === 'Wood')!
				.getBaseColorTexture()!
				.getSize()
		).toEqual([4, 8]);
		await expect(
			glue(crates(), { fit: [1, 1, 1], triangles: 100, swap: { Gold: 'cobble' } }, () => surface)
		).rejects.toThrow('no material named "Gold"');
	});

	it('refuses a textured material without a normal map, and lets a vertex-coloured one by', async () => {
		const doc = new Document();
		doc.createScene();
		const wood = doc
			.createMaterial('Wood')
			.setBaseColorTexture(doc.createTexture('wood').setImage(png(4, 4)).setMimeType('image/png'));
		boxNode(doc, 'A', wood, [0, 0, 0], [1, 1, 1]);
		await expect(glue(doc, { fit: [1, 1, 1], triangles: 100 })).rejects.toThrow(
			'material Wood has a texture but no normal map'
		);
		const flat = new Document();
		flat.createScene();
		boxNode(
			flat,
			'A',
			flat.createMaterial('Paint').setBaseColorFactor([1, 0, 0, 1]),
			[0, 0, 0],
			[1, 1, 1]
		);
		await glue(flat, { fit: [1, 1, 1], triangles: 100 });
	});

	it('refuses a texture that is not a PNG, naming it', async () => {
		const doc = new Document();
		doc.createScene();
		const m = doc.createMaterial('Wood').setBaseColorTexture(
			doc
				.createTexture('wood')
				.setImage(new Uint8Array([0xff, 0xd8, 0xff]))
				.setMimeType('image/jpeg')
		);
		boxNode(doc, 'A', m, [0, 0, 0], [1, 1, 1]);
		await expect(glue(doc, { fit: [1, 1, 1], triangles: 100 })).rejects.toThrow(
			'texture "wood" is image/jpeg, not PNG'
		);
	});

	it("poses a skinned figure: the pose's body, and body_pose1 lying down, on the floor", async () => {
		const doc = skinnedStrip();
		await glue(doc, {
			keep: ['Body'],
			fit: [null, 2, null],
			triangles: 100,
			pose: {},
			downed: { clip: 'Bend', time: 1 }
		});
		const names = doc
			.getRoot()
			.listNodes()
			.map((n) => n.getName());
		expect(names.sort()).toEqual(['body', 'body_pose1']);
		expect(doc.getRoot().listSkins()).toHaveLength(0);
		expect(doc.getRoot().listAnimations()).toHaveLength(0);
		const [body, lying] = ['body', 'body_pose1'].map((n) =>
			extent(
				doc
					.getRoot()
					.listNodes()
					.filter((x) => x.getName() === n)
			)
		);
		expect(body.min[1]).toBeCloseTo(0);
		expect(body.max[1]).toBeCloseTo(2);
		expect(lying.min[1]).toBeCloseTo(0); // the bent strip is set down on its own base
		expect(lying.max[1]).toBeCloseTo(1.5); // 2 high in bind, 1.5 tall once bent, at the same scale
		await expect(
			glue(skinnedStrip(), {
				fit: [null, 2, null],
				triangles: 100,
				downed: {},
				roles: { accent: ['Sword'] }
			})
		).rejects.toThrow('has no swing, accent or flame');
	});

	it('keeps what hangs from a bone with the figure unless it is dropped', async () => {
		const triangles = async (extra: object) => {
			const doc = skinnedStrip();
			await glue(doc, {
				fit: [null, 2, null],
				triangles: 500,
				pose: { clip: 'Bend', time: 1 },
				...extra
			});
			return meshOf(doc, 'body')!
				.listPrimitives()
				.reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
		};
		expect(await triangles({})).toBe(4 + 12);
		expect(await triangles({ drop: ['Sword'] })).toBe(4);
	});

	it('resamples a non-power-of-two image smoothly', () => {
		const ramp = new Uint8Array(3 * 1 * 4);
		[0, 128, 255].forEach((v, i) => ramp.set([v, v, v, 255], i * 4));
		const out = resample({ width: 3, height: 1, data: ramp }, 2, 1);
		expect(out.data[0]).toBeGreaterThan(0);
		expect(out.data[4]).toBeGreaterThan(out.data[0]);
	});
});

describe('reading a model out of a zip', () => {
	/** A prop with its buffer and texture as files, the way Quaternius writes a glTF. */
	async function prop(imageUri: string) {
		const doc = new Document();
		doc.createScene();
		doc.createBuffer().setURI('Prop.bin');
		const wood = doc
			.createMaterial('Wood')
			.setBaseColorTexture(
				doc.createTexture('wood').setImage(png(4, 4)).setMimeType('image/png').setURI('T_Wood.png')
			);
		boxNode(doc, 'Crate', wood, [0, 0, 0], [1, 1, 1]);
		const { json, resources } = await cc0Io().writeJSON(doc);
		(json.images as { uri: string }[])[0].uri = imageUri;
		return {
			json: bytes(JSON.stringify(json)),
			bin: resources['Prop.bin'],
			image: resources['T_Wood.png']
		};
	}

	it('finds a texture in the directory the meta names, or relative to the model, rewriting nothing', async () => {
		const apart = await prop('T_Wood.png'); // the glTF says the bare name; the pack keeps maps in Textures/
		const zip = openZip(
			zipOf({
				'Exports/glTF/Prop.gltf': apart.json,
				'Exports/glTF/Prop.bin': apart.bin,
				'Textures/T_Wood.png': apart.image,
				'Textures/Normals/T_Wood.png': bytes('another file of the same name')
			})
		);
		const io = cc0Io();
		const doc = await readMember(io, zip, 'Exports/glTF/Prop.gltf', 'Textures');
		expect(u8(doc.getRoot().listTextures()[0].getImage()!)).toEqual(u8(apart.image));
		await expect(readMember(io, zip, 'Exports/glTF/Prop.gltf')).rejects.toThrow(
			'"T_Wood.png", which is not in the pack'
		);

		const up = await prop('../../Textures/T_Wood.png');
		const zip2 = openZip(
			zipOf({
				'Exports/glTF/Prop.gltf': up.json,
				'Exports/glTF/Prop.bin': up.bin,
				'Textures/T_Wood.png': up.image
			})
		);
		expect(
			(await readMember(io, zip2, 'Exports/glTF/Prop.gltf')).getRoot().listTextures()
		).toHaveLength(1);
	});

	it('reads a GLB member with an external image the same way (Kenney keeps its palette apart)', async () => {
		const { json, bin } = await prop('Textures/colormap.png');
		const glb = glbOf(JSON.parse(new TextDecoder().decode(json)), bin);
		const zip = openZip(zipOf({ 'GLB/crate.glb': glb, 'GLB/Textures/colormap.png': png(4, 4) }));
		const read = await readMember(cc0Io(), zip, 'GLB/crate.glb');
		expect(read.getRoot().listTextures()[0].getSize()).toEqual([4, 4]);
	});
});

describe('every textured model has a normal map (M76)', () => {
	it('is refused by the cook and the build, but for the characters cooked before the rule', async () => {
		const info = (unnormalled: string[], unmapped: string[] = []) =>
			({ unnormalled, unmapped, cooked: true }) as GlbInfo;
		expect(normalProblem('bed', info(['body']))).toContain(
			'material body has a texture but no normal map'
		);
		expect(normalProblem('bed', info([]))).toBeNull();
		expect(normalProblem('warden', info(['body']))).toBeNull();
		expect(normalProblem('warden', info([], ['body']))).toContain('no UVs');
		// A part list has vertex colours only: nothing textured, nothing to pair.
		const part = { parts: [{ shape: 'sphere', size: [1, 1, 1], at: [0, 0, 0], color: '#808080' }] };
		const glb = writeGlb(bakeModel(readModelSource(part, new Set()), () => '#fff'));
		const checked = await checkGlb(glb);
		expect(checked.ok && checked.info.unnormalled).toEqual([]);
	});
});

describe('the art style', () => {
	it('is realistic or stylised, in a meta.json and in the built manifest entry', async () => {
		const dir = temp();
		const meta = (style: unknown) =>
			writeFileSync(
				path.join(dir, 'meta.json'),
				JSON.stringify({
					provenance: { license: 'LicenseRef-thirdfold-original', author: 'us', modified: false },
					style
				})
			);
		for (const style of ART_STYLES) {
			meta(style);
			expect(readMeta(dir).style).toBe(style);
		}
		meta('cartoon');
		expect(() => readMeta(dir)).toThrow('style is realistic or stylised');

		const at = path.join(dir, 'models', 'prop');
		mkdirSync(at, { recursive: true });
		const part = { parts: [{ shape: 'sphere', size: [1, 1, 1], at: [0, 0, 0], color: '#808080' }] };
		writeFileSync(
			path.join(at, 'm.glb'),
			writeGlb(bakeModel(readModelSource(part, new Set()), () => '#fff'))
		);
		const own = { license: 'LicenseRef-thirdfold-original', author: 'us', modified: false };
		const build = () => buildModels(dir, emitter(new Map()), {});
		writeFileSync(
			path.join(at, 'm.meta.json'),
			JSON.stringify({ provenance: own, style: 'stylised' })
		);
		expect((await build()).m.style).toBe('stylised');
		writeFileSync(path.join(at, 'm.meta.json'), JSON.stringify({ provenance: own }));
		expect((await build()).m.style).toBeUndefined();
		writeFileSync(
			path.join(at, 'm.meta.json'),
			JSON.stringify({ provenance: own, style: 'cartoon' })
		);
		await expect(build()).rejects.toThrow('style is realistic or stylised');
	});
});
