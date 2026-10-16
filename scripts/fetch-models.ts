// The CC0 bridge props (#262, docs/ASSETS.md "CC0 bridge props"): Poly Haven models fetched by
// pinned URL and SHA-256 into art/<kind>/<id>/, which git ignores but for each meta.json, then
// put together as the export the cook expects (<id>.glb): one `body` mesh, flattened, simplified
// to `triangles` (within `error`), turned `turn` quarter turns about y and scaled to `fit` (x, y, z in cells; a null
// axis takes the smallest scale given), its base at y 0 and its footprint centred; one material
// with the colour map as it is, the normal map and the ARM map as the ORM (M76: the scan's own
// look; the cook recolours the colour map through the meta's `ramp` only if it has one, a stylised
// model's choice, docs/ART.md "Palette and values").
// The meta's provenance.source is the glTF; `maps` lists the buffer, the colour map, the ARM
// map and the normal map, each with its URL and SHA-256. By hand, never in CI, under Node 22 (PNG deflate bytes):
//
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/fetch-models.ts [id...]
//   ... --record   write the hash of a file whose meta has none (all zeros)
//
// Only Poly Haven and ambientCG are fetched from (the owner's sources for #262), and, for a meta
// without `maps` (M76, docs/ASSETS.md "CC0 packs (milestone 76)"), the CC0 pack hosts of
// server/assets/cc0-fetch.ts: a zip of a pack (or an itch.io page) is kept by hash in
// art/_packs/, and the model's `member` of it is glued by server/assets/cc0-assemble.ts. A Sketchfab
// model (`source.url` its page, https://sketchfab.com/models/<uid>) is downloaded through the v3
// API with SKETCHFAB_TOKEN, only if the API says its licence is CC0; its glTF archive is the pack.

import { Document, NodeIO, type Mesh, type mat4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
	flatten,
	getBounds,
	join,
	prune,
	compactPrimitive,
	simplify,
	transformMesh,
	weld
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cc0Io, glue, readMember } from '../server/assets/cc0-assemble';
import { fetchPinned as fetchPack, hostAllowed } from '../server/assets/cc0-fetch';
import { isCc0, readCc0Meta, readGlue, surfaceMaps } from '../server/assets/cc0-meta';
import { decodePng, encodePng } from '../server/assets/png';
import { openZip, type Zip } from '../server/assets/zip';

const ART = 'art';
const UNPINNED = '0'.repeat(64);
const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0']);

interface Pinned {
	url: string;
	sha256: string;
}
interface ModelMeta {
	provenance: { source?: Pinned };
	maps?: Pinned[];
	fit: (number | null)[];
	turn?: number;
	triangles: number;
	/** The simplifier's error limit, a share of the mesh's size (0.02 by default). */
	error?: number;
	/** Drop the smallest disconnected shells when simplifying stops short (a scan of many shells,
	 * the statue's). Opt-in: on a modelled prop it deletes whole parts (the bed's mattress). */
	prune?: boolean;
}

// Sketchfab's API token: SKETCHFAB_TOKEN in the environment or in .env (never printed or committed).
if (!process.env.SKETCHFAB_TOKEN && existsSync('.env')) {
	const line = /^SKETCHFAB_TOKEN=(.*)$/m.exec(readFileSync('.env', 'utf8'));
	if (line) process.env.SKETCHFAB_TOKEN = line[1].trim().replace(/^["']|["']$/g, '');
}

const record = process.argv.includes('--record');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const nameOf = (url: string) => path.basename(new URL(url).pathname);

/** One pinned file, fetched into `dir` unless it is there with its hash; null if it fails. */
async function fetchPinned(
	dir: string,
	file: Pinned,
	save: () => void
): Promise<Uint8Array | null> {
	const url = new URL(file.url);
	if (!hostAllowed(url.hostname)) {
		console.error(`${dir}: ${file.url} is not a CC0 host we fetch from`);
		return null;
	}
	const local = path.join(dir, nameOf(file.url));
	let data: Uint8Array | null = existsSync(local) ? readFileSync(local) : null;
	if (!data || sha256(data) !== file.sha256) {
		console.log(`${dir}: fetching ${file.url}`);
		const res = await fetch(file.url, { headers: { 'User-Agent': 'thirdfold' } });
		if (!res.ok) {
			console.error(`${dir}: ${res.status} ${res.statusText}`);
			return null;
		}
		data = new Uint8Array(await res.arrayBuffer());
		writeFileSync(local, data);
	}
	const got = sha256(data);
	if (file.sha256 === UNPINNED && record) {
		file.sha256 = got;
		save();
	} else if (got !== file.sha256) {
		console.error(`${dir}: ${file.url}'s SHA-256 is ${got}, not ${file.sha256}; removed`);
		rmSync(local);
		return null;
	}
	return data;
}

// Column-major 4×4 matrices, as glTF's.
type Mat4 = mat4;
const scaleTranslate = (s: number[], t: number[]): Mat4 => [
	s[0],
	0,
	0,
	0,
	0,
	s[1],
	0,
	0,
	0,
	0,
	s[2],
	0,
	t[0],
	t[1],
	t[2],
	1
];
/** `turns` quarter turns about +y. */
function quarterTurns(turns: number): Mat4 {
	const q = ((turns % 4) + 4) % 4;
	const [c, s] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1]
	][q];
	return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** The colour map as an opaque PNG (the scan's alpha is not used). */
function albedo(diff: Uint8Array): Uint8Array {
	const color = decodePng(diff);
	for (let i = 0; i < color.width * color.height; i++) color.data[i * 4 + 3] = 255;
	return encodePng(color.width, color.height, color.data);
}

/** The export the cook expects, from the fetched glTF, its buffer and maps. */
async function assemble(
	io: NodeIO,
	files: Map<string, Uint8Array>,
	gltfName: string,
	meta: ModelMeta
): Promise<Uint8Array> {
	const json = JSON.parse(new TextDecoder().decode(files.get(gltfName)));
	// The glTF's own JPEG maps aren't fetched: the PNGs replace them.
	const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
	for (const b of json.buffers ?? [])
		resources[b.uri] = new Uint8Array(files.get(path.basename(b.uri))!);
	for (const img of json.images ?? []) resources[img.uri] = new Uint8Array(0);
	const doc: Document = await io.readJSON({ json, resources });
	const root = doc.getRoot();
	for (const t of root.listTextures()) t.dispose();
	for (const e of root.listExtensionsUsed()) e.dispose();
	if (root.listMaterials().length !== 1) throw new Error('needs exactly one material');
	if (root.listSkins().length || root.listAnimations().length)
		throw new Error('no skins or animations');
	for (const c of root.listCameras()) c.dispose();

	// The textures come later, but the UVs must survive until they do.
	await doc.transform(flatten(), join({ keepNamed: false }), prune({ keepAttributes: true }));
	const meshes = root.listNodes().filter((n) => n.getMesh());
	if (meshes.length !== 1) throw new Error(`${meshes.length} meshes after joining, not 1`);
	const node = meshes[0];
	const mesh: Mesh = node.getMesh()!;
	for (const prim of mesh.listPrimitives()) {
		if (!prim.getAttribute('NORMAL')) throw new Error('a primitive without normals');
		for (const s of prim.listSemantics()) if (!KEEP.has(s)) prim.setAttribute(s, null);
	}
	// Simplified to about `triangles`.
	const count = mesh
		.listPrimitives()
		.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
	await doc.transform(weld());
	if (count > meta.triangles) {
		await doc.transform(
			simplify({
				simplifier: MeshoptSimplifier,
				ratio: meta.triangles / count,
				error: meta.error ?? 0.02
			})
		);
		// A scan of many shells (the statue's) stops short of the target: its small pieces cannot
		// collapse, so a pruning pass drops the smallest components to get there.
		const now = mesh.listPrimitives().reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
		if (meta.prune && now > meta.triangles * 1.1) {
			for (const prim of mesh.listPrimitives()) {
				const indices = prim.getIndices()!;
				const share = indices.getCount() / 3 / now;
				const [pruned] = MeshoptSimplifier.simplify(
					Uint32Array.from(indices.getArray()!),
					prim.getAttribute('POSITION')!.getArray() as Float32Array,
					3,
					Math.floor(meta.triangles * share) * 3,
					meta.error ?? 0.02,
					['Prune']
				);
				indices.setArray(pruned);
				compactPrimitive(prim);
			}
		}
	}

	// Turned, then scaled to fit and set on the floor, centred on its footprint.
	transformMesh(mesh, quarterTurns(meta.turn ?? 0));
	const before = getBounds(node);
	const size = [0, 1, 2].map((a) => before.max[a] - before.min[a]);
	const given = meta.fit.map((f, a) => (f === null ? null : f / size[a]));
	const least = Math.min(...given.filter((s): s is number => s !== null));
	const scale = given.map((s) => s ?? least);
	const centre = [0, 1, 2].map((a) => (before.max[a] + before.min[a]) / 2);
	transformMesh(
		mesh,
		scaleTranslate(scale, [-centre[0] * scale[0], -before.min[1] * scale[1], -centre[2] * scale[2]])
	);
	node.setName('body').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
	mesh.setName('body');
	for (const scene of root.listScenes()) {
		for (const child of scene.listChildren()) if (child !== node) child.dispose();
		if (!scene.listChildren().includes(node)) scene.addChild(node);
	}

	// One material, faithful to the scan: the colour map as it is, the normal map (`_nor_gl_`, which
	// every textured model needs, M76) and the ARM map as the ORM (occlusion, roughness, metal)
	// with factors 1, so nothing is baked in or painted over.
	const map = (name: RegExp) => {
		const m = (meta.maps ?? []).find((x) => name.test(nameOf(x.url)));
		return m ? (files.get(nameOf(m.url)) ?? null) : null;
	};
	const [diff, arm, nor] = [/_diff_/, /_arm_/, /_nor_gl_/].map(map);
	if (!diff) throw new Error('the colour map is missing');
	if (!nor) throw new Error('the normal map (_nor_gl_) is missing: every textured model has one');
	if (!arm) throw new Error('the ARM map is missing');
	const png = (name: string, data: Uint8Array) =>
		doc.createTexture(name).setImage(data).setMimeType('image/png');
	const orm = png('orm', arm);
	root
		.listMaterials()[0]
		.setName('body')
		.setBaseColorFactor([1, 1, 1, 1])
		.setAlphaMode('OPAQUE')
		.setDoubleSided(false)
		.setBaseColorTexture(png('albedo', albedo(diff)))
		.setNormalTexture(png('normal', nor))
		.setMetallicRoughnessTexture(orm)
		.setOcclusionTexture(orm)
		.setMetallicFactor(1)
		.setRoughnessFactor(1);
	await doc.transform(prune());
	const after = getBounds(node);
	console.log(
		`  ${count} → ${mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0)} triangles, ` +
			`size ${[0, 1, 2].map((a) => (after.max[a] - after.min[a]).toFixed(2)).join(' × ')}` +
			` (source ${size.map((v) => v.toFixed(2)).join(' × ')} after the turn)`
	);
	return io.writeBinary(doc);
}

/** A Poly Haven model that keeps its nodes (roles, a lid that opens, a fire socket): the glue's. */
const GLUED = [
	'keep',
	'drop',
	'roles',
	'tilt',
	'open',
	'flame',
	'lift',
	'vertexColors',
	'untinted',
	'colour'
];
async function assembleGlued(
	files: Map<string, Uint8Array>,
	gltfName: string,
	meta: ModelMeta
): Promise<Uint8Array> {
	const json = JSON.parse(new TextDecoder().decode(files.get(gltfName)));
	const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
	for (const b of json.buffers ?? [])
		resources[b.uri] = new Uint8Array(files.get(path.basename(b.uri))!);
	for (const img of json.images ?? []) resources[img.uri] = new Uint8Array(0);
	const reader = cc0Io();
	const doc = await reader.readJSON({ json, resources });
	const root = doc.getRoot();
	for (const t of root.listTextures()) t.dispose();
	if (root.listMaterials().length !== 1) throw new Error('needs exactly one material');
	const map = (name: RegExp) => {
		const m = (meta.maps ?? []).find((x) => name.test(nameOf(x.url)));
		return m ? (files.get(nameOf(m.url)) ?? null) : null;
	};
	const [diff, arm, nor] = [/_diff_/, /_arm_/, /_nor_gl_/].map(map);
	if (!diff || !arm || !nor)
		throw new Error('the colour, ARM and normal (_nor_gl_) maps are needed');
	const png = (name: string, data: Uint8Array) =>
		doc.createTexture(name).setImage(data).setMimeType('image/png');
	const orm = png('orm', arm);
	root
		.listMaterials()[0]
		.setBaseColorFactor([1, 1, 1, 1])
		.setBaseColorTexture(png('albedo', albedo(diff)))
		.setNormalTexture(png('normal', nor))
		.setMetallicRoughnessTexture(orm)
		.setOcclusionTexture(orm)
		.setMetallicFactor(1)
		.setRoughnessFactor(1);
	console.log(`  ${await glue(doc, readGlue(meta as unknown as Record<string, unknown>))}`);
	return reader.writeBinary(doc);
}

/**
 * A .blend, or a zip's .fbx with its textures, turned into a GLB by Blender (scripts/blend2glb.py,
 * run with BPY_PYTHON, a Python that has bpy), kept beside the download as <sha256>.converted.glb.
 */
function convertWithBlender(
	bytes: Uint8Array,
	member: string | undefined,
	cache: string
): Uint8Array {
	const out = path.join(cache, `${sha256(bytes)}.converted.glb`);
	if (existsSync(out)) return readFileSync(out);
	const work = mkdtempSync(path.join(tmpdir(), 'thirdfold-convert-'));
	try {
		let input = path.join(work, 'model.blend');
		if (member) {
			const zip = openZip(bytes);
			for (const name of zip.names())
				writeFileSync(path.join(work, path.basename(name)), zip.read(name));
			input = path.join(work, path.basename(member));
		} else {
			writeFileSync(input, bytes);
		}
		const python = process.env.BPY_PYTHON;
		if (!python) throw new Error('"convert" needs BPY_PYTHON: a Python with bpy (pip install bpy)');
		execFileSync(python, ['-I', 'scripts/blend2glb.py', input, out], { stdio: 'inherit' });
		return readFileSync(out);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

/** A CC0 pack model (no `maps`): its pinned download, glued as the export the cook expects. */
const zips = new Map<string, Zip>();
async function assemblePack(dir: string, metaFile: string, meta: ModelMeta) {
	const pack = readCc0Meta(meta);
	const bytes = await fetchPack(pack.source, {
		cache: path.join(ART, '_packs'),
		upload: pack.upload,
		log: (m) => console.log(`${dir}: ${m}`),
		record: record
			? (hash) => {
					meta.provenance.source!.sha256 = hash;
					writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);
				}
			: undefined
	});
	const reader = cc0Io();
	let doc;
	if (pack.convert) {
		const cache = path.join(ART, '_packs');
		mkdirSync(cache, { recursive: true });
		doc = await reader.readBinary(convertWithBlender(bytes, pack.member, cache));
	} else if (pack.member) {
		const key = sha256(bytes);
		if (!zips.has(key)) zips.set(key, openZip(bytes));
		doc = await readMember(reader, zips.get(key)!, pack.member, pack.textures);
	} else {
		doc = await reader.readBinary(bytes);
	}
	const note = await glue(doc, pack.glue, (id) => surfaceMaps(path.join(ART, 'surfaces', id)));
	console.log(`  ${note}`);
	return reader.writeBinary(doc);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
let failed = false;
for (const kind of readdirSync(ART).filter(
	(k) => !['surfaces', 'texture'].includes(k) && !k.startsWith('_')
)) {
	for (const id of readdirSync(path.join(ART, kind)).sort()) {
		const dir = path.join(ART, kind, id);
		const metaFile = path.join(dir, 'meta.json');
		if (!existsSync(metaFile) || (only.length && !only.includes(id))) continue;
		const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as ModelMeta;
		const source = meta.provenance.source;
		if (!source) continue; // not fetched (the great bell is made by a script)
		if (isCc0(meta)) {
			try {
				console.log(`${kind}/${id}:`);
				writeFileSync(path.join(dir, `${id}.glb`), await assemblePack(dir, metaFile, meta));
			} catch (err) {
				console.error(`${dir}: ${(err as Error).message}`);
				failed = true;
			}
			continue;
		}
		if (!meta.maps) continue;
		const save = () => writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);
		const files = new Map<string, Uint8Array>();
		let ok = true;
		for (const file of [source, ...meta.maps]) {
			const data = await fetchPinned(dir, file, save);
			if (data) files.set(nameOf(file.url), data);
			else ok = false;
		}
		if (!ok) {
			failed = true;
			continue;
		}
		try {
			console.log(`${kind}/${id}:`);
			const glued = GLUED.some((k) => k in meta);
			writeFileSync(
				path.join(dir, `${id}.glb`),
				glued
					? await assembleGlued(files, nameOf(source.url), meta)
					: await assemble(io, files, nameOf(source.url), meta)
			);
		} catch (err) {
			console.error(`${dir}: ${(err as Error).message}`);
			failed = true;
		}
	}
}
if (failed) process.exit(1);
