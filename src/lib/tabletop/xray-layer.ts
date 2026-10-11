// X-ray silhouettes (#284): a mini hidden behind the world shows as a flat silhouette in its ring's
// colour (bases.ts, the palette checked for colour-vision safety), an enemy's striped across the
// world and its base's notches lit, so the viewer never loses a mini the server sent them. Every
// figure batch and base mesh has a twin (`withXray`), a child drawing the same instances (the same
// geometry, the same `instanceMatrix`, its count the batch's), made with the batch, so nothing
// compiles when a mini appears: one draw per batch, only while the `xray` layer is on.
//
// The twin is blended and draws after the opaque world with `GreaterDepth`, only where something
// is in front of the mini. Without a stencil (the pipeline's passes keep plain depth) its vertices
// are pulled `XRAY_PULL` toward the camera, so the mini's own parts in front of each other (an arm
// before the torso, the base's rim before the feet) don't count as cover. It writes no depth, no
// glow, and leaves the scene pass's `hidden` attachment as it was, so a silhouette over a hidden
// cell is masked black again by the output stage; it casts no shadow, is never picked, and the
// prepass (opaque only) never draws it. Cut away, fallen and GM-hidden minis have none (xray.ts).

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { BANDS, NOTCHES } from './bases';
import { cellUniforms } from './cell-maps';
import { BASE_ATTRIBUTE, basePalette } from './materials/base';
import { tsl, type N } from './materials/tsl';
import { MINI_ATTRIBUTE, MINI_FLAG, XRAY } from './xray';
export { MINI_ATTRIBUTE } from './xray';

/** How far toward the camera a silhouette is pulled, in cells: deeper cover than the mini's own. */
const XRAY_PULL = 0.25;

const loose = (node: unknown) => node as N;
const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;
const bit = (flags: N, n: number): N => flags.div(n).floor().mod(2);

/** A silhouette's material: `colour` (linear rgb), `enemy` 0 or 1, `alpha` its extra cover (1). */
function silhouette(colour: N, enemy: N, show: N, alpha: N): THREE.MeshBasicNodeMaterial {
	const material = new THREE.MeshBasicNodeMaterial();
	material.name = 'xray';
	material.transparent = true;
	material.depthWrite = false;
	material.depthFunc = THREE.GreaterDepth;
	const p = tsl.positionLocal; // world space: the batches stand at the origin
	const toCamera = loose(T.cameraPosition).sub(p).normalize();
	(material as unknown as Record<string, unknown>).positionNode = p.add(
		toCamera.mul(u.cellSize.mul(XRAY_PULL))
	);
	const w = tsl.positionWorld;
	const across = w.x.add(w.y).add(w.z).div(u.cellSize).mul(XRAY.stripes).fract();
	const stripe = tsl.mix(1, XRAY.gap, T.step(0.5, across as never) as unknown as N);
	const opacity = tsl.mix(1, stripe, enemy).mul(alpha).mul(XRAY.opacity);
	material.colorNode = tsl.vec4(colour, 1) as never;
	material.opacityNode = opacity as never;
	material.maskNode = show as never;
	material.mrtNode = T.mrt({
		output: T.output,
		emissive: tsl.vec4(0, 0, 0, opacity) as never,
		hidden: tsl.vec4(0, 0, 0, 0) as never
	});
	return material;
}

const palette = (index: N): N => loose(basePalette).element(index.add(0.5).toInt()).xyz;

let figureMaterial: THREE.MeshBasicNodeMaterial | null = null;
/** The figures' silhouette, one for every figure batch: their `aMini`. */
export function figureXray(): THREE.MeshBasicNodeMaterial {
	if (figureMaterial) return figureMaterial;
	const mini = tsl.attribute(MINI_ATTRIBUTE, 'vec4');
	const show = bit(mini.x, MINI_FLAG.noXray).lessThan(0.5);
	return (figureMaterial = silhouette(palette(mini.y), mini.z, show, loose(T.float(1))));
}

let baseMaterial: THREE.MeshBasicNodeMaterial | null = null;
/** The bases' silhouette: their ring (`aTint`: palette, glow, flags, hidden), notches lit. */
export function baseXray(): THREE.MeshBasicNodeMaterial {
	if (baseMaterial) return baseMaterial;
	const ring = tsl.attribute(BASE_ATTRIBUTE, 'vec4');
	const enemy = bit(ring.z, 1);
	const show = bit(ring.z, 4 * MINI_FLAG.noXray).lessThan(0.5);
	const v = tsl.uv().y;
	const notch = loose(T.step(tsl.uv().x.mul(NOTCHES).fract() as never, 0.12 as never))
		.mul(loose(T.step(v as never, BANDS.rim as never)))
		.mul(enemy);
	// A notch shows whole through the stripes' gaps.
	const alpha = tsl.mix(1, 1 / XRAY.gap, notch);
	return (baseMaterial = silhouette(palette(ring.x), enemy, show, alpha));
}

/** Every twin made and not yet gone, and whether the layer is on. */
const twins = new Set<THREE.InstancedMesh>();
let shown = false;

/** Turns the x-ray layer on or off (`?on=xray`; off until its gates pass, quality.ts). */
export function setXray(on: boolean): void {
	shown = on;
	for (const t of twins) t.visible = on;
}

/**
 * Gives `mesh` its silhouette twin, drawn with `material`: a child sharing its geometry and
 * instance matrices, always as many instances as it has, gone when it is disposed.
 */
export function withXray<M extends THREE.InstancedMesh>(
	mesh: M,
	material: THREE.MeshBasicNodeMaterial
): M {
	const twin = new THREE.InstancedMesh(mesh.geometry, material, 1);
	twin.instanceMatrix = mesh.instanceMatrix;
	Object.defineProperty(twin, 'count', { get: () => mesh.count });
	twin.frustumCulled = false; // its bounds would go stale: the batch's are reset as minis move
	twin.castShadow = twin.receiveShadow = false;
	twin.raycast = () => {};
	twin.userData.perfLayer = 'xray'; // perf-layers.ts
	twin.visible = shown;
	twins.add(twin);
	mesh.add(twin);
	mesh.addEventListener('dispose', () => {
		twins.delete(twin);
		twin.dispose();
	});
	return mesh;
}
