// Marking the minis each frame (tokens.ts): each one's flags (xray.ts), cut away whole by the cut
// plane unless kept (#281) and whether it has a silhouette (#284); then the minis the occluders
// dissolve round (#283, occlusion.ts), only those drawn, from what the viewer was sent.

import type * as THREE from 'three/webgpu';
import type { BaseLayer } from './base-layer';
import { levelAt } from './cut';
import { cutNow } from './cut-layer';
import type { FigureBatches } from './figures';
import { cutawayUniforms } from './materials/cutaway-node';
import { setOccluders } from './materials/occlusion-node';
import { OCCLUSION, occluderOrder, type Candidate } from './occlusion';
import { hasFlag, MINI_FLAG, miniFlags } from './xray';

/** A mini as the token layer keeps it. */
export interface Marked {
	root: THREE.Object3D;
	/** Where it stands at rest (its floor plus `lift`). */
	to: THREE.Vector3;
	lift: number;
	fallen: boolean;
	hidden: boolean;
}

/** Marks every mini in `entries`; returns true if any flags changed (a frame to show them). */
export function markMinis(
	entries: ReadonlyMap<string, Marked>,
	cellSize: number,
	figures: FigureBatches,
	bases: BaseLayer,
	[selected, active]: readonly [string | null, string | null]
): boolean {
	const { level: cutLevel, keep } = cutNow;
	let changed = false;
	const shown: Candidate[] = [];
	for (const [id, e] of entries) {
		const level = levelAt(e.to.y - e.lift, cellSize);
		const state = { level, cutLevel, kept: keep.has(id), fallen: e.fallen, hidden: e.hidden };
		const flags = miniFlags(state);
		const ring = bases.ringOf(id);
		figures.setMini(id, [flags, ring.colour, ring.notched ? 1 : 0, 0]);
		changed = bases.setFlags(id, flags) || changed;
		const { x, z } = e.root.position;
		if (!hasFlag(flags, MINI_FLAG.cut)) shown.push({ id, x, z });
	}
	const pivot = cutawayUniforms.focus.value; // the rig's pivot (cut-layer.ts)
	const order = occluderOrder(shown, selected, keep, active, pivot);
	setOccluders(
		order.map((id) => {
			const { root, lift } = entries.get(id)!;
			const { x, y, z } = root.position;
			return { x, y: y + OCCLUSION.chest * cellSize, z, floor: y - lift };
		})
	);
	return changed;
}
