// Cinematic moments in the three.js view, played when a line of narration
// carries a cue (see Cue in $lib/game/chat.ts). The toll: the tower bell
// swings, the table shakes a little, and a huge dark shape passes slowly
// underneath; its dust, shockwave and debris are the particle layer's
// (vfx-toll.ts, #317), which has the bell's place. Presentation only: driven by the
// wall clock like the dice, and never sent over the network. With reduced
// motion the bell still swings, gently, and nothing else moves. The flash:
// the whole table lights up at once (the renderer hands its strength to
// `AtmosphereLayer.setFlash`, exposure, bloom and the sky light, and to
// `CellMaps.setFlash`, which thins the dark in every material's
// `worldModify`) and fades back into the dark over FLASH_MS, exactly as long
// as the server lights the table for. Its envelope is flash.ts's `flashAt`:
// a cue while one plays holds it on, and Reduce flashing (#223) makes it a
// slow, dimmer fade (`flashPolicy`). Reduced motion keeps it, as it is the
// one sign of what the server's fog is showing for that moment. Since #311 this rides in the lazy
// `vfx` chunk (vfx.ts re-exports it), out of the renderer chunk.

import * as THREE from 'three/webgpu';
import { FLASH_MS, type Cue } from '$lib/game/chat';
import { flashAt, flashPolicy, retrigger, type Flash, type FlashPolicy } from './flash';
import { standIn } from './warmup';

const TOLL_MS = 7000;
/** How long the ground's heave (#336) shudders the camera, ms. */
const HEAVE_MS = 900;

export interface EffectFrame {
	/** Still playing: render again. */
	active: boolean;
	/** How far the bell swings now (radians). */
	bellAngle: number;
	/** Camera shake to add this frame. */
	shake: THREE.Vector3;
	/** How bright a flash is now: 0 none, 1 everything lit. */
	flash: number;
	/** The policy it was shaped by, which also caps its lifts (flash.ts). */
	policy: FlashPolicy;
}

export class EffectsLayer {
	readonly group = new THREE.Group();
	private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private shadowTexture: THREE.CanvasTexture | null;
	private start = 0;
	private cue: Cue | null = null;
	/** The flash playing, or null. */
	private flash: Flash | null = null;
	private size = { w: 20, d: 20 };
	private reduced = false;
	/** Reduce flashing (#223): the flash's envelope and lifts follow this policy. */
	private policy = flashPolicy(false);
	private standIns: THREE.Object3D[] | null = null;
	/** When the ground last heaved (ms), for its shudder. */
	private heaved = -Infinity;

	constructor() {
		this.shadowTexture = shadowTexture();
		this.shadow = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				...(this.shadowTexture ? { alphaMap: this.shadowTexture } : {})
			})
		);
		this.shadow.rotation.x = -Math.PI / 2;
		// On the floor. Black over the world, so it adds nothing where the fog and the dark have
		// darkened it already, and the output stage re-masks hidden cells (#173).
		this.shadow.position.y = 0.014;
		this.shadow.renderOrder = 0.85;
		this.shadow.visible = false;
		this.shadow.raycast = () => {};
		this.group.add(this.shadow);
	}

	setReduceFlashing(on: boolean): void {
		this.policy = flashPolicy(on);
	}

	/** The table's size (world units), which the blot under the floor is sized by. */
	setBounds(width: number, depth: number): void {
		this.size = { w: width, d: depth };
		this.shadow.scale.set(width * 0.5, depth * 0.35, 1);
	}

	/** The ground heaves (a rupturing floor, #336): a short shudder; none with reduced motion. */
	heave(now: number, reducedMotion: boolean): void {
		if (!reducedMotion) this.heaved = now;
	}

	play(cue: Cue, now: number, reducedMotion: boolean): void {
		if (cue === 'flash') {
			this.flash = retrigger(this.flash, now, this.policy);
			return;
		}
		this.cue = cue;
		this.start = now;
		this.reduced = reducedMotion;
		if (reducedMotion) return;
		this.shadow.visible = true;
	}

	/** Advances the effect to wall-clock time `now`. */
	tick(now: number): EffectFrame {
		const frame: EffectFrame = {
			active: false,
			bellAngle: 0,
			shake: new THREE.Vector3(),
			flash: 0,
			policy: this.policy
		};
		if (this.flash) {
			frame.flash = flashAt(this.flash, now, this.policy);
			// Over once FLASH_MS has passed since the latest cue.
			if (now - this.flash.last < FLASH_MS) frame.active = true;
			else this.flash = null;
		}
		const h = now - this.heaved;
		if (h >= 0 && h < HEAVE_MS) {
			// A heave: heavier than the toll's shudder, mostly side to side, dying away.
			const k = (1 - h / HEAVE_MS) * 0.08;
			frame.active = true;
			frame.shake.set(
				Math.sin(h * 0.043) * k,
				Math.abs(Math.sin(h * 0.031)) * k * 0.6,
				Math.sin(h * 0.037) * k
			);
		}
		if (!this.cue) return frame;
		const t = (now - this.start) / 1000;
		if (t * 1000 >= TOLL_MS) {
			this.stop();
			return frame;
		}
		frame.active = true;
		// The bell: a decaying swing, gentler with reduced motion.
		const amplitude = this.reduced ? 0.12 : 0.45;
		frame.bellAngle = amplitude * Math.sin((t * Math.PI * 2) / 1.7) * Math.exp(-t / 2.6);
		if (this.reduced) return frame;

		// The structure answers: a short shudder as the note hits.
		const shudder = Math.max(0, 1 - t / 1.4) * 0.05;
		frame.shake.x += Math.sin(t * 61) * shudder;
		frame.shake.y += Math.sin(t * 47) * shudder * 0.5;
		frame.shake.z += Math.sin(t * 53) * shudder;

		// Something vast moving far below: a shadow crossing the floor, in and out.
		const k = t / (TOLL_MS / 1000);
		this.shadow.position.x = (k - 0.5) * this.size.w * 1.2;
		this.shadow.position.z = Math.sin(k * Math.PI) * this.size.d * 0.08;
		this.shadow.material.opacity = 0.7 * Math.sin(k * Math.PI);
		return frame;
	}

	/**
	 * A stand-in for the toll's shadow, which shows only while it plays, for the warm-up to compile
	 * (#180); like the shadow it is black or re-masked over hidden cells by the output stage (#173).
	 * The dust is the particle layer's (vfx.ts gallery).
	 */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			this.standIns = [new THREE.Mesh(this.shadow.geometry, this.shadow.material)];
			for (const o of this.standIns) standIn(o);
		}
		return this.standIns;
	}

	dispose(): void {
		this.shadow.geometry.dispose();
		this.shadow.material.dispose();
		this.shadowTexture?.dispose();
	}

	private stop(): void {
		this.cue = null;
		this.shadow.visible = false;
	}
}

/** A long soft blot, for the shape under the floor. Null where there is no canvas (tests). */
function shadowTexture(): THREE.CanvasTexture | null {
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
	gradient.addColorStop(0, '#fff');
	gradient.addColorStop(0.55, '#888');
	gradient.addColorStop(1, '#000');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(canvas);
}
