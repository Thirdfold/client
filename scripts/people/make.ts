// Makes The Hollow Bell's people (M76 #330, docs/ASSETS.md "The people minis"): for each spec in
// scripts/people/specs/ (or the ids given), bakes the figure in headless Blender and assembles
// art/npc/<id>/<id>.glb, which the cook then turns into assets/. By hand, never in CI, under Node 22:
//
//   THIRDFOLD_BPY=<python with the bpy wheel> BLENDER_USER_RESOURCES=<dir MPFB is installed in> \
//   MPFB_ZIP=<mpfb-2.0.18.zip> SKETCHFAB_TOKEN=... \
//     npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/people/make.ts [id...]
//   npm run assets:cook && npm run assets
//
// A statue (`archive` in its spec) is a Sketchfab scan: its glTF archive is fetched by the SHA-256
// its meta.json pins (server/assets/cc0-fetch.ts, CC0 models only) and unpacked in
// art/_packs/<sha256>/. A human is built by MPFB 2.0.18 from the CC0 assets the spec names, which
// BLENDER_USER_RESOURCES holds (the add-on's asset packs unpacked into its data folder).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchPinned } from '../../server/assets/cc0-fetch';
import { openZip } from '../../server/assets/zip';
import { assemble } from './assemble';

const SPECS = path.join('scripts', 'people', 'specs');
const bpy = process.env.THIRDFOLD_BPY;
if (!bpy) throw new Error('THIRDFOLD_BPY: the python that has the bpy wheel');
if (!process.env.SKETCHFAB_TOKEN && existsSync('.env')) {
	const line = /^SKETCHFAB_TOKEN=(.*)$/m.exec(readFileSync('.env', 'utf8'));
	if (line) process.env.SKETCHFAB_TOKEN = line[1].trim().replace(/^["']|["']$/g, '');
}

const only = process.argv.slice(2);
const ids = readdirSync(SPECS)
	.map((f) => f.replace(/\.json$/, ''))
	.filter((id) => !only.length || only.includes(id));

for (const id of ids) {
	const spec = JSON.parse(readFileSync(path.join(SPECS, `${id}.json`), 'utf8'));
	const meta = JSON.parse(readFileSync(path.join('art', 'npc', id, 'meta.json'), 'utf8'));
	if (spec.archive) {
		const dir = path.join('art', '_packs', spec.archive);
		if (!existsSync(path.join(dir, 'scene.gltf'))) {
			const zip = openZip(
				await fetchPinned(meta.provenance.source, {
					cache: path.join('art', '_packs'),
					log: console.log
				})
			);
			for (const name of zip.names()) {
				const file = path.join(dir, name);
				mkdirSync(path.dirname(file), { recursive: true });
				writeFileSync(file, zip.read(name));
			}
		}
	}
	const out = path.join('art', 'npc', '_bake', id);
	const run = spawnSync(
		bpy,
		[
			'-I',
			path.join('scripts', 'people', `${spec.archive ? 'statue' : 'human'}_mini.py`),
			path.join(SPECS, `${id}.json`),
			out
		],
		{ stdio: 'inherit' }
	);
	if (run.status !== 0) throw new Error(`${id}: Blender failed`);
	console.log('wrote', await assemble(out, id));
}
