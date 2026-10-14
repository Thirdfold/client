// The weather layer (#320, #321), a part of the lazy `vfx` chunk: rain, snow, ash and dust falling
// round the camera's target, and the wet ground and snow that follow them. One instanced draw of
// quads (materials/weather.ts) whose drops are a closed form of fixed randoms, the weather's seed
// and the storm's phase, which is server time (`phaseAt` from `since`), so every client sees the
// same storm at the same moment with no traffic. It only draws what the table allows: nothing
// under an enclosed sky, under reduced motion or the power saver, on a software rasteriser, with
// the `weather` layer off (`?off=weather`), or for fog and a quiet sky; the drops themselves are
// culled in the vertex stage by the ground, the roofs and the fog (the graph's header).
//
// A visible storm is AMBIENT: `view` reports true, and the scheduler draws it at the tier's slow
// rate and not at all while the tab is hidden. The cover (game/weather.ts) is separate and slow:
// a timer sets the wet and snow uniforms once a second while they move, and stops when they have
// settled, so a table in rain that has long since soaked (or dried) draws no frame of its own.

import * as THREE from 'three/webgpu';
import { loadManifest } from '$lib/assets/load';
import { resolveSky } from '$lib/assets/sky-parse';
import type { Manifest } from '$lib/assets/manifest';
import { coverChanging, NO_COVER, snowOf, wetnessOf } from '../game/weather';
import type { WorldLook } from '../game/world';
import { serverNow } from '../net/server-now';
import { createMaterial, type KindMaterial } from './materials';
import { cellUniforms } from './cell-maps';
import { coverUniforms } from './materials/cover';
import { WEATHER_ATTRIBUTE, weatherUniforms } from './materials/weather';
import { STEP_HEIGHT } from './ground';
import type { QualitySettings, Tier } from './quality';
import { seededRandom } from './world/seeded';
import {
	boxFor,
	type Falling,
	dropCount,
	LOOKS,
	MAX_DROPS,
	phaseAt,
	seedOffsets,
	weatherVisible
} from './weather-look';

const isFalling = (kind: string): kind is Falling => Object.hasOwn(LOOKS, kind);

/** The cover's timer: how often the wet and snow uniforms move while they are changing. */
const COVER_MS = 1000;

/** The drops' fixed randoms: x and z in the box, a phase, and a speed pick. */
function randoms(): Float32Array {
	const next = seededRandom(0x5eed);
	const data = new Float32Array(MAX_DROPS * 4);
	for (let i = 0; i < data.length; i++) data[i] = next();
	return data;
}

export class WeatherLayer {
	readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, KindMaterial>;
	private world: WorldLook | null = null;
	private environment: string | null = null;
	private manifest: Manifest | null = null;
	private enclosed = false;
	private software = false;
	private on = true;
	private tier: Tier = 'medium';
	/** The wind of the environment: its direction as x and z, and its strength. */
	private wind: readonly [number, number, number] = [1, 0, 0.2];
	/** Server time (ms) at the injected clock's `at`: the storm runs from here between re-anchors. */
	private anchor: { server: number; at: number } | null = null;
	private timer: ReturnType<typeof setInterval> | 0 = 0;
	private disposed = false;
	private standIn: THREE.Mesh | null = null;

	constructor(private readonly request: () => void) {
		const quad = new THREE.PlaneGeometry(1, 1);
		const geometry = new THREE.InstancedBufferGeometry();
		geometry.setIndex(quad.index);
		geometry.setAttribute('position', quad.getAttribute('position'));
		geometry.setAttribute('uv', quad.getAttribute('uv'));
		geometry.setAttribute(WEATHER_ATTRIBUTE, new THREE.InstancedBufferAttribute(randoms(), 4));
		geometry.instanceCount = 0;
		this.mesh = new THREE.Mesh(geometry, createMaterial('overlay', { weather: true }));
		this.mesh.frustumCulled = false; // one draw wherever its drops are
		this.mesh.castShadow = this.mesh.receiveShadow = false;
		this.mesh.raycast = () => {};
		this.mesh.visible = false;
		this.mesh.renderOrder = 3; // over the particles
		this.mesh.userData.perfLayer = 'weather';
		void loadManifest().then((manifest) => {
			if (this.disposed) return;
			this.manifest = manifest;
			if (!this.world) return;
			this.set(this.world, this.environment, this.software);
			this.request();
		});
	}

	/**
	 * The world's weather on this table (called as the lights are worked out, so it asks for no
	 * frame): the sky it falls under (an enclosed one has none), the environment's wind and base
	 * wetness, and the cover moving toward what the weather asks of it.
	 */
	set(world: WorldLook | null, environment: string | null, software = false): void {
		this.world = world;
		this.environment = environment;
		this.software = software;
		this.anchor = null;
		const env = this.manifest?.environments[environment ?? ''];
		const sky = this.manifest && resolveSky(world, environment, this.manifest);
		this.enclosed = sky?.sky.kind === 'enclosed';
		const wind = env?.wind;
		const heading = ((wind?.direction ?? 0) * Math.PI) / 180;
		this.wind = [Math.cos(heading), Math.sin(heading), wind?.strength ?? 0.2];
		coverUniforms.base.value = env?.wetness ?? 0;
		this.cover();
		if (!this.timer && world && this.changing())
			this.timer = setInterval(() => this.cover(true), COVER_MS);
	}

	/** The quality tier (the number of drops), and the `weather` layer's switch (`?off=weather`). */
	setTier(settings: QualitySettings): void {
		this.tier = settings.tier;
		this.on = settings.layers.weather;
	}

	/**
	 * Before a frame: the storm for `now` (the injected clock) about the camera's `focus`, or
	 * nothing. Whether it needs AMBIENT frames: true while it falls and is shown.
	 */
	view(now: number, camera: THREE.Camera, focus: THREE.Vector3, still: boolean): boolean {
		const weather = this.world?.weather;
		const sky = this.enclosed ? 'enclosed' : 'open';
		const count = weather
			? dropCount(this.tier, weather.intensity, weather.kind, this.software || !this.on)
			: 0;
		const shown =
			!!weather && !!this.manifest && !still && count > 0 && weatherVisible(sky, weather);
		this.mesh.visible = shown;
		coverUniforms.rippling.value =
			shown && (weather!.kind === 'rain' || weather!.kind === 'storm') ? 1 : 0;
		if (!shown || !weather || !isFalling(weather.kind)) return false;
		const look = LOOKS[weather.kind];
		const cell = cellUniforms.cellSize.value as number;
		const width = boxFor(camera.position.distanceTo(focus) / cell) * cell;
		const height = Math.max(5 * cell, width * 0.4) * look.height;
		const below = (cellUniforms.maxLevel.value as number) * STEP_HEIGHT * cell + 0.5;
		const u = weatherUniforms;
		u.center.value.set(focus.x, focus.y, focus.z);
		u.box.value.set(width, height, below, (look.splash * look.mult[0]) / look.cycle);
		u.seed.value.fromArray(seedOffsets(weather.seed));
		u.phase.value = phaseAt(this.serverMs(now), weather.since, look.cycle);
		const slant = look.slant * (0.5 + 2 * this.wind[2]);
		u.look.value.set(look.round, look.length, look.width, look.sway);
		u.tilt.value.set(
			this.wind[0] * slant,
			this.wind[1] * slant,
			look.swayCycles,
			look.alpha * (0.5 + 0.5 * weather.intensity)
		);
		u.mult.value.set(look.mult[0], look.mult[1]);
		u.colour.value.setRGB(look.colour[0], look.colour[1], look.colour[2]);
		this.mesh.geometry.instanceCount = count;
		return true;
	}

	/** One drop of the draw, for the warm-up (#180): the weather's program compiles with the table. */
	gallery(): THREE.Object3D[] {
		if (!this.standIn) {
			const geometry = this.mesh.geometry.clone();
			geometry.instanceCount = 1;
			this.standIn = new THREE.Mesh(geometry, this.mesh.material);
			this.standIn.frustumCulled = false; // it stands nowhere in particular (warmup.ts `standIn`)
		}
		return [this.standIn];
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = 0;
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
		this.standIn?.geometry.dispose();
	}

	/** Server time (ms) for the clock's `now`, anchored so a held clock holds the storm still. */
	private serverMs(now: number): number {
		if (!this.anchor || now - this.anchor.at > 30_000) {
			this.anchor = { server: serverNow(), at: now };
		}
		return this.anchor.server + (now - this.anchor.at);
	}

	/** The wet and snow uniforms at server time now. */
	private cover(ask = false): void {
		const world = this.world;
		if (!world) return;
		const ms = serverNow();
		coverUniforms.rain.value = wetnessOf(world, ms);
		coverUniforms.snow.value = snowOf(world, ms);
		if (!this.changing()) {
			if (this.timer) clearInterval(this.timer);
			this.timer = 0;
		}
		if (ask) this.request();
	}

	private changing(): boolean {
		const world = this.world;
		return !!world && coverChanging(world.weather, world.weather.cover ?? NO_COVER, serverNow());
	}
}
