// The foliage kind's graph (M74 #304): trees and bushes as painted clumps. Opaque, front faces
// only (a clump is closed), and a lazy chunk of its own with the wind field (wind.ts registers it).
//
// - Sway: the wind field by `_wind` times `params.sway`; the shadow stands at rest
//   (`castShadowPositionNode`), so a swaying canopy never redraws the cached sun shadow.
// - Light: the model's baked normals are a clump's sphere normals (`normals: 'sphere'`), so a
//   canopy shades as balls; the lighting model wraps the diffuse and shines the sun through the
//   leaves by the thickness the bake leaves open (lighting-model.ts, `thin`). The undersides are
//   dark: the bake's occlusion in the indirect light, and in the colour a gradient up each
//   clump, which the wind weight (0 at a clump's foot) gives for free.
// - Leaves: a leaf atlas (`leaves`, a recipe: albedo, coverage in alpha) projected triplanar in
//   the geometry's own space, so leaves ride with the canopy and never swim as it sways or the
//   instance moves. Its tone breaks the colour up, and its relief is a screen-space bump of the
//   same fetch (no normal map to download). Wood, rock and petals (vertex colours that are not
//   green) take a stretched noise as bark instead.
//
// Everything varying is an attribute or a uniform: a colour, a sway or a texture arriving compiles
// nothing. It reads no `uv` (the leaves are mapped in object space), which leaves the eighth vertex
// buffer under TRAA to the bake: position, normal, colour, wind, bake, two matrices, the instance.

import type { Texture } from 'three/webgpu';
import * as T from 'three/tsl';
import { loadManifest } from '$lib/assets/load';
import { cellUniforms } from '../cell-maps';
import { loadTexture } from '../environment';
import { dropLift } from './drop';
import { slotDefault } from './defaults';
import {
	BAKE_ATTRIBUTE,
	PAINT_ATTRIBUTE,
	TINT_ATTRIBUTE,
	WIND_ATTRIBUTE,
	type Graph,
	type Variant
} from './kinds';
import { occlusionKeep } from './occlusion-node';
import { roofShadowMask } from './roof-fade';
import { mipBias } from './texture-quality';
import { tsl, type N } from './tsl';
import { LIFT_ATTRIBUTE } from './variation';
import { worldEmissive, worldModify } from './world-modify';

const t = T as unknown as Record<string, (...args: unknown[]) => N>;

/** The leaf atlas: a recipe in the manifest (assets/textures/leaves.json), a sprig per cell. */
const LEAVES = 'leaves';
/** Atlas repeats per model unit (a leaf is about a fifth of a repeat: some 5 cm of a cell). */
const REPEAT = 3.5;
/** How sharply the three projections blend (weights are |n| to this power). */
const SHARPNESS = 4;
/** The atlas's darkest and brightest green (linear), for the tone: #2f4a24 and #7aa04a. */
const [TONE_LO, TONE_HI] = [0.0685, 0.352];
/** The brightness a leaf's tone ranges over, and a gap between leaves: times the vertex colour. */
const [DARK, LIGHT, GAP] = [0.75, 1.3, 0.45];
/** How much of that breaks the colour up, at most (0 is the vertex colours alone). */
const BREAKUP = 0.75;
/** The brightness of a clump's foot against its top, and the wind weight that is "top". */
const [FOOT, TOP] = [0.62, 0.3];
/** Relief, in cells of height: a leaf's dome, and the bark's grain. */
const [LEAF_RELIEF, BARK_RELIEF] = [0.012, 0.006];

/**
 * A white texel until the atlas arrives, sampled as the atlas will be (the slots' albedo sampling),
 * at positions and never through the texture's own matrix (as `slotSample`, hooks.ts).
 */
const atlas = tsl.texture(slotDefault('albedo')).setUpdateMatrix(false);
/** The same node, as the texture it holds. */
const atlasNode = atlas as unknown as { value: Texture };
/** 0 until the atlas has loaded, then 1: the breakup fades in rather than flashing the white blank. */
const loadedNode = T.uniform(0);
const loaded = loadedNode as unknown as N;
let loading: Promise<void> | null = null;

/** Loads the leaf atlas once for the page (never disposed: a few kB every table shares). */
export function loadLeaves(): Promise<void> {
	return (loading ??= loadManifest().then(async (manifest) => {
		const entry = manifest.textures[LEAVES];
		const map = entry && (await loadTexture(LEAVES, entry));
		if (!map) return;
		atlasNode.value = map;
		loadedNode.value = 1;
	}));
}

/** The leaf atlas at the geometry's position, triplanar: rgb, coverage in alpha. */
function leafAtlas(position: N, normal: N): N {
	const p = position.mul(REPEAT);
	const raw = normal.abs().pow(tsl.vec3(SHARPNESS));
	const w = raw.div(raw.x.add(raw.y).add(raw.z));
	const at = (uv: N) => atlas.sample(uv).bias(mipBias);
	return at(p.zy).mul(w.x).add(at(p.xz).mul(w.y)).add(at(p.xy).mul(w.z));
}

/**
 * The view-space normal after a bump of `height` (Mikkelsen's surface gradient, as three's own
 * bump map does), `strength` in the height's units against world units.
 */
function bump(height: N, strength: N): N {
	const n = tsl.normalView;
	const dx = tsl.positionView.dFdx();
	const dy = tsl.positionView.dFdy();
	const r1 = dy.cross(n);
	const r2 = n.cross(dx);
	const det = dx.dot(r1);
	const grad = r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(det.sign());
	return n.mul(det.abs()).sub(grad.mul(strength)).normalize();
}

/**
 * The graph of the foliage kind. `sway` is the wind chunk's `applyWind`, handed in so the two
 * modules do not import each other.
 */
export function foliageGraph(variant: Variant, sway: (weight: N) => N): Graph {
	const param = (name: string, type: string) => tsl.materialReference(`params.${name}`, type);
	const wind = tsl.attribute(WIND_ATTRIBUTE, 'float');
	const bake = tsl.attribute(BAKE_ATTRIBUTE, 'vec2');
	const base = t.vertexColor().xyz;
	// Green over red: a leaf. Wood, rock and petals are not, and take no leaf from the atlas.
	const leafy = tsl.smoothstep(-0.005, 0.045, base.g.sub(base.r));
	const inside = tsl.positionGeometry;
	const outward = tsl.normalGeometry.normalize();
	const leaves = leafAtlas(inside, outward);
	const tone = leaves.g
		.sub(TONE_LO)
		.div(TONE_HI - TONE_LO)
		.saturate();
	const breakup = tsl.mix(GAP, tsl.mix(DARK, LIGHT, tone), leaves.w);
	const crown = tsl.smoothstep(0, TOP, wind); // 0 at a clump's foot, 1 toward its top
	const shade = tsl.mix(1, tsl.mix(FOOT, 1, crown), leafy);
	const painted = tsl.mix(1, breakup, leafy.mul(BREAKUP).mul(loaded));
	// The tint (selection, hover, hidden) and the variety (hue, #304) of an instance.
	const each = variant.instanced ? tsl.attribute(TINT_ATTRIBUTE, 'vec4') : null;
	const tint = each ? param('tint', 'color').add(each.xyz.mul(each.w)) : param('tint', 'color');
	const paint = variant.instanced ? tsl.attribute(PAINT_ATTRIBUTE, 'vec3') : tsl.vec3(1);
	const emissive = worldEmissive(tint);
	// Bark's grain runs up the trunk: noise stretched along y.
	const grain = tsl.mx_noise_float(tsl.vec3(inside.x.mul(18), inside.y.mul(3), inside.z.mul(18)));
	const relief = tsl.mix(
		grain.mul(0.5).mul(BARK_RELIEF),
		leaves.w.mul(tone.mul(0.6).add(0.4)).mul(LEAF_RELIEF),
		leafy
	);
	const cell = (cellUniforms as unknown as Record<string, N>).cellSize;
	const weight = wind.mul(param('sway', 'float'));
	const swayed = sway(weight);
	return {
		colorNode: tsl.vec4(param('color', 'color').mul(paint).mul(shade).mul(painted), 1),
		opacityNode: null,
		alphaTestNode: null,
		positionNode: variant.instanced
			? swayed.add(dropLift(tsl.attribute(LIFT_ATTRIBUTE, 'vec2').y))
			: swayed,
		// At rest, in the colour passes only does it sway (and drop in): the cached shadow is never redrawn.
		castShadowPositionNode: tsl.positionLocal,
		outputNode: worldModify(tsl.output, emissive, true, false, true),
		maskNode: occlusionKeep(),
		maskShadowNode: roofShadowMask(),
		lit: {
			roughnessNode: param('roughness', 'float'),
			metalnessNode: param('metalness', 'float'),
			// Only indirect light takes ambient occlusion: the dark undersides of the canopy.
			aoNode: bake.x.mul(shade),
			normalNode: bump(relief, cell),
			emissiveNode: emissive,
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}
