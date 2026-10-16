// The stone-halls pilot kit's pieces as meshes (#263): each part a chamfered primitive (the part
// lists' shapes, server/assets/models.ts), tinted by its region (stone white, timber, iron and
// glass as the old painted sheet's means relative to its ashlar) times a baked occlusion, merged
// into one `body` mesh and checked against its role's envelope. Since M76 a piece has no UVs and
// no sheet: the environment's wall surface (a realistic CC0 set) is laid over the world and the
// piece's colours only tint it (src/lib/tabletop/walls.ts, docs/ASSETS.md "Architecture kits").

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
	ENVELOPES,
	FLOOR_ENVELOPES,
	envelopeProblem,
	type Envelope
} from '../../src/lib/assets/kit';
import { BAKE, bakeInto, solidOf } from '../../server/assets/bake';
import { placementOf, shapeAt, type Shape } from '../../server/assets/models';
import { REGIONS, SIZE, meanColour, type RegionId } from './trim';

export type V3 = [number, number, number];
export interface Part {
	shape: Shape;
	size: V3;
	at: V3;
	turn?: V3;
	region: RegionId;
	/** Multiplies its vertex colour: a joint's backing reads darker than the face. */
	tone?: number;
	/** Ashlar only: where along the 4 u strip the piece's x = -0.5 falls, in units. */
	u?: number;
	/** Ashlar only: added to y to find its course (2 for a wall below its floor, -2..0). */
	ys?: number;
}

export interface Piece {
	id: string;
	/** A role of kit.ts's ENVELOPES, or `floor.tiles` / `floor.broken`. */
	role: string;
	parts: Part[];
	weight?: number;
}

/** The kit's triangle ceiling at LOD0 (LIMITS.kit). */
const MAX_TRIANGLES = 1_500;

const envelopeOf = (role: string): Envelope =>
	role.startsWith('floor.')
		? FLOOR_ENVELOPES[role.slice(6) as keyof typeof FLOOR_ENVELOPES]
		: ENVELOPES[role as keyof typeof ENVELOPES];

/**
 * What a region's colour is as a tint over the wall surface: stone regions a grey by how much
 * lighter or darker than the ashlar they were painted, the others (timber, iron, glass) their
 * own colour relative to it, no channel above 1.
 */
function tintOf(region: RegionId, albedo: Uint8Array): [number, number, number] {
	const mean = (id: RegionId) => {
		const r = REGIONS[id];
		return meanColour(albedo, 0, r.y / SIZE, r.w / SIZE, (r.y + r.h) / SIZE);
	};
	const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	const ref = lum(mean('ashlar'));
	const own = mean(region);
	if (['ashlar', 'dressed', 'rubble', 'flag'].includes(region)) {
		const k = Math.min(1, Math.max(0.7, lum(own) / ref));
		return [k, k, k];
	}
	return own.map((c) => Math.min(1, c / ref)) as [number, number, number];
}

/** A part as geometry in the piece's frame: positions, normals and colours (no UVs). */
function partGeometry(
	p: Part,
	albedo: Uint8Array,
	lift: number,
	solids: ReturnType<typeof solidOf>[]
) {
	const g = shapeAt(p.shape, p.size);
	const place = placementOf(p);
	const pos = g.getAttribute('position');
	g.deleteAttribute('uv');
	g.applyMatrix4(place);
	// Occlusion by the piece's own parts and the floor it stands on (lifted so a piece below its
	// floor stands on its own bottom), as part lists bake it.
	g.translate(0, lift, 0);
	bakeInto(g, solids);
	g.translate(0, -lift, 0);
	const bake = g.getAttribute(BAKE);
	const colors = new Float32Array(pos.count * 3);
	const tone = p.tone ?? 1;
	const tint = tintOf(p.region, albedo);
	for (let i = 0; i < pos.count; i++) {
		const occ = bake.getX(i);
		const edge = bake.getY(i) - 0.5;
		const k = tone * (0.62 + 0.38 * occ) * (1 + 0.35 * edge);
		colors.set(
			tint.map((c) => Math.min(1, c * k)),
			i * 3
		);
	}
	g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	g.deleteAttribute(BAKE);
	return g;
}

/** A piece as one geometry, checked: within its role's envelope and the kit's triangles. */
export function pieceGeometry(piece: Piece, albedo: Uint8Array): THREE.BufferGeometry {
	// The piece's lowest point: what lies below its floor bakes standing on its own bottom.
	const box = new THREE.Box3();
	for (const p of piece.parts) {
		const g = shapeAt(p.shape, p.size).applyMatrix4(placementOf(p));
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	}
	const lift = Math.max(0, -box.min.y);
	const solids = piece.parts.map((p) => solidOf({ ...p, at: [p.at[0], p.at[1] + lift, p.at[2]] }));
	const merged = mergeGeometries(
		piece.parts.map((p) => partGeometry(p, albedo, lift, solids)),
		false
	);
	if (!merged) throw new Error(`${piece.id}: parts with different attributes`);
	merged.computeBoundingBox();
	const { min, max } = merged.boundingBox!;
	const problem = envelopeProblem(
		{ min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
		envelopeOf(piece.role)
	);
	if (problem) throw new Error(`${piece.id} (${piece.role}): ${problem}`);
	const triangles = merged.getIndex()!.count / 3;
	if (triangles > MAX_TRIANGLES) throw new Error(`${piece.id}: ${triangles} triangles`);
	return merged;
}
