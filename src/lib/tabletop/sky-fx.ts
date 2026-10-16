// The weather's lightning and the clouds' shadows (#323), in the lazy `vfx` chunk, driven by
// VfxLayer. Presentation only: nothing here touches `room.flashUntil`, the rules' light, fog or
// darkness.
//
// Lightning. game/lightning.ts is a pure schedule from the weather's seed and `since` and the
// server's clock (`serverNow`), so every client sees a strike at the same moment with no traffic.
// A strike's light is a flash strength (`bolt`, 0-1) the renderer hands to `AtmosphereLayer.setFlash`
// with the Bell's flash (the larger wins): exposure, bloom and the hemisphere, never
// `CellMaps.setFlash`, which would thin the dark. Reduce flashing (and so reduced motion) makes it
// one slow, dim pulse. A strike asks for ACTIVE frames (`bolting`) for its envelope only; between
// strikes a timer, armed for the next one, asks for the frame it starts on. Open skies only.
//
// Clouds. The sun's direct light times a noise drifting with the wind (materials/clouds.ts), its
// strength and cover from the weather and the sun's height (cloud-look.ts), off on the low tier,
// with the sun down or under an enclosed sky. The drift is `drifting` (AMBIENT frames), still
// under reduced motion and power saver.

import * as THREE from 'three/webgpu';
import type { WorldLook } from '$lib/game/world';
import {
	lightMs,
	nextStrike,
	strikeLight,
	strikeShare,
	type WeatherNow
} from '$lib/game/lightning';
import { loadManifest } from '$lib/assets/load';
import { serverNow } from '$lib/net/server-now';
import type { AtmosphereState } from './atmosphere-curve';
import { cloudLook } from './cloud-look';
import { loadTexture } from './environment';
import { CLOUD_SCALE, cloudNoise, cloudUniforms } from './materials/clouds';
import { vfxUniforms } from './materials/vfx';
import type { QualitySettings } from './quality';
import { WIND_REACH } from './vfx-recipes';

/** The noise: a tiling perlin recipe (assets/textures/clouds.json). */
const TEXTURE = 'clouds';
/** How fast the shadows drift, world units a second, in a calm and at full wind. */
const DRIFT = [0.6, 3] as const;
/** The longest step the drift takes (a tab coming back from hours away moves it no further). */
const MAX_DT_MS = 250;
const NONE: WeatherNow = { kind: 'none', intensity: 0, seed: 0, since: 0 };

export class SkyFx {
	/** The lightning's flash strength now, 0-1, and whether a strike's light plays (ACTIVE frames). */
	bolt = 0;
	bolting = false;
	/** The shadows drift now (AMBIENT frames). */
	drifting = false;
	/** Reduce flashing: one slow, dim pulse per strike. */
	slow = false;
	private weather = NONE;
	private sky: AtmosphereState | null = null;
	private low = false;
	private last: number | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private armed = -1;
	private disposed = false;

	constructor(private readonly request: () => void) {
		void loadManifest().then(async (manifest) => {
			const entry = manifest.textures[TEXTURE];
			const map = entry ? await loadTexture(TEXTURE, entry) : null;
			if (!map || this.disposed) return;
			map.wrapS = map.wrapT = THREE.RepeatWrapping;
			map.magFilter = map.minFilter = THREE.LinearFilter;
			map.colorSpace = THREE.NoColorSpace;
			map.generateMipmaps = false;
			map.needsUpdate = true;
			cloudNoise.value = map;
			this.request();
		});
	}

	/** The world's weather, and the live atmosphere state (the sun's height, open or enclosed). */
	setWorld(world: WorldLook | null, sky: AtmosphereState): void {
		this.weather = world?.weather ?? NONE;
		this.sky = sky;
	}

	setTier(settings: QualitySettings): void {
		this.low = settings.tier === 'low';
	}

	/** Under an open sky; an enclosed one has no sun at all (-90°). */
	private get open(): boolean {
		return !!this.sky && this.sky.sunElevation > -89;
	}

	/** The weather's lightning as the effect props must leave room for it: null with none. */
	strikingWeather(): WeatherNow | null {
		return this.open && strikeShare(this.weather) > 0 ? this.weather : null;
	}

	/** Before a frame: the strike's light, and the shadows' look and drift. `still`: reduced or saved. */
	tick(now: number, still: boolean): void {
		this.lightning();
		this.clouds(now, still);
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
	}

	private lightning(): void {
		const weather = this.strikingWeather();
		const wall = serverNow();
		const strike = weather && nextStrike(weather, wall, this.slow);
		if (!strike) {
			[this.bolt, this.bolting] = [0, false];
			return;
		}
		const t = wall - strike.at;
		const end = lightMs(strike, this.slow);
		this.bolting = t >= 0 && t < end;
		this.bolt = this.bolting ? strikeLight(strike, t, this.slow) : 0;
		// A frame at the strike's start, and one at its end (the light off), though nothing else asks.
		this.arm(this.bolting ? strike.at + end : strike.at, wall);
	}

	private arm(target: number, wall: number): void {
		if (target === this.armed) return;
		if (this.timer) clearTimeout(this.timer);
		this.armed = target;
		this.timer = setTimeout(
			() => {
				this.armed = -1;
				this.request();
			},
			Math.max(0, target - wall) + 2
		);
	}

	private clouds(now: number, still: boolean): void {
		const look = cloudLook(this.weather, this.open ? this.sky!.sunElevation : -90, this.low);
		cloudUniforms.strength.value = look.strength;
		cloudUniforms.threshold.value = look.threshold;
		const dt = this.last === null ? 0 : Math.min(Math.max(now - this.last, 0), MAX_DT_MS) / 1000;
		this.last = now;
		this.drifting = look.strength > 0 && !still;
		if (!this.drifting) return;
		// The environment's wind, as the air layer sets it for the dust (air.ts `blow`): its direction
		// times its strength, in WIND_REACH units.
		const { x, y } = vfxUniforms.wind.value;
		const wind = Math.min(1, Math.hypot(x, y) / WIND_REACH);
		const step = (dt * (DRIFT[0] + (DRIFT[1] - DRIFT[0]) * wind) * CLOUD_SCALE) % 1;
		const [dx, dy] = wind > 0 ? [x / Math.hypot(x, y), y / Math.hypot(x, y)] : [0, -1];
		const offset = cloudUniforms.offset.value;
		// The noise is sampled at world × scale + offset, so it moves downwind as the offset falls.
		offset.set((offset.x - dx * step) % 1, (offset.y - dy * step) % 1);
	}
}
