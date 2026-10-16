// The kits' trim (M76, docs/ASSETS.md "The kits' trim"): the pieces of The Hollow Bell's four
// environments (village, stone halls, cavern, living cave) that are not walls of their own
// surface: frames, posts, caps, plinths, steps, railings, bridges, roof caps, chimneys and
// dormers, proportioned as the real work is (scripts/kits/trim/) and laid on the library's
// realistic surfaces, plus the door leaves, which are CC0 models of their own (art/kit/<id>/meta.json,
// fetched by scripts/fetch-models.ts). Written the same bytes every run on Node 22:
//   npx tsx scripts/make-kits.ts
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-stone-halls-art.ts
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-kit-trim.ts
// then `npm run assets:cook` and `npm run assets`. The GLBs are gitignored (/art/kit/*/*); only the
// meta.json files are committed. Each kit module says which kit file it patches, which roles it
// replaces and which models of other sources (CC0 door leaves) stand in the rest.

import { Document, NodeIO } from '@gltf-transform/core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import type * as THREE from 'three';
import { json } from '../server/assets/pipeline-files';
import type { KitPiece, KitRole } from '../src/lib/assets/kit';
import { buildPiece, type Piece } from './kits/trim/piece';
import { trims } from './kits/trim/all';

const PROVENANCE = {
	license: 'LicenseRef-thirdfold-original',
	author: 'thirdfold contributors',
	modified: false
};

function glb(geometry: THREE.BufferGeometry, material?: string): Promise<Uint8Array> {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const attr = (key: string, type: 'VEC2' | 'VEC3') =>
		doc
			.createAccessor()
			.setBuffer(buffer)
			.setType(type)
			.setArray(new Float32Array(geometry.getAttribute(key).array));
	const index = geometry.getIndex()!.array;
	const count = geometry.getAttribute('position').count;
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', attr('position', 'VEC3'))
		.setAttribute('NORMAL', attr('normal', 'VEC3'))
		.setIndices(
			doc
				.createAccessor()
				.setBuffer(buffer)
				.setType('SCALAR')
				.setArray(count > 65535 ? new Uint32Array(index) : new Uint16Array(index))
		)
		.setMaterial(
			doc
				.createMaterial(material ?? 'trim')
				.setRoughnessFactor(0.85)
				.setMetallicFactor(0)
		);
	if (geometry.getAttribute('uv')) prim.setAttribute('TEXCOORD_0', attr('uv', 'VEC2'));
	if (geometry.getAttribute('color')) prim.setAttribute('COLOR_0', attr('color', 'VEC3'));
	// Blender names mesh data apart from its object: the cook renames it to the node's role.
	doc
		.createScene('Scene')
		.addChild(doc.createNode('body').setMesh(doc.createMesh('body.001').addPrimitive(prim)));
	return new NodeIO().writeBinary(doc);
}

/** The greybox part lists a trim piece took the place of: dropped once no kit names them. */
const replaced = new Set<string>();
const meta = (value: object) => json({ provenance: PROVENANCE, ...value });

for (const trim of trims()) {
	const file = path.join('assets', 'kits', `${trim.kit}.json`);
	const kit = JSON.parse(readFileSync(file, 'utf8'));
	const byRole = new Map<KitRole, KitPiece[]>();
	const add = (role: KitRole, entry: KitPiece) =>
		byRole.set(role, [...(byRole.get(role) ?? []), entry]);
	for (const piece of trim.pieces as Piece[]) {
		const dir = path.join('art', 'kit', piece.id);
		mkdirSync(dir, { recursive: true });
		const geometry = buildPiece(piece);
		writeFileSync(path.join(dir, `${piece.id}.glb`), await glb(geometry, piece.sheet?.material));
		writeFileSync(
			path.join(dir, 'meta.json'),
			meta({
				lockBorder: true,
				...(piece.sheet ? { materials: [piece.sheet.material] } : {})
			})
		);
		for (const role of [piece.role, ...(piece.also ?? [])])
			add(role, {
				model: piece.id,
				...(piece.weight ? { weight: piece.weight } : {}),
				...(piece.sockets ? { sockets: piece.sockets } : {})
			});
	}
	for (const [role, list] of Object.entries(trim.external ?? {})) {
		for (const e of list!) add(role as KitRole, e);
	}
	for (const [role, list] of byRole) {
		for (const old of kit.pieces[role] ?? []) replaced.add(old.model);
		kit.pieces[role] = list;
	}
	const config = (await resolveConfig(file)) ?? {};
	writeFileSync(file, await format(JSON.stringify(kit), { ...config, parser: 'json' }));
	console.log(`${trim.kit}: ${trim.pieces.length} pieces, ${byRole.size} roles`);
}

// The greybox models no kit names any more go from the folder (scripts/make-kits.ts writes them again).
const named = new Set<string>();
for (const name of readdirSync(path.join('assets', 'kits')).filter((n) => n.endsWith('.json'))) {
	const k = JSON.parse(readFileSync(path.join('assets', 'kits', name), 'utf8'));
	for (const list of Object.values<KitPiece[]>(k.pieces ?? {}))
		for (const p of list) named.add(p.model);
	for (const f of Object.values<{ tiles: KitPiece[]; broken: KitPiece[] }>(k.floors ?? {}))
		for (const p of [...f.tiles, ...f.broken]) named.add(p.model);
}
for (const id of replaced) {
	const file = path.join('assets', 'models', 'kit', `${id}.json`);
	if (!named.has(id) && existsSync(file)) rmSync(file);
}
