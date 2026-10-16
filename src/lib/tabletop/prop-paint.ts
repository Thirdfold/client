// The paint of a layer's props: each instance's colour (its tint, #202, and a plant's hue, #304)
// and emissive tint (the ghost of a prop hidden from the players, selected, hovered; added, as
// the old instance colours lerped both in, so a selected hidden prop still reads as hidden), and
// the flames of fixtures (light-fixtures.ts). Written into the buckets' instance attributes.

import * as THREE from 'three/webgpu';
import type { Prop } from '$lib/game/props';
import { paintFlame, SELF_LIT, type FlameLook } from './light-fixtures';
import { PAINT_ATTRIBUTE, TINT_ATTRIBUTE, uploadInstances } from './materials';
import type { AssetMeshes } from './prop-buckets';

/** The emissive tints (colour and strength): selected, hovered, and hidden from the players. */
const SELECTED = { color: new THREE.Color(0xe0a458), strength: 0.4 };
const HOVERED = { color: new THREE.Color(0xe27a6b), strength: 0.4 };
/** Reused for each instance's tint (#202). */
const tintColour = new THREE.Color();
/** What the GM sees a prop hidden from the players as: pale, like a ghost of itself. */
const GHOST = { color: new THREE.Color(0xb8c6e0), strength: 0.3 };

/** What the paint depends on besides the props: lights' flames, the selection, the world chunk. */
export interface PaintState {
	flames: ReadonlyMap<string, FlameLook | null>;
	selected: string | null;
	hovered: string | null;
	/** The world chunk's `varietyFor`, for a plant's hue; no hue without it. */
	world: { varietyFor(id: string, freeYaw: boolean): { hue: number } } | null;
}

export function paintProps(
	buckets: Iterable<AssetMeshes>,
	props: readonly Prop[],
	{ flames, selected, hovered, world }: PaintState
): void {
	const hidden = new Set(props.filter((p) => p.hidden).map((p) => p.id));
	const tinted = new Map(props.map((p) => [p.id, p.tint]));
	const cells = new Map(props.map((p) => [p.id, `${p.pos.x},${p.pos.y}`]));
	for (const meshes of buckets) {
		const plant = meshes.model?.entry.kind === 'foliage' ? world : null;
		for (const { mesh, flame } of meshes.parts) {
			const tints = mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute;
			// Only the instances drawn are uploaded (#334): tints and paints share one buffer.
			uploadInstances(tints, meshes.owners.length);
			if (flame) {
				meshes.owners.forEach((id, i) =>
					paintFlame(mesh, i, flames.get(cells.get(id) ?? '') ?? SELF_LIT[meshes.assetId] ?? null)
				);
				continue;
			}
			const paints = mesh.geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.BufferAttribute;
			meshes.owners.forEach((id, i) => {
				tintColour.set(tinted.get(id) ?? 0xffffff);
				// A plant's hue (#304) leans its colour yellow or blue, under the selection's tint.
				const hue = plant ? plant.varietyFor(id, false).hue : 0;
				paints.setXYZ(i, tintColour.r * (1 + 2 * hue), tintColour.g, tintColour.b * (1 - 2 * hue));
				const hot = id === selected ? SELECTED : id === hovered ? HOVERED : null;
				const sum = [0, 0, 0];
				for (const t of [hidden.has(id) ? GHOST : null, hot]) {
					if (!t) continue;
					sum[0] += t.color.r * t.strength;
					sum[1] += t.color.g * t.strength;
					sum[2] += t.color.b * t.strength;
				}
				tints.setXYZW(i, sum[0], sum[1], sum[2], 1);
			});
		}
	}
}
