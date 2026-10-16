// Heat haze (M75 #326), a part of the lazy `vfx` chunk: on high and ultra the air shimmers over
// braziers, floor fires, lava and the Heart. The sources are haze-plan.ts's (fires from fire.ts,
// the explored lava, the Heart prop), so only what the viewer was sent shimmers. Each is a
// camera-facing quad in a small scene of its own, drawn by ONE instanced draw into a half-resolution
// target (`HazePass`: a PassNode, a quarter of the pixels): the quad writes a screen-space offset
// (two noise values rising with the heat, fading at its edges, at its feet and where it meets the
// opaque scene by the prepass's depth, as soft particles do), added up where quads overlap. The
// output stage (post.ts `compose`) reads the scene's colour that offset away, after TRAA, so
// the distortion never enters TRAA's history, and before it black-masks the cells the viewer has not
// explored, so no colour is pulled over them.
//
// Switching is a uniform: `strength` is 1 while a source is in view (and the tier has haze, reduced
// motion is off), and 0 otherwise, where the pass stops (Post.gate) and the offset is multiplied
// by 0. The material is built once with the pass and compiled in the warm-up (`gallery`, post.ts
// `hazeBatch`), so nothing compiles when it is toggled. The haze scene draws only these quads: it
// is not the table's scene, so no layer, shadow or light pass ever sees them.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import type { AirDeps } from './air';
import { HAZE_MAX, HAZE_TALL, fireHeat, mergeHeat, terrainHeat, type Heat } from './haze-plan';
import { softFade, vfxNow } from './materials/vfx';
import { tsl, type N } from './materials/tsl';
import type { Fire } from './fire';
import type { HazePass } from './passes';
import { standIn } from './warmup';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;
const ATTRIBUTE = 'aHaze';
/** How far (screen height share) a full-strength haze shifts the picture. */
const AMPLITUDE = 0.006;
/** The distortion pass's size against the frame's. */
const SCALE = 0.5;
/** 1 while a source is in view and haze is on: the pass's gate and the offset's multiplier. */
const strength = T.uniform(0) as unknown as { value: number };

function hazeMaterial(): THREE.MeshBasicNodeMaterial {
	const material = new THREE.MeshBasicNodeMaterial();
	const a = tsl.attribute(ATTRIBUTE, 'vec4');
	// Standing on its base, facing the camera (the camera's own axes, as the particles' quads).
	const corner = t.vec4(
		tsl.positionGeometry.x.mul(a.w),
		tsl.positionGeometry.y.add(0.5).mul(a.w.mul(HAZE_TALL)),
		0,
		0
	);
	material.positionNode = a.xyz.add(t.cameraWorldMatrix.mul(corner).xyz) as never;
	const at = tsl.uv();
	const sides = t.float(1).sub(t.smoothstep(0.2, 1, at.x.mul(2).sub(1).abs()));
	const height = t.smoothstep(0, 0.25, at.y).mul(t.float(1).sub(t.smoothstep(0.45, 1, at.y)));
	const fade = softFade(0.6);
	// Two noise values rising with the heat; signed, in a half-float target, added by overlap.
	const p = tsl.positionWorld.mul(2.4).sub(t.vec3(0, vfxNow.mul(1.6), 0));
	const wobble = t.vec2(tsl.mx_noise_float(p), tsl.mx_noise_float(p.add(t.vec3(17.3, 5.1, 9.7))));
	material.colorNode = t.vec4(wobble.mul(AMPLITUDE), 0, 1) as never;
	material.opacityNode = sides.mul(height).mul(fade) as never;
	material.blending = THREE.AdditiveBlending;
	material.transparent = true;
	material.depthTest = material.depthWrite = false;
	material.side = THREE.DoubleSide;
	material.fog = false;
	return material;
}

/** True where two lists of hazes are the same. */
const same = (a: readonly Heat[], b: readonly Heat[]) =>
	a.length === b.length &&
	a.every((h, i) => h.x === b[i].x && h.y === b[i].y && h.z === b[i].z && h.size === b[i].size);

export class HeatLayer {
	readonly scene = new THREE.Scene();
	private readonly buffer = new Float32Array(HAZE_MAX * 4);
	private readonly attribute = new THREE.InstancedBufferAttribute(this.buffer, 4);
	private readonly material = hazeMaterial();
	private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry>;
	private readonly sets = new Map<string, readonly Heat[]>();
	private readonly box = new THREE.Box3();
	private readonly frustum = new THREE.Frustum();
	private readonly matrix = new THREE.Matrix4();
	private count = 0;
	private on = false;
	private standIn: THREE.Mesh | null = null;
	private pass: THREE.PassNode | null = null;
	private last: unknown[] = [];
	private spot = '';

	constructor(private readonly air?: AirDeps) {
		this.scene.name = 'haze';
		this.mesh = new THREE.Mesh(this.quad(), this.material);
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		this.mesh.userData.perfLayer = 'vfx';
		this.scene.add(this.mesh);
	}

	private quad(): THREE.InstancedBufferGeometry {
		const plane = new THREE.PlaneGeometry(1, 1);
		const geometry = new THREE.InstancedBufferGeometry();
		geometry.setIndex(plane.index);
		geometry.setAttribute('position', plane.getAttribute('position'));
		geometry.setAttribute('uv', plane.getAttribute('uv'));
		geometry.setAttribute(ATTRIBUTE, this.attribute);
		geometry.instanceCount = 0;
		return geometry;
	}

	/**
	 * Whether this pipeline has the pass (high and up), and `?off=haze` (read here, not as a layer of
	 * quality.ts, whose few bytes every page would carry).
	 */
	setTier(built: boolean): void {
		this.on = built && !/[?&]off=([^&]*,)?haze\b/.test(globalThis.location?.search ?? '');
	}

	/** The fires' hazes (fire.ts `follow`). */
	setFires(fires: readonly Fire[]): void {
		this.set('fire', fireHeat(fires));
	}

	/** Replaces the hazes under `key`; lays out again only if they changed. */
	private set(key: string, list: readonly Heat[]): void {
		if (same(this.sets.get(key) ?? [], list)) return;
		this.sets.set(key, list);
		const all = mergeHeat(this.sets.values());
		this.count = all.length;
		all.forEach((h, i) => this.buffer.set([h.x, h.y, h.z, h.size], i * 4));
		this.box.makeEmpty();
		for (const h of all)
			this.box
				.expandByPoint(new THREE.Vector3(h.x - h.size, h.y, h.z - h.size))
				.expandByPoint(new THREE.Vector3(h.x + h.size, h.y + h.size * HAZE_TALL, h.z + h.size));
		this.attribute.needsUpdate = true;
		this.mesh.geometry.instanceCount = this.count;
		this.mesh.visible = this.count > 0;
	}

	/**
	 * Before a frame: lays out the lava and Heart hazes again when the viewer's table changed or the
	 * camera's pivot moved two units (the nearest lava cells), and reports whether a source is in
	 * `camera`'s view with haze on and motion allowed: the pass draws, and frames come ambiently.
	 */
	inView(camera: THREE.Camera, reduced: boolean): boolean {
		const view = this.on ? this.air?.view() : undefined;
		if (view) {
			const target = this.air!.target;
			const spot = `${Math.floor(target.x / 2)},${Math.floor(target.z / 2)}`;
			if (view.some((v, i) => v !== this.last[i]) || spot !== this.spot) {
				[this.last, this.spot] = [view, spot];
				const [grid, shape, props] = view;
				this.set('terrain', grid && shape ? terrainHeat(grid, shape, props, target) : []);
			}
		}
		this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const live =
			this.on &&
			!reduced &&
			this.count > 0 &&
			this.frustum.setFromProjectionMatrix(this.matrix).intersectsBox(this.box);
		strength.value = live ? 1 : 0;
		return live;
	}

	/**
	 * The distortion pass of a pipeline with a prepass (post.ts `build`): a half-resolution pass over
	 * the haze scene, and the offset it holds (zero while off), in screen UV, for the output stage.
	 */
	build(camera: THREE.Camera): HazePass {
		const pass = new THREE.PassNode(THREE.PassNode.COLOR, this.scene, camera, {
			samples: 0,
			depthBuffer: false
		});
		pass.name = 'haze';
		pass.setResolutionScale(SCALE);
		this.pass = pass;
		return {
			pass,
			strength,
			batch: {
				scene: this.scene,
				items: [(this.standIn ??= this.makeStandIn())],
				targets: [{ renderTarget: pass.renderTarget, mrt: null, pass }]
			},
			warp: pass
				.getTextureNode('output')
				.sample(T.screenUV)
				.xy.mul(strength as never) as never,
			dispose: () => {
				pass.dispose();
				if (this.pass === pass) this.pass = null;
			}
		};
	}

	/** One haze on the material, for the warm-up to compile (#180). */
	private makeStandIn(): THREE.Mesh {
		const geometry = this.quad();
		geometry.instanceCount = 1;
		return standIn(new THREE.Mesh(geometry, this.material));
	}

	dispose(): void {
		this.pass?.dispose();
		this.mesh.geometry.dispose();
		this.standIn?.geometry.dispose();
		this.material.dispose();
	}
}
