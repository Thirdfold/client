// The last step of a people mini (M76 #330, docs/ASSETS.md "The people minis"): the Blender bake's
// mesh.glb (geometry and UVs only) and its three maps become the export the cook expects,
// art/npc/<id>/<id>.glb: one `body` mesh with one material (albedo, normal, and the ORM map with the
// tint mask in alpha, as the character minis have it). make.ts calls it; on its own, under Node 22:
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/people/assemble.ts <bake dir> <id>

import { NodeIO } from '@gltf-transform/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export async function assemble(dir: string, id: string): Promise<string> {
	const io = new NodeIO();
	const doc = await io.read(path.join(dir, 'mesh.glb'));
	const root = doc.getRoot();
	const meshes = root.listMeshes();
	if (meshes.length !== 1) throw new Error(`expected one mesh, found ${meshes.length}`);
	const png = (name: string, label: string) =>
		doc
			.createTexture(label)
			.setImage(new Uint8Array(readFileSync(path.join(dir, name))))
			.setMimeType('image/png');
	const albedo = png('albedo.png', `${id}-albedo`);
	const normal = png('normal.png', `${id}-normal`);
	const orm = png('orm.png', `${id}-orm`);
	const material = doc
		.createMaterial(id)
		.setBaseColorTexture(albedo)
		.setNormalTexture(normal)
		.setMetallicRoughnessTexture(orm)
		.setOcclusionTexture(orm)
		.setRoughnessFactor(1)
		.setMetallicFactor(1)
		.setAlphaMode('OPAQUE');
	for (const prim of meshes[0].listPrimitives()) prim.setMaterial(material);
	meshes[0].setName('body');
	for (const n of root.listNodes()) if (n.getMesh()) n.setName('body');
	const out = path.join('art', 'npc', id, `${id}.glb`);
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, await io.writeBinary(doc));
	return out;
}

if (process.argv[1]?.endsWith('assemble.ts')) {
	const [dir, id] = process.argv.slice(2);
	if (!dir || !id) throw new Error('usage: assemble.ts <bake dir> <id>');
	console.log('wrote', await assemble(dir, id));
}
