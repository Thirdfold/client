// Cloud shadows (#323): the sun's direct light times a drifting factor from a tiling noise, set once
// on the key light's node (sky-light.ts) so it is shared by every kind. Uniforms and one texture
// fetch; `strength` 0 makes the factor exactly 1, which is how it is off (low tier, under an
// enclosed sky, with the sun down), so toggling it compiles nothing. The sky-visibility term
// (`skySun`) multiplies it as before, so dark areas and roofed rooms get no sun and no cloud.
// The shadow map is untouched. The layer that sets the values is sky-fx.ts, in the `vfx` chunk.

import * as THREE from 'three/webgpu';
import { tsl, type N } from './tsl';

const { mix, positionWorld, smoothstep, texture, uniform } = tsl;

/** Noise repeats per world unit: one repeat spans 1 / SCALE units (about a cloud's width). */
export const CLOUD_SCALE = 1 / 48;

export const cloudUniforms = {
	/** The drift, in noise repeats (wrapped at 1: the noise tiles). */
	offset: uniform(new THREE.Vector2()),
	/** How much the shadowed parts darken the sun, 0 (off) to 1. */
	strength: uniform(0),
	/** Noise above this is shadow (lower is more cover), softened over 0.2. */
	threshold: uniform(0.6)
};
const u = cloudUniforms as unknown as Record<keyof typeof cloudUniforms, N>;

/** White until the noise arrives, and sampled as it will be (wind.ts's rule: the sampler never changes). */
const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.wrapS = blank.wrapT = THREE.RepeatWrapping;
blank.magFilter = blank.minFilter = THREE.LinearFilter;
blank.generateMipmaps = false;
blank.needsUpdate = true;

/** The noise node: `.value` is swapped for the real texture by sky-fx.ts. */
export const cloudNoise = texture(blank) as unknown as { value: THREE.Texture };

/** The sun's factor at a fragment: 1 in the open, down to 1 - strength under a cloud. */
export function cloudShade(): N {
	const world = positionWorld.xz.mul(CLOUD_SCALE).add(u.offset);
	const noise = (cloudNoise as unknown as N).sample(world).level(0).x;
	return mix(1, 0, smoothstep(u.threshold, u.threshold.add(0.2), noise).mul(u.strength));
}
