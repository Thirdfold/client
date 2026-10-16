// A trim piece as a mesh (M76): its parts merged, shaded and held to its role's envelope.
//
// Two ways to wear a surface, both the world's (src/lib/tabletop/walls.ts):
// - tinted: vertex colours (a part's tint times a baked occlusion) over the environment's wall
//   surface, which the world lays on every piece without UVs, so a stone piece reads as the
//   stone of the wall beside it, darker in its joints;
// - sheet: UVs (box-projected, `tile` metres a repeat, the grain along `grain`) on a manifest
//   material (`materials` in its meta.json), for a piece that is all one surface: oak, iron.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
	ENVELOPES,
	envelopeProblem,
	type KitRole,
	type KitSocket
} from '../../../src/lib/assets/kit';
import { BAKE, bakeInto, solidOf } from '../../../server/assets/bake';
import type { PartSource } from '../../../server/assets/models';
import type { Part } from './geom';

export interface Sheet {
	/** A manifest material (assets/materials.json). */
	material: string;
	/** Metres a texture repeat covers on the piece. */
	tile: number;
	/** The axis the texture's u runs along: a beam's length. */
	grain: 'x' | 'y' | 'z';
}

export interface Piece {
	id: string;
	role: KitRole;
	/** More roles it fills as well (a post for the end, the L, the T and the X). */
	also?: KitRole[];
	parts: Part[];
	weight?: number;
	sockets?: KitSocket[];
	sheet?: Sheet;
}

/** The kit's triangle ceiling at LOD0 (LIMITS.kit). */
export const MAX_TRIANGLES = 1_500;

/** Merges, tints or maps, and checks a piece; throws a sentence naming what is wrong. */
export function buildPiece(piece: Piece): THREE.BufferGeometry {
	const geometries = piece.parts.map((p) => p.g.clone());
	const box = new THREE.Box3();
	for (const g of geometries) {
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	}
	// What lies below the floor bakes standing on its own bottom.
	const lift = Math.max(0, -box.min.y);
	const solids = piece.parts.flatMap((p) => {
		if (p.solids === false) return [];
		const specs = p.solids ?? [];
		return specs.map((s) =>
			solidOf({ ...s, at: [s.at[0], s.at[1] + lift, s.at[2]] } as PartSource)
		);
	});
	const out: THREE.BufferGeometry[] = [];
	for (const [i, g] of geometries.entries()) {
		const { tint, tone } = piece.parts[i];
		if (piece.sheet) {
			g.deleteAttribute('uv');
			out.push(g);
			continue;
		}
		g.translate(0, lift, 0);
		bakeInto(g, solids);
		g.translate(0, -lift, 0);
		const bake = g.getAttribute(BAKE);
		const count = g.getAttribute('position').count;
		const colors = new Float32Array(count * 3);
		for (let v = 0; v < count; v++) {
			const k = tone * (0.62 + 0.38 * bake.getX(v)) * (1 + 0.35 * (bake.getY(v) - 0.5));
			for (let c = 0; c < 3; c++) colors[v * 3 + c] = Math.min(1, tint[c] * k);
		}
		g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		g.deleteAttribute(BAKE);
		out.push(g);
	}
	let merged = mergeGeometries(out, false);
	if (!merged) throw new Error(`${piece.id}: parts with different attributes`);
	if (piece.sheet) merged = withUvs(merged, piece.sheet);
	merged.computeBoundingBox();
	const { min, max } = merged.boundingBox!;
	for (const role of [piece.role, ...(piece.also ?? [])]) {
		const problem = envelopeProblem(
			{ min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
			ENVELOPES[role]
		);
		if (problem) throw new Error(`${piece.id} (${role}): ${problem}`);
	}
	const triangles = (merged.getIndex()?.count ?? merged.getAttribute('position').count) / 3;
	if (triangles > MAX_TRIANGLES) throw new Error(`${piece.id}: ${triangles} triangles`);
	return merged;
}

/**
 * Box-projected UVs, a triangle at a time from its face's dominant axis (so a chamfer never
 * smears a texture across a corner), the grain along `grain` where that axis lies on the face.
 */
function withUvs(g: THREE.BufferGeometry, sheet: Sheet): THREE.BufferGeometry {
	const flat = g.toNonIndexed();
	const position = flat.getAttribute('position');
	const uv = new Float32Array(position.count * 2);
	const axis = { x: 0, y: 1, z: 2 }[sheet.grain];
	const [a, b, c, n] = [0, 0, 0, 0].map(() => new THREE.Vector3());
	for (let t = 0; t < position.count; t += 3) {
		a.fromBufferAttribute(position, t);
		b.fromBufferAttribute(position, t + 1);
		c.fromBufferAttribute(position, t + 2);
		n.copy(b).sub(a).cross(c.clone().sub(a));
		const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
		const dominant = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
		// The two axes on the face; the grain's one first (u runs along it).
		let [u, v] = [
			[1, 2],
			[0, 2],
			[0, 1]
		][dominant];
		if (v === axis) [u, v] = [v, u];
		for (const [k, p] of [a, b, c].entries()) {
			const q = [p.x, p.y, p.z];
			uv[(t + k) * 2] = q[u] / sheet.tile;
			uv[(t + k) * 2 + 1] = q[v] / sheet.tile;
		}
	}
	flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	flat.deleteAttribute('color');
	flat.setIndex(Array.from({ length: position.count }, (_, i) => i));
	return flat;
}
