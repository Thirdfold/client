// The water kind's high-tier graphs (#298), in the lazy `water` chunk with water.ts, after r186's
// `webgpu_backdrop_water`: one copy of the frame's colour and one of its depth, taken by three
// just before the first water of a render draws (`FrameCopy`, once per render whatever the
// number of samples, since every sample shares one texture), and no extra scene render. So
// a frame with no water in view copies nothing, and low and medium (no `refract`) never do.
//
// Both graphs ring what breaks the surface in foam from the depth under it (`DEPTH_FOAM` cells of
// water or less: a wading mini's base, a prop's legs, a rock, the bank), whatever the shore field
// knows. Wadeable water also bends what lies below by its ripples' normal, falling back to the
// straight view where the bent sample is in front of the water (a leg standing in it never bleeds
// into its refraction), and lets it through as much as medium's blending did (`backdropAlphaNode`:
// the preset's clarity and depth ramp from the shore field, and its foam), with caustics on it by
// day: ridged noise (where Perlin noise crosses 0) on the world's clock (still under reduced
// motion), as bright as the sun shines (`daylight`: none at night or under an enclosed sky) where
// it reaches (`skySun`: none under a roof or in a dark area).
// Deep water stays a solid colour, depth foam only; on high it draws after the opaque world
// (transparent at alpha 1, writing depth) so its depth copy holds every opaque thing in it.
//
// The backdrop is mixed into the lit colour before `outputNode`, so `worldModify` still comes last:
// an unexplored cell's water is 0 however its refraction is bent, and the depth copy holds only what
// this viewer's scene draws.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { cellUniforms } from '../cell-maps';
import { lazyGraphs, worldTime, type Graph, type Variant } from './kinds';
import { tsl, type N } from './tsl';
import { skySun } from './world-modify';
import { waterUniforms } from './water';

/** How much the sun shines, 0 to 1 (water-layer.ts `tick`): 0 at night and under an enclosed sky. */
export const daylight = T.uniform(0);
/** Foam rings what stands in water this shallow, in cells along the view. */
export const DEPTH_FOAM = 0.15;
/** How far the ripples bend the view, in screen UV at full tilt; and the depth (cells) it takes. */
const BEND = { strength: 0.03, full: 0.5 };
/** Caustics show wholly at the waterline, not at all this many cells under. */
const CLEAR_TO = 1.2;
/** Caustics: cells per cell of the pattern, their speed and brightness. */
const CAUSTICS = { scale: 1.6, speed: 0.6, strength: 0.35 };

const loose = (node: unknown) => node as N;
const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/**
 * A copy of the frame drawn so far, as r186's `ViewportTextureNode` makes one: three runs
 * `updateBefore` once per render for all the samples of one texture (NodeFrame keys it by
 * `updateReference`, the texture), just before the first object using it draws. It copies only
 * from a target of its texture's type, the scene pass's half-float colour and its depth: never the
 * prepass's 8-bit target (the warm-up compiles for it) or the canvas, which the backends refuse.
 */
class FrameCopy extends THREE.TextureNode {
	constructor(value: THREE.Texture, uv?: THREE.Node | null, level?: unknown, bias?: unknown) {
		super(value, uv as never, level as never, bias as never);
		this.updateBeforeType = 'render' as never;
	}

	updateBefore(frame: THREE.NodeFrame): undefined {
		const renderer = frame.renderer as THREE.WebGPURenderer;
		const target = renderer.getRenderTarget();
		const copy = this.value as THREE.Texture & { image: { width: number; height: number } };
		const from = (copy as THREE.DepthTexture).isDepthTexture
			? target?.depthTexture
			: target?.texture;
		if (!target || from?.type !== copy.type) return;
		if (copy.image.width !== target.width || copy.image.height !== target.height)
			[copy.image.width, copy.image.height, copy.needsUpdate] = [target.width, target.height, true];
		renderer.copyFramebufferToTexture(copy as THREE.FramebufferTexture);
	}
}

const seenSoFar = new THREE.FramebufferTexture(1, 1);
seenSoFar.type = THREE.HalfFloatType;
seenSoFar.minFilter = seenSoFar.magFilter = THREE.LinearFilter;
/** The frame so far and its depth: every sample is a `.sample()` of these, so one copy a render. */
const frame = new FrameCopy(seenSoFar, t.screenUV as never) as unknown as N;
const depthAt = new FrameCopy(new THREE.DepthTexture(1, 1), t.screenUV as never) as unknown as N;

/** The view depth (positive, world units) of the scene drawn so far at `uv`. */
const sceneDepth = (uv: N): N =>
	t.perspectiveDepthToViewZ(depthAt.sample(uv), t.cameraNear, t.cameraFar).negate();

/** `plain`, the medium graph, made the high tier's (#298): depth foam, and for wadeable water more. */
function highGraph(plain: Graph, deep: boolean): Graph {
	const cell = loose(cellUniforms.cellSize);
	const surface = t.positionView.z.negate();
	// How much water lies in front of what was drawn under this pixel, in cells.
	const under = sceneDepth(t.screenUV).sub(surface).div(cell).max(0);
	const ring = under.div(DEPTH_FOAM).oneMinus().saturate();
	const foam = loose(waterUniforms.foam);
	const colour = loose(plain.colorNode);
	const lit = plain.lit!;
	const graph: Graph = {
		...plain,
		colorNode: t.vec4(t.mix(colour.xyz, foam, ring), 1),
		// Deep water is solid; wadeable water's bed comes through the backdrop now.
		opacityNode: loose(T.float(1)),
		lit: { ...lit, roughnessNode: loose(lit.roughnessNode).add(ring.mul(0.5)) }
	};
	if (deep) return graph;
	// Refraction: the ripples' tilt (view space) bends the view, less in the very shallows.
	const tilt = loose(lit.normalNode).xy;
	const bend = tilt.mul(BEND.strength).mul(under.div(BEND.full).saturate());
	const bent = t.screenUV.add(bend).saturate();
	const behind = sceneDepth(bent).sub(surface).greaterThan(0);
	const seen = loose(frame.sample(t.select(behind, bent, t.screenUV))).xyz;
	// Caustics by day: as bright as the sun shines, where it reaches.
	const sunUp = loose(daylight).mul(skySun());
	const at = t.positionWorld.xz.div(cell).mul(CAUSTICS.scale);
	const net = tsl.mx_noise_float(t.vec3(at, loose(worldTime).mul(CAUSTICS.speed))).abs();
	const shallow = under.div(CLEAR_TO).oneMinus().saturate();
	const light = net.oneMinus().pow(8).mul(CAUSTICS.strength).mul(sunUp).mul(shallow);
	// The bed comes through as much as medium's blending let it (the preset's clarity, its depth
	// ramp and the shore foam: `plain`'s alpha), never through the depth foam.
	const clear = loose(plain.opacityNode).oneMinus().mul(ring.oneMinus());
	return { ...graph, backdropNode: seen.add(light), backdropAlphaNode: clear };
}

const plainOf = lazyGraphs.water!;
lazyGraphs.water = (variant: Variant): Graph =>
	variant.refract
		? highGraph(plainOf({ ...variant, refract: false, deep: false }), variant.deep)
		: plainOf(variant);
