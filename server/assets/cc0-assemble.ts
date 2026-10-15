// Glue for the CC0 packs (M76, #333, docs/ASSETS.md "CC0 packs (milestone 76)"): the export the cook
// expects (cook.ts), made from a multi-node, multi-material glTF or GLB that somebody else
// modelled. Nodes are kept or dropped by name, posed (a clip of a skinned figure baked to plain
// meshes, pose-bake.ts), carried to world space, joined by role (`body`, `swing`, `accent`,
// `flame`) and by material (several are kept), turned, scaled to `fit` and set on the floor,
// simplified, and their textures made PNG with power-of-two sides, optionally swapped for a
// surface of the library. UVs outside 0-1 stay as they are, and so do the sampler's repeat wrap;
// KHR_texture_transform is baked into the UVs, since the client honours none.

import {
	Document,
	Logger,
	NodeIO,
	type Material,
	type Node,
	type Texture
} from '@gltf-transform/core';
import { ALL_EXTENSIONS, type Transform } from '@gltf-transform/extensions';
import { prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import path from 'node:path';
import { decodePng, encodePng } from './png';
import { bakePrimitive, poseWorlds, type Pose } from './pose-bake';
import type { Zip } from './zip';

export type Role = 'body' | 'swing' | 'accent' | 'flame';
export interface Image {
	width: number;
	height: number;
	data: Uint8Array;
}
export interface SurfaceMaps {
	color: Image;
	normal?: Image;
	roughness?: Image;
	ao?: Image;
}

/** What `glue` does with a model; the rest of a CC0 model's meta.json is where it comes from. */
export interface GlueMeta {
	/** Node names to keep (everything else goes) and to drop; `*` matches any run of characters. A node is hit by its own name or an ancestor's. */
	keep?: string[];
	drop?: string[];
	/** Nodes that become `swing`, `accent` or `flame`; the rest is `body`. */
	roles?: Partial<Record<Exclude<Role, 'body'>, string[]>>;
	/** Size in cells along x, y, z after the turn; a null axis takes the smallest scale given. */
	fit: (number | null)[];
	/** Quarter turns about y. */
	turn?: number;
	/** The simplifier's target for the body pose's triangles, and its error limit (0.02). */
	triangles: number;
	error?: number;
	/** The pose the model stands in, and the one it lies in when downed (`body_pose1`, a figure's). */
	pose?: Pose;
	downed?: Pose;
	/** Material name → a surface of the library whose maps replace the material's textures. */
	swap?: Record<string, string>;
}

function bad(message: string): never {
	throw new Error(message);
}

const ROLES: Role[] = ['body', 'swing', 'accent', 'flame'];

/** A reader for glTF with Draco-free meshopt sources and every extension we may meet. */
export function cc0Io(): NodeIO {
	return new NodeIO()
		.setLogger(new Logger(Logger.Verbosity.WARN))
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

/**
 * The document of a glTF or GLB `member` of a pack: its buffers and images read from the zip,
 * a bare name looked up in `textures` (a pack that keeps its maps apart from its models),
 * anything else relative to the member.
 */
export async function readMember(
	io: NodeIO,
	zip: Zip,
	member: string,
	textures?: string
): Promise<Document> {
	const bytes = zip.read(member);
	const { json, resources } = member.toLowerCase().endsWith('.glb')
		? splitGlb(bytes)
		: { json: JSON.parse(new TextDecoder().decode(bytes)) as GltfJson, resources: {} };
	const dir = path.posix.dirname(member);
	const find = (uri: string): Uint8Array => {
		const name = decodeURIComponent(uri);
		const tries = [path.posix.normalize(path.posix.join(dir, name))];
		if (textures) tries.push(path.posix.join(textures, path.posix.basename(name)));
		const found = tries.find((t) => zip.has(t));
		if (!found)
			throw new Error(
				`${member} refers to "${uri}", which is not in the pack (${tries.join(', ')})`
			);
		return zip.read(found);
	};
	const files = resources as Record<string, Uint8Array>;
	for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])]) {
		if (ref.uri && !ref.uri.startsWith('data:') && !(ref.uri in files)) {
			files[ref.uri] = new Uint8Array(find(ref.uri));
		}
	}
	return io.readJSON({
		json: json as Parameters<NodeIO['readJSON']>[0]['json'],
		resources: files as Record<string, Uint8Array<ArrayBuffer>>
	});
}

/** The parts of a glTF's JSON this reads: where its files are. */
interface GltfJson {
	buffers?: { uri?: string }[];
	images?: { uri?: string }[];
}

/**
 * A GLB's JSON and binary chunks. (NodeIO.binaryToJSON refuses a GLB whose images are files, as
 * Kenney's are.)
 */
function splitGlb(data: Uint8Array): { json: GltfJson; resources: Record<string, Uint8Array> } {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
		bad('not a GLB (version 2)');
	}
	let json: GltfJson | undefined;
	let bin: Uint8Array | undefined;
	for (let at = 12; at + 8 <= data.length;) {
		const length = view.getUint32(at, true);
		const body = data.subarray(at + 8, at + 8 + length);
		if (view.getUint32(at + 4, true) === 0x4e4f534a)
			json = JSON.parse(new TextDecoder().decode(body));
		else if (view.getUint32(at + 4, true) === 0x004e4942) bin = body;
		at += 8 + length;
	}
	if (!json) bad('a GLB without JSON');
	if (bin && json.buffers?.[0] && !json.buffers[0].uri) json.buffers[0].uri = '@glb.bin';
	return { json, resources: bin ? { '@glb.bin': bin } : {} };
}

const globs = (list: string[] = []) =>
	list.map(
		(g) =>
			new RegExp(
				`^${g
					.split('*')
					.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
					.join('.*')}$`
			)
	);
function hit(res: RegExp[], node: Node): boolean {
	for (let n: Node | null = node; n; n = n.getParentNode()) {
		if (res.some((r) => r.test(n!.getName()))) return true;
	}
	return false;
}

interface Part {
	role: Role;
	pose: number;
	material: Material | null;
	position: Float32Array;
	normal: Float32Array;
	uv: Float32Array | null;
	color: Float32Array | null;
	index: Uint32Array;
}

/** `uv` through a material's KHR_texture_transform (offset, rotation, scale), per the extension. */
function transformUvs(uv: Float32Array, t: Transform): Float32Array {
	const [ox, oy] = t.getOffset();
	const [sx, sy] = t.getScale();
	const [c, s] = [Math.cos(t.getRotation()), Math.sin(t.getRotation())];
	const out = new Float32Array(uv.length);
	for (let i = 0; i < uv.length; i += 2) {
		const [u, v] = [uv[i] * sx, uv[i + 1] * sy];
		out[i] = c * u + s * v + ox;
		out[i + 1] = -s * u + c * v + oy;
	}
	return out;
}

/** Bilinear resample, for a texture whose sides are not powers of two. */
export function resample(img: Image, width: number, height: number): Image {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const fy = Math.min(((y + 0.5) * img.height) / height - 0.5, img.height - 1);
		const y0 = Math.max(0, Math.floor(fy));
		const y1 = Math.min(y0 + 1, img.height - 1);
		const ky = Math.max(0, fy - y0);
		for (let x = 0; x < width; x++) {
			const fx = Math.min(((x + 0.5) * img.width) / width - 0.5, img.width - 1);
			const x0 = Math.max(0, Math.floor(fx));
			const x1 = Math.min(x0 + 1, img.width - 1);
			const kx = Math.max(0, fx - x0);
			for (let c = 0; c < 4; c++) {
				const at = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 4 + c];
				const top = at(x0, y0) * (1 - kx) + at(x1, y0) * kx;
				const bottom = at(x0, y1) * (1 - kx) + at(x1, y1) * kx;
				data[(y * width + x) * 4 + c] = Math.round(top * (1 - ky) + bottom * ky);
			}
		}
	}
	return { width, height, data };
}

/** The largest power of two (at least 4) not over `n`. */
const lowerPow2 = (n: number) => Math.max(4, 2 ** Math.floor(Math.log2(n)));

/** A surface's maps as a material's textures: colour, normal and an ORM (occlusion, roughness, no metal). */
function wear(doc: Document, material: Material, maps: SurfaceMaps): void {
	const png = (name: string, img: Image) =>
		doc
			.createTexture(name)
			.setImage(encodePng(img.width, img.height, img.data))
			.setMimeType('image/png');
	material
		.setBaseColorTexture(png('albedo', maps.color))
		.setBaseColorFactor([1, 1, 1, 1])
		.setNormalTexture(maps.normal ? png('normal', maps.normal) : null)
		.setMetallicFactor(0)
		.setRoughnessFactor(1)
		.setMetallicRoughnessTexture(null)
		.setOcclusionTexture(null);
	if (!maps.roughness && !maps.ao) return;
	const { width, height } = maps.color;
	const rough = maps.roughness && resample(maps.roughness, width, height);
	const ao = maps.ao && resample(maps.ao, width, height);
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data.set([ao ? ao.data[i * 4] : 255, rough ? rough.data[i * 4] : 255, 0, 255], i * 4);
	}
	const orm = png('orm', { width, height, data });
	material.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
}

/**
 * `doc`, a CC0 pack's model, put together as the export the cook expects: `body` (and `swing`,
 * `accent`, `flame` by `meta.roles`, and `body_pose1` for `meta.downed`), one primitive per
 * material, in cells, its base at 0 and its footprint centred. `surfaces` reads a library
 * surface for `meta.swap`. Returns what it did, for the log.
 */
export async function glue(
	doc: Document,
	meta: GlueMeta,
	surfaces?: (id: string) => SurfaceMaps
): Promise<string> {
	await MeshoptSimplifier.ready;
	const root = doc.getRoot();
	if (meta.downed && Object.values(meta.roles ?? {}).some((l) => l?.length)) {
		bad('a model with poses has no swing, accent or flame (only a body)');
	}

	// What the nodes carry: kept or dropped by name, in the role their name gives them.
	const keep = globs(meta.keep);
	const drop = globs(meta.drop);
	const roleOf = Object.fromEntries(
		(['swing', 'accent', 'flame'] as const).map((r) => [r, globs(meta.roles?.[r])])
	);
	const carriers = root
		.listNodes()
		.filter((n) => n.getMesh())
		.filter((n) => (!meta.keep || hit(keep, n)) && !hit(drop, n));
	if (!carriers.length) bad('no mesh is left after keep and drop');

	// Baked at each pose, in world space.
	const poses = [meta.pose ?? {}, ...(meta.downed ? [meta.downed] : [])];
	const parts: Part[] = [];
	poses.forEach((pose, p) => {
		const worlds = poseWorlds(doc, pose);
		for (const node of carriers) {
			const role = ROLES.find((r) => r !== 'body' && hit(roleOf[r], node)) ?? 'body';
			for (const prim of node.getMesh()!.listPrimitives()) {
				if (prim.getMode() !== 4) bad(`${node.getName()}: only triangle meshes`);
				const baked = bakePrimitive(node, prim, worlds);
				if (!baked.normal) bad(`${node.getName()}: a primitive without normals`);
				const count = prim.getAttribute('POSITION')!.getCount();
				const material = prim.getMaterial();
				let uv: Float32Array | null = null;
				const source = prim.getAttribute('TEXCOORD_0');
				if (source) {
					uv = new Float32Array(count * 2);
					const e = [0, 0];
					for (let i = 0; i < count; i++) uv.set(source.getElement(i, e), i * 2);
					const t = material
						?.getBaseColorTextureInfo()
						?.getExtension<Transform>('KHR_texture_transform');
					if (t) uv = transformUvs(uv, t);
				}
				let color: Float32Array | null = null;
				const c0 = prim.getAttribute('COLOR_0');
				if (c0) {
					color = new Float32Array(count * 4).fill(1);
					const e = [0, 0, 0, 1];
					for (let i = 0; i < count; i++) {
						c0.getElement(i, e);
						color.set(c0.getElementSize() === 3 ? [e[0], e[1], e[2], 1] : e, i * 4);
					}
				}
				const indices = prim.getIndices();
				const index = indices
					? Uint32Array.from(indices.getArray()!)
					: Uint32Array.from({ length: count }, (_, i) => i);
				parts.push({
					role,
					pose: p,
					material,
					position: baked.position,
					normal: baked.normal,
					uv,
					color,
					index
				});
			}
		}
	});

	// Turned, then scaled to fit and set on the floor, centred on its footprint; a second pose
	// takes the first's scale and is set down on its own footprint.
	const turns = (((meta.turn ?? 0) % 4) + 4) % 4;
	const [c, s] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1]
	][turns];
	for (const part of parts) {
		for (let i = 0; i < part.position.length; i += 3) {
			for (const a of [part.position, part.normal]) {
				const [x, z] = [a[i], a[i + 2]];
				[a[i], a[i + 2]] = [c * x + s * z, -s * x + c * z];
			}
		}
	}
	const bounds = (pose: number) => {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (const part of parts.filter((q) => q.pose === pose)) {
			for (let i = 0; i < part.position.length; i++) {
				const a = i % 3;
				min[a] = Math.min(min[a], part.position[i]);
				max[a] = Math.max(max[a], part.position[i]);
			}
		}
		return { min, max };
	};
	const first = bounds(0);
	const size = [0, 1, 2].map((a) => first.max[a] - first.min[a]);
	const given = meta.fit.map((f, a) => (f === null ? null : f / size[a]));
	const least = Math.min(...given.filter((v): v is number => v !== null));
	if (!Number.isFinite(least)) bad('fit needs a size along at least one axis');
	const scale = given.map((v) => v ?? least);
	const lengths: number[] = [];
	poses.forEach((_, p) => {
		const b = bounds(p);
		const origin = [(b.max[0] + b.min[0]) / 2, b.min[1], (b.max[2] + b.min[2]) / 2];
		for (const part of parts.filter((q) => q.pose === p)) {
			for (let i = 0; i < part.position.length; i++) {
				const a = i % 3;
				part.position[i] = (part.position[i] - origin[a]) * scale[a];
				part.normal[i] /= scale[a];
			}
			for (let i = 0; i < part.normal.length; i += 3) {
				const l = Math.hypot(part.normal[i], part.normal[i + 1], part.normal[i + 2]) || 1;
				for (let k = 0; k < 3; k++) part.normal[i + k] /= l;
			}
		}
		lengths.push(parts.filter((q) => q.pose === p).reduce((n, q) => n + q.index.length / 3, 0));
	});

	// The new nodes: one mesh per role and pose, one primitive per material.
	const buffer = root.listBuffers()[0] ?? doc.createBuffer();
	const old = [root.listNodes(), root.listMeshes(), root.listSkins(), root.listAnimations()].flat();
	const scene = root.listScenes()[0] ?? doc.createScene();
	for (const extra of root.listScenes().slice(1)) extra.dispose();
	const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', array: Float32Array | Uint32Array) =>
		doc.createAccessor(undefined, buffer).setType(type).setArray(array);
	poses.forEach((_, p) => {
		for (const role of ROLES) {
			const group = parts.filter((q) => q.pose === p && q.role === role);
			if (!group.length) continue;
			const name = p === 0 ? role : `body_pose${p}`;
			const mesh = doc.createMesh(name);
			for (const material of new Set(group.map((q) => q.material))) {
				const same = group.filter((q) => q.material === material);
				const total = (f: (q: Part) => number) => same.reduce((n, q) => n + f(q), 0);
				const position = new Float32Array(total((q) => q.position.length));
				const normal = new Float32Array(position.length);
				const hasUv = same.some((q) => q.uv);
				const hasColor = same.some((q) => q.color);
				const uv = new Float32Array((position.length / 3) * 2);
				const color = new Float32Array((position.length / 3) * 4).fill(1);
				const index = new Uint32Array(total((q) => q.index.length));
				let [v, i] = [0, 0];
				for (const q of same) {
					const count = q.position.length / 3;
					position.set(q.position, v * 3);
					normal.set(q.normal, v * 3);
					if (q.uv) uv.set(q.uv, v * 2);
					if (q.color) color.set(q.color, v * 4);
					for (const k of q.index) index[i++] = k + v;
					v += count;
				}
				const prim = doc
					.createPrimitive()
					.setAttribute('POSITION', accessor('VEC3', position))
					.setAttribute('NORMAL', accessor('VEC3', normal))
					.setIndices(accessor('SCALAR', index))
					.setMaterial(material);
				if (hasUv) prim.setAttribute('TEXCOORD_0', accessor('VEC2', uv));
				if (hasColor) prim.setAttribute('COLOR_0', accessor('VEC4', color));
				mesh.addPrimitive(prim);
			}
			scene.addChild(doc.createNode(name).setMesh(mesh));
		}
	});
	for (const o of old) o.dispose();
	// The cook's own compression comes later: only a material's emissive strength may stay.
	for (const ext of root.listExtensionsUsed()) {
		if (ext.extensionName !== 'KHR_materials_emissive_strength') ext.dispose();
	}
	for (const cam of root.listCameras()) cam.dispose();

	// Materials: opaque (the client draws no blending), swapped for a surface where asked.
	for (const m of root.listMaterials()) {
		m.setAlphaMode('OPAQUE');
	}
	for (const [name, id] of Object.entries(meta.swap ?? {})) {
		const material = root.listMaterials().find((m) => m.getName() === name);
		if (!material)
			bad(
				`swap: no material named "${name}" (it has ${root
					.listMaterials()
					.map((m) => m.getName())
					.join(', ')})`
			);
		if (!surfaces) bad('swap needs the surface library');
		wear(doc, material!, surfaces!(id));
	}
	await doc.transform(prune());
	for (const t of root.listTextures()) fixTexture(t);

	// Every textured model has a normal map (M76); a vertex-coloured one has no texture to pair.
	const flat = root
		.listMaterials()
		.filter((m) => m.getBaseColorTexture() && !m.getNormalTexture())
		.map((m) => m.getName());
	if (flat.length) {
		bad(
			`material ${flat.join(', ')} has a texture but no normal map: every textured model has one`
		);
	}

	const count = lengths[0];
	await doc.transform(weld());
	if (count > meta.triangles) {
		await doc.transform(
			simplify({
				simplifier: MeshoptSimplifier,
				ratio: meta.triangles / count,
				error: meta.error ?? 0.02
			})
		);
	}
	await doc.transform(prune());
	const body = root.listMeshes().find((m) => m.getName() === 'body')!;
	const now = body.listPrimitives().reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
	const after = bounds(0);
	return `${count} → ${now} triangles in the body, ${root.listMaterials().length} material(s), size ${[
		0, 1, 2
	]
		.map((a) => (after.max[a] - after.min[a]).toFixed(2))
		.join(' × ')}`;
}

/** A texture as a PNG with power-of-two sides: the cook halves it to the base and the variants. */
function fixTexture(t: Texture): void {
	const name = t.getName() || t.getURI() || 'a texture';
	if (t.getMimeType() !== 'image/png') {
		throw new Error(
			`texture "${name}" is ${t.getMimeType() || 'unknown'}, not PNG: convert it first`
		);
	}
	const [width, height] = t.getSize() ?? [0, 0];
	const [w, h] = [lowerPow2(width), lowerPow2(height)];
	if (w !== width || h !== height) {
		const r = resample(decodePng(t.getImage()!), w, h);
		t.setImage(encodePng(r.width, r.height, r.data));
	}
}
