// The meta.json of a CC0 pack model (M76, docs/ASSETS.md "CC0 packs (milestone 76)"): where it
// comes from and how it is glued (cc0-assemble.ts), read as an allowlist. The cook's own keys
// (ramp, detail, textureSize, lods, poses, style, ...) are readMeta's, in licence.ts.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MAPS } from './cook-surfaces';
import { isRecord } from './pipeline-files';
import { decodePng } from './png';
import { isItch, type Pin } from './cc0-fetch';
import type { GlueMeta, SurfaceMaps } from './cc0-assemble';
import type { Pose } from './pose-bake';

export interface Cc0Meta {
	/** The pinned download: the model file itself, a zip of a pack, or an itch.io page whose zip's hash this is. */
	source: Pin;
	/** The glTF or GLB inside the zip (required for a zip and for itch.io; the zip is a pack). */
	member?: string;
	/** A directory of the zip where a model's bare texture names are found. */
	textures?: string;
	/** itch.io: the page's upload (its pack file), when it has more than one. */
	upload?: string;
	glue: GlueMeta;
}

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every(text);

function pose(v: unknown, what: string): Pose | undefined {
	if (v === undefined) return undefined;
	if (!isRecord(v)) throw new Error(`${what} is { clip, time }`);
	const { clip, time } = v;
	if (clip !== undefined && !text(clip)) throw new Error(`${what}.clip is an animation's name`);
	if (time !== undefined && !(typeof time === 'number' && time >= 0 && time < 3600)) {
		throw new Error(`${what}.time is seconds`);
	}
	return { ...(clip !== undefined ? { clip } : {}), ...(time !== undefined ? { time } : {}) };
}

/** Whether a meta.json is a CC0 pack model rather than a Poly Haven one with `maps`. */
export const isCc0 = (meta: unknown) =>
	isRecord(meta) &&
	isRecord(meta.provenance) &&
	isRecord(meta.provenance.source) &&
	meta.maps === undefined;

/** Checks a pack model's meta.json; throws a sentence naming the key that is wrong. */
export function readCc0Meta(raw: unknown): Cc0Meta {
	if (!isRecord(raw) || !isRecord(raw.provenance) || !isRecord(raw.provenance.source)) {
		throw new Error('needs provenance.source: { url, sha256 }');
	}
	const s = raw.provenance.source;
	if (!text(s.url) || !(typeof s.sha256 === 'string' && /^[0-9a-f]{64}$/.test(s.sha256))) {
		throw new Error('provenance.source is { url, sha256 }');
	}
	const source: Pin = { url: s.url, sha256: s.sha256 };
	const zipped = new URL(source.url).pathname.toLowerCase().endsWith('.zip') || isItch(source.url);
	const { member, textures, upload } = raw;
	if (!zipped && !new URL(source.url).pathname.toLowerCase().endsWith('.glb')) {
		throw new Error('provenance.source is a zip, an itch.io page or a .glb');
	}
	if (zipped && !text(member)) throw new Error('a zip needs "member": the glTF or GLB in it');
	if (member !== undefined && (!text(member) || !/\.(gltf|glb)$/i.test(member))) {
		throw new Error('"member" is a .gltf or .glb path');
	}
	if (!zipped && member !== undefined) throw new Error('"member" is for a zip');
	if (textures !== undefined && !text(textures))
		throw new Error('"textures" is a directory of the zip');
	if (
		upload !== undefined &&
		!(typeof upload === 'string' && /^\d+$/.test(upload) && isItch(source.url))
	) {
		throw new Error('"upload" is an itch.io upload id');
	}
	const { keep, drop, roles, fit, turn, triangles, error, swap } = raw;
	if (keep !== undefined && !names(keep)) throw new Error('"keep" is a list of node names');
	if (drop !== undefined && !names(drop)) throw new Error('"drop" is a list of node names');
	if (roles !== undefined) {
		const ok =
			isRecord(roles) &&
			Object.entries(roles).every(([k, v]) => ['swing', 'accent', 'flame'].includes(k) && names(v));
		if (!ok) throw new Error('"roles" is { swing, accent, flame }: lists of node names');
	}
	if (!(
		Array.isArray(fit) &&
		fit.length === 3 &&
		fit.every((f) => f === null || (typeof f === 'number' && f > 0 && f <= 64))
	)) {
		throw new Error('"fit" is [x, y, z] in cells, null where free');
	}
	if (turn !== undefined && !Number.isInteger(turn))
		throw new Error('"turn" is whole quarter turns');
	if (!(typeof triangles === 'number' && Number.isInteger(triangles) && triangles >= 12)) {
		throw new Error('"triangles" is the simplifier\'s target');
	}
	if (error !== undefined && !(typeof error === 'number' && error > 0 && error <= 1)) {
		throw new Error('"error" is 0-1');
	}
	if (swap !== undefined && !(isRecord(swap) && Object.values(swap).every(text))) {
		throw new Error('"swap" is { material name: surface id }');
	}
	const glue: GlueMeta = {
		fit: fit as (number | null)[],
		triangles,
		...(keep ? { keep } : {}),
		...(drop ? { drop } : {}),
		...(roles ? { roles: roles as GlueMeta['roles'] } : {}),
		...(turn !== undefined ? { turn: turn as number } : {}),
		...(error !== undefined ? { error: error as number } : {}),
		...(swap ? { swap: swap as Record<string, string> } : {})
	};
	const [pos, downed] = [pose(raw.pose, 'pose'), pose(raw.downed, 'downed')];
	if (pos) glue.pose = pos;
	if (downed) glue.downed = downed;
	return {
		source,
		...(member ? { member } : {}),
		...(textures ? { textures: textures as string } : {}),
		...(upload ? { upload: upload as string } : {}),
		glue
	};
}

/** A library surface's source maps (art/surfaces/<id>/, fetched by scripts/fetch-surfaces.mjs). */
export function surfaceMaps(dir: string): SurfaceMaps {
	if (!existsSync(dir)) throw new Error(`no surface at ${dir}`);
	const files = readdirSync(dir);
	const map = (m: keyof typeof MAPS) => {
		const f = files.find((n) => MAPS[m].test(n));
		return f ? decodePng(readFileSync(path.join(dir, f))) : undefined;
	};
	const color = map('color');
	if (!color) throw new Error(`${dir}: fetch the surface first (node scripts/fetch-surfaces.mjs)`);
	return { color, normal: map('normal'), roughness: map('roughness'), ao: map('ao') };
}
