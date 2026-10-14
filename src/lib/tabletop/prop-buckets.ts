// A bucket of props (props.ts): the instanced meshes of one asset at one level of its model, its
// shadow proxy (#274: the cheapest level, on `SHADOW_PROXY`, casting for every prop of the asset),
// or its placeholder box until the model has loaded.

import * as THREE from 'three/webgpu';
import type { AssetId } from '$lib/game/props';
import { SHADOW_PROXY } from './lod';
import {
	addInstanceTints,
	createMaterial,
	PIECE_MIN,
	type KindMaterial,
	type MaterialOptions
} from './materials';
import { levelsOf, partsOf, type LoadedModel, type ModelPart } from './models';
import { pickable } from './picking';

/**
 * Models: their colours are vertex colours. One material for every asset (#172), and one per
 * textured part in the same variant, so a textured model compiles nothing new.
 */
export const MODEL: MaterialOptions = { instanced: true, vertexColors: true };

export interface AssetMeshes {
	assetId: AssetId;
	parts: { mesh: THREE.InstancedMesh; swings: boolean; flame: boolean }[];
	/** Materials of its own for textured parts (#188): the shared variant, its maps in the slots. */
	materials: KindMaterial[];
	/** Prop id for each instance index. */
	owners: string[];
	capacity: number;
	/** The model these meshes draw, or null for the placeholder. */
	model: LoadedModel | null;
}

/** What every bucket of a layer shares. */
export interface BucketKit {
	group: THREE.Group;
	material: KindMaterial;
	placeholder: THREE.BufferGeometry;
	placeholderMaterial: KindMaterial;
	flameMaterial: THREE.Material;
}

/**
 * A bucket's meshes with room for `count` props (growing in chunks): `model` at level `lod`, its
 * shadow proxy with `proxy`, or the placeholder box without a model. `key` names it for picks.
 */
export function makeBucket(
	kit: BucketKit,
	key: string,
	assetId: AssetId,
	lod: number,
	proxy: boolean,
	count: number,
	model: LoadedModel | null
): AssetMeshes {
	// Every bucket is pool-sized (`PIECE_MIN`: its matrices an attribute, not a uniform array, whose
	// buffer r186 names by id in the shader), so a bucket made mid-game compiles nothing: a level's,
	// a part list's (the waking's crack seams, #297) or a placeholder's.
	const capacity = Math.max(PIECE_MIN, Math.ceil(count * 1.5));
	const materials: KindMaterial[] = [];
	// A translucent model (#237) draws with materials of its own, in the same variant. A plant
	// (#304) always does, in the foliage kind, whose translucency is its default unless it names one.
	const translucency = model?.entry.translucency ?? 0;
	const plant = model?.entry.kind === 'foliage';
	let plain: KindMaterial | null = null;
	const materialOf = (part: ModelPart) => {
		if (!part.maps && !translucency && !plant) return kit.material;
		if (!part.maps && plain) return plain;
		const lift = kit.material.params.lift;
		const params = part.maps
			? { ...part.params, lift, translucency }
			: { lift, ...(plant && !translucency ? {} : { translucency }) };
		const own = createMaterial(plant ? 'foliage' : 'prop', {
			...MODEL,
			params,
			slots: part.maps ?? {}
		});
		materials.push(own);
		if (!part.maps) plain = own;
		return own;
	};
	// A model with levels casts through its proxy alone; a part list or a box casts itself.
	const casts = proxy || !model || !levelsOf(model);
	const make = (shared: THREE.BufferGeometry, material: THREE.Material, shadows = true) => {
		// A copy of its own, to carry this mesh's tints and lifts (#172, #181).
		const geometry = shared.clone();
		addInstanceTints(geometry, capacity);
		const mesh = pickable(new THREE.InstancedMesh(geometry, material, capacity));
		mesh.userData.bucket = key;
		mesh.castShadow = shadows && casts;
		mesh.receiveShadow = shadows && !proxy;
		if (proxy) mesh.layers.set(SHADOW_PROXY); // only the shadow cameras see it
		mesh.count = 0;
		kit.group.add(mesh);
		return mesh;
	};
	const parts: AssetMeshes['parts'] = [];
	if (model) {
		for (const role of ['body', 'swing'] as const)
			for (const part of partsOf(model, role, lod))
				parts.push({
					mesh: make(part.geometry, materialOf(part)),
					swings: role === 'swing',
					flame: false
				});
		// A flame glows at every level (it is small), never in a proxy.
		if (!proxy)
			for (const part of partsOf(model, 'flame'))
				parts.push({
					mesh: make(part.geometry, kit.flameMaterial, false),
					swings: false,
					flame: true
				});
	} else
		parts.push({
			mesh: make(kit.placeholder, kit.placeholderMaterial),
			swings: false,
			flame: false
		});
	return { assetId, capacity, owners: [], parts, materials, model };
}

/** Takes a bucket off the table (the model's own geometry is kept for next time). */
export function freeBucket(meshes: AssetMeshes): void {
	for (const { mesh } of meshes.parts) {
		mesh.removeFromParent();
		mesh.geometry.dispose(); // its own copy
		mesh.dispose();
	}
	for (const m of meshes.materials) m.dispose(); // not its maps: the model's (models.ts)
}
