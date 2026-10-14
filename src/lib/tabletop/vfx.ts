// The particle layer (#311), a lazy chunk of its own (`vfx` in scripts/check-bundle.mjs) that the
// grass chunk fetches (`vfx` there), so the renderer awaits it with the ground's growth before a
// frame can draw, and the lobby warms its graph. Every later effect of M75 (fire, combat, statuses,
// the toll, motes, fx props, weather) spawns through it: `burst` for a one-off, `loop`/`unloop`
// for an emitter; recipes are vfx-recipes.ts's, the slots vfx-state.ts's.
//
// Two pools, one draw each while anything in them lives and none otherwise: `additive` (sparks,
// embers, glints; unsorted, added) and `soft` (smoke, dust, motes; blended), each one Mesh of an
// InstancedBufferGeometry quad on the overlay kind's `sheet` graph (materials/vfx.ts), never
// writing depth, casting or picked. A spawn uploads only the slots it wrote (`addUpdateRange`);
// a frame writes one uniform, `vfxNow`, from the injected clock (`tick`), so a burst resumes at its
// right phase after idle and a held clock draws the same pixels. `tick` reports ACTIVE while a
// burst plays, `inView` AMBIENT while loops are in the camera's frustum; it never asks for a frame
// of its own (`burst` and `loop` do, once). Capped per pool by the tier (`particles`, the oldest
// loops left out first), off with `?off=vfx`, still under reduced motion, capped under Reduce
// flashing.

import * as THREE from 'three/webgpu';
import { loadManifest } from '$lib/assets/load';
import { loadTexture } from './environment';
import { createMaterial, setSlot, type KindMaterial } from './materials';
import { NO_CAP, VFX_A, VFX_B, vfxNow, vfxUniforms } from './materials/vfx';
import type { QualitySettings } from './quality';
import { POOLS, type PoolName } from './vfx-recipes';
import {
	MAX_PARTICLES,
	STRIDE,
	VfxState,
	type LoopItem,
	type Origin,
	type VfxFrame,
	type VfxStats
} from './vfx-state';

// The cues' effects (effects.ts) ride in this chunk too, out of the renderer chunk's cap.
export { EffectsLayer } from './effects';
export { AirLayer } from './air';
export { cellOrigin, type LoopItem, type Origin, type VfxFrame } from './vfx-state';
export { vfxPlayer } from './vfx-play';
export { RECIPE_IDS, type RecipeId } from './vfx-recipes';

/** The atlas's texture id (the `sprites` recipe, server/assets/vfx-art.ts). */
const ATLAS_TEXTURE = 'vfx-sprites';
const IDLE: VfxFrame = { bursting: false, looping: false, bounds: null };

type Pool = THREE.Mesh<THREE.InstancedBufferGeometry, KindMaterial>;

/** A pool's material: the particles' graph, added or blended. */
function poolMaterial(pool: PoolName): KindMaterial {
	const material = createMaterial('overlay', { sheet: true });
	if (pool === 'additive') material.blending = THREE.AdditiveBlending;
	return material;
}

/** A quad drawn once per slot of `a` and `b` (`STRIDE` floats each). */
function quad(a: Float32Array, b: Float32Array): THREE.InstancedBufferGeometry {
	const plane = new THREE.PlaneGeometry(1, 1);
	const geometry = new THREE.InstancedBufferGeometry();
	geometry.setIndex(plane.index);
	geometry.setAttribute('position', plane.getAttribute('position'));
	geometry.setAttribute('uv', plane.getAttribute('uv'));
	geometry.setAttribute(VFX_A, new THREE.InstancedBufferAttribute(a, STRIDE));
	geometry.setAttribute(VFX_B, new THREE.InstancedBufferAttribute(b, STRIDE));
	geometry.instanceCount = 0;
	return geometry;
}

export class VfxLayer {
	readonly group = new THREE.Group();
	readonly state = new VfxState();
	private readonly pools: Record<PoolName, Pool>;
	private on = true;
	/** The tier's share of a recipe's particles: low halves them (#315, #316). */
	private share = 1;
	/** The atlas has loaded: nothing draws before (its blank would draw squares). */
	private shown = false;
	private disposed = false;
	private now = 0;
	private frame: VfxFrame = IDLE;
	private standIns: THREE.Object3D[] | null = null;
	private readonly frustum = new THREE.Frustum();
	private readonly matrix = new THREE.Matrix4();
	private readonly box = new THREE.Box3();

	constructor(
		/** Told when a spawn is to be drawn. */
		private readonly request: () => void
	) {
		this.pools = Object.fromEntries(
			POOLS.map((name) => {
				const { a, b } = this.state.pools[name];
				const mesh = new THREE.Mesh(quad(a, b), poolMaterial(name));
				mesh.frustumCulled = false; // one draw wherever its particles are
				mesh.castShadow = mesh.receiveShadow = false;
				mesh.raycast = () => {};
				mesh.visible = false;
				mesh.renderOrder = name === 'soft' ? 1 : 2; // glints over smoke
				mesh.userData.perfLayer = 'vfx'; // ?perf's layers (perf.ts `tagged`)
				this.group.add(mesh);
				return [name, mesh];
			})
		) as Record<PoolName, Pool>;
		void loadManifest().then(async (manifest) => {
			const entry = manifest.textures[ATLAS_TEXTURE];
			const map = entry ? await loadTexture(ATLAS_TEXTURE, entry) : null;
			if (!map || this.disposed) return;
			for (const name of POOLS) setSlot(this.pools[name].material, 'albedo', map);
			this.shown = true;
			this.request();
		});
	}

	/**
	 * A one-off effect: `recipe`'s particles born at `t0` (ms, the renderer's clock) at `origin`
	 * (world units; `cellOrigin` for a cell), their look from `seed` (the same on every client that
	 * passes the same seed). Writes its slots once and asks for a frame.
	 */
	burst(recipe: string, origin: Origin, seed: number, t0: number): void {
		if (this.on && this.state.burst(recipe, origin, seed, t0, this.share)) this.flush();
	}

	/** Runs an emitter under `id` (replacing one of that id): a ring of particles born in turn. */
	loop(id: string, recipe: string, origin: Origin, seed: number): void {
		if (this.state.loop(id, recipe, origin, seed, this.share)) this.flush();
	}

	/**
	 * Replaces the emitters of group `prefix` (ids starting with it) by `items`. Never asks for a
	 * frame of its own when `ask` is false: called during a frame, before `tick`, it draws in it.
	 */
	group(prefix: string, items: readonly LoopItem[], ask = true): void {
		if (this.state.group(prefix, items, this.share)) this.flush(ask);
	}

	/** Stops the emitter `id`. */
	unloop(id: string): void {
		if (this.state.unloop(id)) this.flush();
	}

	/**
	 * Before a frame: the clock's uniform, and what plays. `bursting` asks for ACTIVE frames,
	 * `looping` (with `inView`) for AMBIENT ones; nothing when the layer is off or not yet loaded.
	 * `reduced`, when given, is reduced motion now (`setReducedMotion`).
	 */
	tick(now: number, reduced?: boolean): VfxFrame {
		if (reduced !== undefined) this.setReducedMotion(reduced);
		this.now = now;
		vfxNow.value = this.state.seconds(now);
		const drawn = this.on && this.shown;
		for (const name of POOLS) this.pools[name].visible = drawn && this.state.shows(name, now);
		this.frame = drawn ? this.state.tick(now) : IDLE;
		return this.frame;
	}

	/** Whether the loops (as of the last `tick`) are in `camera`'s view: AMBIENT frames. */
	inView(camera: THREE.Camera): boolean {
		const bounds = this.frame.looping ? this.frame.bounds : null;
		if (!bounds) return false;
		const { min, max } = bounds;
		this.box.min.set(min.x, min.y, min.z);
		this.box.max.set(max.x, max.y, max.z);
		this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		return this.frustum.setFromProjectionMatrix(this.matrix).intersectsBox(this.box);
	}

	/** The tier's cap per pool (`particles`) and the `vfx` layer switch (`?off=vfx`). */
	setTier(settings: QualitySettings): void {
		this.on = settings.layers.vfx;
		this.share = settings.tier === 'low' ? 0.5 : 1;
		this.state.setCap(settings.particles);
		this.flush(false);
	}

	/** Bursts hold their still frame and loops their stagger (the graph's `still`). */
	setReducedMotion(reduced: boolean): void {
		this.state.reduced = reduced;
		vfxUniforms.still.value = reduced ? 1 : 0;
	}

	/** Reduce flashing (#223): no particle's colour above 1, so none blooms. */
	setReduceFlashing(on: boolean): void {
		vfxUniforms.flashCap.value = on ? 1 : NO_CAP;
	}

	/** The `?perf` counter (perf.ts): particles alive, bursts playing, loops laid out. */
	stats(): VfxStats {
		return this.state.stats(this.now);
	}

	/** Stand-ins for the warm-up (#180): one particle of each pool, on its material. */
	gallery(): THREE.Object3D[] {
		this.standIns ??= POOLS.map((name) => {
			const one = new Float32Array(STRIDE);
			const geometry = quad(one, one.slice());
			geometry.instanceCount = 1;
			const mesh = new THREE.Mesh(geometry, this.pools[name].material);
			mesh.frustumCulled = false; // it stands nowhere in particular (warmup.ts `standIn`)
			return mesh;
		});
		return this.standIns;
	}

	dispose(): void {
		this.disposed = true;
		for (const name of POOLS) {
			this.pools[name].geometry.dispose();
			this.pools[name].material.dispose();
		}
		for (const o of this.standIns ?? []) (o as THREE.Mesh).geometry.dispose();
	}

	/** Uploads the slots written since the last flush, and draws them (asking for a frame). */
	private flush(ask = true): void {
		for (const name of POOLS) {
			const geometry = this.pools[name].geometry;
			for (const [first, count] of this.state.flush(name))
				for (const attribute of [VFX_A, VFX_B]) {
					const a = geometry.getAttribute(attribute) as THREE.InstancedBufferAttribute;
					a.addUpdateRange(first * STRIDE, count * STRIDE);
					a.needsUpdate = true;
				}
			geometry.instanceCount = Math.min(this.state.pools[name].drawn, MAX_PARTICLES);
		}
		if (ask) this.request();
	}
}
