// The wind field (#300): one field every swaying thing samples (grass, canopies and decor now,
// flames and banners in 75), so their motion agrees. A steady lean along the environment's
// direction, gust fronts rolling downwind from a small tiling noise (`wind`, a perlin recipe) and
// a flutter by the square of the weight. Its clock is the renderer's injected one, integrated on
// the CPU (`WindClock.tick`): the gusts' scroll and the flutter's phase move by each frame's dt and
// wrap where the pattern repeats, so a frozen clock draws the same frame, a change of strength
// never makes it jump, and floats keep their precision. Every value is a uniform: an environment,
// the weather or reduced motion changes numbers, never a program. Strength 0 (still air, reduced
// motion, power saver) gives an offset of exactly 0.
//
// `applyWind(weight)` is a `positionNode`: it moves the vertex by this frame's offset and its
// previous position (`positionPrevious`, which instancing has already carried through the previous
// instance matrix) by the previous frame's, so TRAA sees the sway as motion and draws no trails.
// Layers ask `windOn()` for their `animating` report: wind frames are AMBIENT frames, and never
// redraw a shadow (casters sway in the colour passes only; their shadows stand at rest).
//
// A lazy chunk of its own (`wind` in scripts/check-bundle.mjs), loaded and awaited with the
// renderer and by the lobby, as the water layer is: loading it registers the foliage kind's graph
// (`lazyGraphs.foliage`: foliage.ts's clumps, swaying by their `_wind` times `params.sway`).

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { loadManifest } from '$lib/assets/load';
import type { EnvironmentDef } from '$lib/assets/manifest';
import { windParams } from '$lib/assets/wind';
import { loadTexture } from '../environment';
import { foliageGraph, loadLeaves } from './foliage';
import { lazyGraphs, type Variant } from './kinds';
import type { N } from './tsl';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** The noise: a tiling perlin recipe (assets/textures/wind.json), read as data. */
const TEXTURE = 'wind';
/** World units one repeat of the noise spans: about how wide a gust front is. */
const GUST_SCALE = 24;
/** How fast gust fronts roll downwind, world units a second, at strength 0 and at 1. */
const GUST_SPEED = [1.5, 4.5] as const;
/** The flutter's frequencies (Hz); the phase wraps at PHASE_WRAP s, whole periods of both. */
const FLUTTER_HZ = [1.5, 2.5] as const;
const PHASE_WRAP = 2;
/** At strength and weight 1, in world units: the steady lean, a full gust's more, the flutter. */
const LEAN = 0.06;
const GUST = 0.1;
const FLUTTER = 0.02;
/** How far an offset of 1 drops what sways, so a blade or branch about keeps its length. */
const DROP = 0.8;
/** The longest step the clock takes: a tab coming back from hours away moves the field no further. */
const MAX_DT_MS = 250;

const vec2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
/** The field's uniforms, module-wide like `worldTime`: one tabletop draws at a time. */
export const windUniforms = {
	/** Where it blows, on the ground (x, z), unit length. */
	direction: T.uniform(vec2(0, -1)),
	strength: T.uniform(0),
	gust: T.uniform(0),
	/** The gusts' scroll in noise repeats, and the flutter's phase in seconds: now and last frame. */
	scroll: T.uniform(vec2()),
	phase: T.uniform(0),
	scrollPrev: T.uniform(vec2()),
	phasePrev: T.uniform(0)
};
const u = windUniforms as unknown as Record<keyof typeof windUniforms, N>;

/** Mid-grey until the noise arrives: an even, middling gust everywhere (environment.ts's BLANK rule). */
const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
/** Sampled like the noise that replaces it, so the sampler never changes. */
function asNoise<X extends THREE.Texture>(texture: X): X {
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = texture.minFilter = THREE.LinearFilter;
	texture.colorSpace = THREE.NoColorSpace;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}
/** Every sample reads this node's texture (`sample` clones keep a reference to it). */
const noise = T.texture(asNoise(blank));

let loading: Promise<void> | null = null;
/** Loads the noise once for the page (never disposed: a few kB every table shares). */
export function loadWindNoise(): Promise<void> {
	return (loading ??= loadManifest().then(async (manifest) => {
		const entry = manifest.textures[TEXTURE];
		if (!entry) return;
		// Through the environments' loader, as the water's ripples: loaded once, then sampled as
		// data. (A loader of its own split the renderer's chunk in two, about 600 B gz.)
		const map = await loadTexture(TEXTURE, entry);
		if (map) noise.value = asNoise(map);
	}));
}

/**
 * The offset of a point at `world` (x, z) with sway weight `weight` (0 still, 1 a tip), at the
 * clock (`scroll`, `phase`): xz along and across the wind, y a slight drop. `shelter` scales it
 * (75's flames in a roofed room); vegetation never grows indoors and passes 1.
 */
export function windOffset(world: N, weight: N, scroll: N, phase: N, shelter: N | number = 1): N {
	const strength = u.strength.mul(shelter);
	const fronts = (noise as unknown as N).sample(world.div(GUST_SCALE).sub(scroll)).level(0).x;
	const push = fronts.mul(u.gust).mul(GUST).add(LEAN).mul(strength).mul(weight);
	const tau = 2 * Math.PI;
	const a = phase
		.mul(tau * FLUTTER_HZ[0])
		.add(world.x.mul(1.7))
		.add(world.y.mul(1.3));
	const b = phase
		.mul(tau * FLUTTER_HZ[1])
		.add(world.y.mul(1.1))
		.sub(world.x.mul(0.9));
	const flutter = t.vec2(t.sin(a), t.sin(b)).mul(strength.mul(FLUTTER).mul(weight.mul(weight)));
	const xz = u.direction.mul(push).add(flutter.mul(fronts.add(0.5)));
	return t.vec3(xz.x, t.dot(xz, xz).mul(-DROP), xz.y);
}

/** Where a point of the drawn mesh lies on the ground: its world x and z. */
const groundOf = (p: N): N => t.modelWorldMatrix.mul(t.vec4(p, 1)).xz;

/**
 * A `positionNode` that sways the vertex by `weight` (a node: the geometry's wind weight, times
 * whatever the layer scales it by). Writes the previous frame's sway into `positionPrevious` when
 * the pass draws velocity (TRAA's prepass), as instancing does with the previous matrices.
 */
/** TSL's `Fn`, whose body is handed the node builder. */
const withBuilder = T.Fn as unknown as (
	body: (builder: { needsPreviousData(): boolean }) => N
) => () => N;

export function applyWind(weight: N, shelter: N | number = 1): N {
	return withBuilder((builder) => {
		const local = t.positionLocal as N;
		if (builder.needsPreviousData()) {
			const before = t.positionPrevious as N;
			const was = windOffset(groundOf(before), weight, u.scrollPrev, u.phasePrev, shelter);
			before.assign(before.add(was));
		}
		return local.add(windOffset(groundOf(local), weight, u.scroll, u.phase, shelter));
	})();
}

/** Whether anything sways now: a layer with swaying content reports AMBIENT frames only then. */
export const windOn = (): boolean => windUniforms.strength.value > 0;

/**
 * The field's clock and values for a tabletop: the environment's wind (#300) through
 * `windParams`, still while motion is reduced or power saved (the scheduler's `still`, read live
 * each frame). `tick` once a drawn frame, before anything asks `windOn`.
 */
export class WindClock {
	private last: number | null = null;
	private environment: EnvironmentDef | undefined;
	private wanted: string | null = null;
	private still = false;

	constructor() {
		void loadWindNoise();
		void loadLeaves(); // the canopies' leaf atlas (#304)
	}

	/** Whether anything sways now (`windOn`): layers with swaying content report ambient frames. */
	get on(): boolean {
		return windOn();
	}

	setEnvironment(id: string | null): void {
		this.wanted = id;
		void loadManifest().then((manifest) => {
			if (this.wanted !== id) return; // another came meanwhile
			this.environment = id ? manifest.environments[id] : undefined;
			this.apply();
		});
	}

	/**
	 * Moves the field to `now` (ms, the injected clock): the last frame's values become the previous
	 * ones, then the scroll moves downwind and the phase on, by the time since the last frame drawn.
	 * `still`: reduced motion or power saver, whose wind is none.
	 */
	tick(now: number, still: boolean): void {
		if (still !== this.still) {
			this.still = still;
			this.apply();
		}
		const dt = this.last === null ? 0 : Math.min(Math.max(now - this.last, 0), MAX_DT_MS) / 1000;
		this.last = now;
		const { direction, strength, scroll, phase, scrollPrev, phasePrev } = windUniforms;
		scrollPrev.value.copy(scroll.value);
		phasePrev.value = phase.value;
		const speed = GUST_SPEED[0] + (GUST_SPEED[1] - GUST_SPEED[0]) * strength.value;
		const step = (dt * speed) / GUST_SCALE;
		// Wrapped at whole repeats of the noise, which tiles: the field never jumps.
		scroll.value.set(
			(scroll.value.x + direction.value.x * step) % 1,
			(scroll.value.y + direction.value.y * step) % 1
		);
		phase.value = (phase.value + dt) % PHASE_WRAP;
	}

	private apply(): void {
		// The weather's factor stays 1 until #75's weather scales it (`WorldLook.weather`).
		const p = windParams(this.environment, 1, this.still, this.still);
		windUniforms.direction.value.set(...p.direction);
		windUniforms.strength.value = p.strength;
		windUniforms.gust.value = p.gust;
	}
}

// Foliage (#304, foliage.ts): clumps swaying by their wind weights times `params.sway`, their
// shadow at rest.
lazyGraphs.foliage = (variant: Variant) => foliageGraph(variant, applyWind);
