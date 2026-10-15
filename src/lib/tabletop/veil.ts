// The air's volumes (M75 #374 the fog-of-war cloud, #375 ground mist, #376 halos' strength), in the
// lazy `vfx` chunk: loops on the particle layer's soft pool, laid out by veil-plan.ts from the
// viewer's own masks, their density worked out in the particle graph from the cell maps
// (materials/vfx.ts `airDensity`), so the cloud parts as cells are revealed with the reveal fade
// (FADE_MS; instant under reduced motion) and hidden cells stay exactly black under it.
//
// `tick` runs just before the particle layer's own (like air.ts), lays out again only when what the
// viewer was sent, the tier or the world's mist (on or off) changed or the camera's target moved two
// units, and sets the three strengths each frame (`vfxUniforms.air`): the cloud (a player's whole,
// the GM's faint, 0 with fog off), the mist (the world's amount, `mistAmount`) and the halos (the
// fires' glow in the air, fire.ts `haloLoop`: faint in clear air, full in mist). Off on low (compat
// WebGPU and software GL land there) and with `?off=mist`. It asks for no frame: loops are AMBIENT
// while in view (vfx.ts `inView`), none under reduced motion, where the puffs hold their stagger.

import type { WorldLook } from '$lib/game/world';
import { decodeMask, type FogView } from '$lib/game/visibility';
import type { AirDeps } from './air';
import type { FogMode } from './fog';
import { vfxUniforms } from './materials/vfx';
import type { QualitySettings, Tier } from './quality';
import { CLOUD_GAIN, mistAmount, veilPlan } from './veil-plan';
import type { LoopSpec } from './vfx-state';

/** What the air reads beyond the air layer's view: the fog, the world's look, dark areas, roofs. */
export type VeilView = readonly [
	{ fog: FogView | null; mode: FogMode },
	WorldLook | null,
	Uint8Array | null,
	Uint8Array | null
];

/** How strong a fire's halo is in clear air; it rises to 1 with the mist and the haze. */
export const HALO_CLEAR = 0.3;

interface Sink {
	syncLoops(prefix: string, wanted: ReadonlyMap<string, LoopSpec>): void;
}

export class VeilLayer {
	private tier: Tier = 'medium';
	private on = true;
	private last: unknown[] = [];
	private masks: { fog: unknown; visible: Uint8Array | null; explored: Uint8Array | null } = {
		fog: undefined,
		visible: null,
		explored: null
	};

	constructor(
		private readonly vfx: Sink,
		private readonly deps: AirDeps
	) {}

	/** The tier's reach, and the `mist` layer switch (`?off=mist`); nothing on low. */
	setTier(settings: QualitySettings): void {
		this.tier = settings.tier;
		this.on = settings.layers.mist && settings.tier !== 'low';
	}

	tick(): void {
		const [grid, shape, , , band] = this.deps.view();
		const veil = this.deps.veil?.();
		const strengths = vfxUniforms.air.value;
		if (!grid || !shape || !veil) return void strengths.set(0, 0, 0);
		const [{ fog, mode }, world, darkness, interior] = veil;
		const mist = this.on ? mistAmount(world, band) : 0;
		const fogged = this.on && !!fog?.enabled;
		const haze = Math.max(mist, world?.haze.density ?? 0);
		strengths.set(
			fogged ? CLOUD_GAIN[mode] : 0,
			mist,
			this.on ? HALO_CLEAR + (1 - HALO_CLEAR) * haze : 0
		);
		const target = this.deps.target;
		const spot = `${Math.floor(target.x / 2)},${Math.floor(target.z / 2)}`;
		const seen = [grid, shape, fog, mode, darkness, interior, this.tier, fogged, mist > 0, spot];
		if (seen.every((v, i) => v === this.last[i])) return;
		this.last = seen;
		const wanted = new Map<string, LoopSpec>();
		if (this.on) {
			const { visible, explored } = this.decode(fog, grid.width * grid.height);
			const plan = veilPlan({
				grid,
				target,
				tier: this.tier,
				fog: fogged,
				visible,
				explored,
				known: shape.known,
				levels: shape.levels,
				water: shape.water,
				darkness,
				interior,
				mist
			});
			// Farthest first: over the pool's cap the layer leaves out the oldest, the farthest.
			plan.cloud.reverse().forEach((l, i) => wanted.set(`veil:c${i}`, l));
			plan.mist.reverse().forEach((l, i) => wanted.set(`veil:m${i}`, l));
		}
		this.vfx.syncLoops('veil:', wanted);
	}

	dispose(): void {
		this.vfx.syncLoops('veil:', new Map());
		vfxUniforms.air.value.set(0, 0, 0);
	}

	/** The fog's masks, decoded once per fog the viewer is sent. */
	private decode(fog: FogView | null, size: number) {
		if (this.masks.fog !== fog) {
			const on = fog?.enabled ? fog : null;
			this.masks = {
				fog,
				visible: on ? decodeMask(on.visible, size) : null,
				explored: on ? decodeMask(on.explored, size) : null
			};
		}
		return this.masks;
	}
}
