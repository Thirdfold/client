// The camera: orbit controls held by the rig (camera-rig.ts, #280), and the
// moves that take the camera for a moment (a mode change, a cinematic shot, a
// pivot sent somewhere) on the renderer's clock. Any drag or scroll ends a shot
// where it is. After the controls' update each frame the rig damps per second,
// sets the pivot on the floor under it, keeps it over the play area, steers
// the pitch by zoom and lifts the camera clear of the ground; a ring marks the
// pivot while the camera moves. A pose set from outside (`setPose`: tests,
// fixtures, a rebuilt tabletop) stands as given until the viewer takes hold.

import * as THREE from 'three/webgpu';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Shot } from '$lib/game/chat';
import type { Token } from '$lib/game/token';
import type { SceneObject } from '$lib/game/objects';
import {
	cellAt,
	clampPivot,
	CLEARANCE_CELLS,
	DAMPING,
	dampingFor,
	FOV,
	framePose,
	MAX_STOREYS,
	minCameraY,
	pitchForDistance,
	pivotBounds,
	pivotHeight,
	poseOf,
	POSED_FOV,
	restorePose,
	rigOf,
	savedCamera,
	steerPitch,
	TILT,
	wholeView,
	type CameraHold,
	type CameraMode,
	type RigPose
} from './camera-rig';
import { CAMERA_MODES, effectiveCurve, type CameraView, type Subject } from './camera-modes';
import { eyeLift, subjectRig, trackStep } from './camera-track';
import { loadCamera, saveCamera } from './camera-store';
import { CameraInput } from './camera-input';
import { Arm } from './spring-arm';
import type { Ground } from './ground';
import { shotAt, shotFocus, shotPose, type Pose } from './shots';
import type { Tabletop } from './types';
import { GROUND_CLEARANCE, MAX_POLAR_ANGLE, type PlayExtent } from './world-ground';

export const VIEW_TRANSITION_MS = 450;
/** How long the pivot ring takes to fade once the camera stops (ms). */
export const RING_FADE_MS = 300;
const RING_OPACITY = 0.8;
/** How quickly the pivot's height and a stray pitch ease back, as a factor at 60 Hz. */
const EASE = 0.15;
/** Below this (world units) the camera counts as still. */
const STILL = 1e-4;
/** Room past the tilt band for the controls' own clamp, so the rig's easing does the steering. */
const TILT_SLACK = TILT + 1e-3;

/** What the rig reads of the table each frame (only what the viewer was sent). */
export interface RigContext {
	grid: SquareGrid | null;
	ground: Ground | null;
	tokens: readonly Token[];
	/** The walls and doors the viewer was sent: what the spring arm keeps the camera out of (#290). */
	objects: readonly SceneObject[];
	/** The land beyond the grid's height (landscape.ts `heightAt`, #244). */
	land: { heightAt(x: number, z: number): number | null };
}

type Ends = { position: THREE.Vector3; target: THREE.Vector3; fov: number };

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

export class CameraRig {
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: MapControls;
	/** The pivot ring, in the overlay's scene (`beaconRing`'s shape): one instance or none. */
	readonly ring: THREE.InstancedMesh;
	/** What depth of field focuses on: the pivot, or a shot's focus during a shot (#165). */
	readonly focus = new THREE.Vector3();
	mode: CameraMode = 'overview';
	/** The view chosen (#289); `mode` is the framing curve it comes to (eye level may fall back). */
	view: CameraView = 'overview';
	/** The mini eye level stands at and follow follows (only ever one in the viewer's view). */
	private subject: string | null = null;
	/** The subject the viewer panned away from: following resumes when another is chosen. */
	private cancelled: string | null = null;
	/** Where following left the pivot, to tell a pan of the viewer's from its own easing. */
	private expect: { x: number; z: number } | null = null;
	private arm = new Arm();
	/** A cinematic shot in progress: where the camera was, where it goes, since when. */
	private shot: { home: Pose; to: Pose; start: number } | null = null;
	private transition: { from: Ends; to: Ends; start: number } | null = null;
	/** Set from outside (`setPose`): left as it is until the viewer takes hold of the camera. */
	private posed = false;
	/** A framing due at the next update, once the table's tokens are in: restored or eased. */
	private pending: { restore: boolean; ease: boolean } | null = null;
	/** Nothing framed yet: the first framing may restore the stored pose. */
	private first = true;
	private play: PlayExtent | null = null;
	private own: ReadonlySet<string> = new Set();
	private input: CameraInput;
	private storeys = 0;
	private tilt = 0;
	private reduced = false;
	private key: string | null = null;
	private last = {
		time: -Infinity,
		distance: 0,
		position: new THREE.Vector3(),
		target: new THREE.Vector3()
	};
	/** When the camera stopped (the ring fading), or null while it moves or the ring is out. */
	private stopped: number | null = null;
	private material = new THREE.MeshBasicMaterial({
		color: 0xbfe6ff,
		transparent: true,
		opacity: RING_OPACITY,
		side: THREE.DoubleSide,
		depthWrite: false
	});
	private matrix = new THREE.Matrix4();
	private offset = new THREE.Vector3();
	private spherical = new THREE.Spherical();

	/** The far plane is the table's (`fitToTable`). */
	constructor(
		canvas: HTMLCanvasElement,
		private readonly request: () => void,
		private readonly context: () => RigContext,
		/** The viewer's first pan or turn (#279); never a shot or a programmatic move. */
		onMoved: () => void = () => {}
	) {
		this.camera = new THREE.PerspectiveCamera(FOV[this.mode], 1, 0.1);
		this.controls = new MapControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.screenSpacePanning = false;
		// Down to the horizon (#220); the rig keeps it off the ground and steers the pitch.
		this.controls.maxPolarAngle = MAX_POLAR_ANGLE;
		this.controls.minDistance = 3;
		// The viewer took hold: a pose set from outside gives way to the rig.
		this.controls.addEventListener('start', () => (this.posed = false));
		this.input = new CameraInput(canvas, this.controls, {
			request,
			hold: () => this.takeHold(),
			storey: (n) => this.api.raisePivot(n),
			moved: onMoved,
			reduced: () => this.reduced
		});
		// Made with the layer and always in the overlay, drawing nothing at count 0, so the warm-up
		// compiles it and showing it compiles nothing.
		const shape = new THREE.RingGeometry(0.36, 0.48, 32).rotateX(-Math.PI / 2);
		this.ring = new THREE.InstancedMesh(shape, this.material, 1);
		this.ring.frustumCulled = false;
		this.ring.renderOrder = 2;
		this.ring.count = 0;
	}

	/** For #279's keys and the stored pose; each asks for a frame. */
	readonly api: Pick<
		Tabletop,
		'raisePivot' | 'cameraHome' | 'focusCell' | 'setCameraStore' | 'holdCamera' | 'snapTurn'
	> = {
		raisePivot: (storeys) => {
			this.storeys = Math.max(-MAX_STOREYS, Math.min(MAX_STOREYS, this.storeys + storeys));
			this.posed = false;
			this.request();
		},
		cameraHome: () => {
			if (this.play) this.pending = { restore: false, ease: true };
			this.request();
		},
		focusCell: (cell) => this.focusCell(cell),
		setCameraStore: (key) => {
			this.key = key;
		},
		holdCamera: (key: CameraHold | null, down: boolean) => {
			if (key) this.input.hold(key, down);
			else this.input.release();
		},
		snapTurn: (dir) => this.input.snapTurn(dir)
	};

	/** The viewer took hold of the camera: a shot, a move or a set pose gives way. */
	private takeHold(): void {
		this.shot = this.transition = null;
		this.posed = false;
	}

	/** Ends a cinematic shot where it is (the viewer took hold of the camera). */
	endShot(): void {
		this.shot = null;
	}

	setReducedMotion(reduced: boolean): void {
		this.reduced = reduced;
		if (reduced) this.endShot();
	}

	/** The viewer's own tokens, which the first framing centres on. */
	setOwn(ids: readonly string[]): void {
		this.own = new Set(ids);
	}

	/**
	 * A new table: framed on the whole of it at once, then on the party at the next update (the
	 * stored pose instead, the first time). Replaces any move still aimed at the old one.
	 */
	frame(play: PlayExtent): void {
		this.play = play;
		this.range();
		this.transition = this.shot = null;
		this.posed = false;
		this.setRig(poseOf(wholeView(this.mode, play.frame, play.cellSize)), FOV[this.mode]);
		this.reframe();
	}

	/** The table was replaced at the same size (travel, a load): framed again on the party. */
	reframe(): void {
		if (!this.play) return;
		this.pending = { restore: this.first, ease: false };
		this.first = false;
		this.request();
	}

	/** Moves to a view's framing (at once if nothing is framed yet) on `subject`, which eye level and follow attach to. */
	setMode(view: CameraView, now: number, subject: string | null = null): void {
		if (subject !== this.subject && subject !== this.cancelled) this.cancelled = null;
		const [was, wasView] = [this.mode, this.view];
		[this.view, this.subject] = [view, subject];
		this.mode = effectiveCurve(view, this.token());
		if (this.mode === was && view === wasView) return;
		this.range();
		if (!this.play || this.pending) return;
		this.posed = false;
		const to = this.framing();
		if (to) this.moveTo(poseOf(to), now);
		this.request();
	}

	private token(): Subject | null {
		return this.context().tokens.find((t) => t.id === this.subject) ?? null;
	}

	private range(): void {
		const { min, max } = CAMERA_MODES[this.view].distance;
		const cell = this.context().grid?.cellSize ?? 1;
		this.controls.minDistance = Math.max(0.5, min * cell);
		const far = this.play?.maxDistance ?? Infinity;
		this.controls.maxDistance = Math.min(far, max ? max * cell : Infinity);
	}

	pose(): Pose {
		const { position: p } = this.camera;
		const { target: t } = this.controls;
		return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z } };
	}

	/** Puts the camera at a pose as given, with the field of view from before the rig. */
	setPose(pose: Pose): void {
		this.shot = this.transition = this.pending = null;
		this.posed = true;
		this.setRig(pose, POSED_FOV);
	}

	playShot(next: Shot, grid: SquareGrid, ground: Ground | null, extent: number, now: number): void {
		this.transition = null;
		const home = this.pose();
		const focus = next.focus && {
			...gridToWorld(grid, next.focus),
			y: ground?.floorY(next.focus) ?? 0
		};
		this.shot = { home, to: shotPose(home, focus, next.frame, extent, grid.cellSize), start: now };
	}

	/** How much of the shot's depth of field shows at `now` (0 with no shot, or one cut short). */
	focusAt(now: number): number {
		return this.shot ? shotFocus(now - this.shot.start) : 0;
	}

	/** Advances a shot or a move to `now`. Returns true while one is still playing. */
	tick(now: number): boolean {
		let playing = false;
		if (this.shot) {
			const { pose, done } = shotAt(this.shot.home, this.shot.to, now - this.shot.start);
			this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
			this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
			if (done) this.shot = null;
			else playing = true;
		}
		if (this.transition) {
			const t = Math.min((now - this.transition.start) / VIEW_TRANSITION_MS, 1);
			const k = 1 - (1 - t) ** 3;
			const { from, to } = this.transition;
			this.camera.position.lerpVectors(from.position, to.position, k);
			this.controls.target.lerpVectors(from.target, to.target, k);
			this.setFov(from.fov + (to.fov - from.fov) * k);
			if (t === 1) this.transition = null;
			else playing = true;
		}
		return playing;
	}

	/**
	 * After the frame's readers: the controls' damped update, then the rig's hold on the camera.
	 * Returns true while it still eases or the ring still fades (the scheduler's active frames).
	 */
	update(now: number): boolean {
		const dt = now - this.last.time;
		this.last.time = now;
		// A first frame, a held clock or one after a pause counts as a frame at 60 Hz.
		const step = dt > 0 && dt < 100 ? dt : 16.67;
		this.controls.dampingFactor = dampingFor(step, DAMPING);
		const keys = this.input.tick(step); // held pan and turn keys, snaps (#279)
		if (this.pending) this.framePending(now);
		if (effectiveCurve(this.view, this.token()) !== this.mode)
			this.setMode(this.view, now, this.subject);
		const free = !this.shot && !this.transition && !this.posed;
		if (!free) [this.controls.minPolarAngle, this.controls.maxPolarAngle] = [0, MAX_POLAR_ANGLE];
		this.controls.update();
		const { grid, ground, land, objects } = this.context();
		if (!grid || !ground || !this.play) return keys;
		const { position: p, target: t } = {
			position: this.camera.position,
			target: this.controls.target
		};
		const easing = free && this.follow(grid, step);
		if (free) this.hold(grid, ground, dt);
		// Never under the ground, shots included; a set pose only over its own cell, as before.
		const radius = this.posed ? 0 : CLEARANCE_CELLS;
		const lift = () => (p.y = Math.max(p.y, minCameraY(ground, grid, p, radius, land.heightAt)));
		lift();
		if (free && !this.posed && CAMERA_MODES[this.view].arm) {
			const clear = GROUND_CLEARANCE * grid.cellSize;
			const d = this.arm.step(ground, objects, grid, t, p, clear, step, this.reduced);
			p.copy(t).add(this.offset.subVectors(p, t).setLength(d));
			lift();
		} else this.arm.reset();
		this.expect = free ? { x: t.x, z: t.z } : null;
		this.focus.copy(t);
		const moved =
			p.distanceTo(this.last.position) > STILL || t.distanceTo(this.last.target) > STILL;
		this.last.position.copy(p);
		this.last.target.copy(t);
		this.last.distance = p.distanceTo(t);
		return (
			this.showRing(moved && free, now, grid, ground) || moved || keys || easing || this.arm.easing
		);
	}

	dispose(): void {
		this.input.dispose();
		this.controls.dispose();
		this.ring.dispose();
		this.ring.geometry.dispose();
		this.material.dispose();
	}

	/** Eye level and follow: the pivot (and camera) ease to the subject; a pan of the viewer's ends it. */
	private follow(grid: SquareGrid, dt: number): boolean {
		const s = CAMERA_MODES[this.view].tracks ? this.token() : null;
		if (!s || s.id === this.cancelled) {
			this.expect = null;
			return false; // nothing to ease to: the camera rests
		}
		const t = this.controls.target;
		const step = trackStep(t, gridToWorld(grid, s.pos), this.expect, dt, this.reduced);
		if (step.panned) this.cancelled = s.id;
		this.offset.set(step.dx, 0, step.dz);
		t.add(this.offset);
		this.camera.position.add(this.offset);
		return step.easing;
	}

	/** The pivot on the floor under it and over the play area, the pitch on the mode's curve. */
	private hold(grid: SquareGrid, ground: Ground, dt: number): void {
		const { position: p, target: t } = {
			position: this.camera.position,
			target: this.controls.target
		};
		const k = this.reduced ? 1 : dampingFor(dt > 0 && dt < 100 ? dt : 16.67, EASE);
		this.offset.subVectors(p, t);
		const c = clampPivot(pivotBounds(this.play!), t);
		const lift = this.view === 'eye' ? eyeLift(grid.cellSize) : 0;
		const wanted = lift + pivotHeight(ground, cellAt(grid, c.x, c.z), this.storeys, grid.cellSize);
		t.set(c.x, Math.abs(wanted - t.y) < STILL ? wanted : t.y + (wanted - t.y) * k, c.z);
		this.spherical.setFromVector3(this.offset);
		const d = this.spherical.radius;
		const base = pitchForDistance(d / grid.cellSize, this.mode);
		const zoomed = Math.abs(d - this.last.distance) > STILL;
		const steered = steerPitch(Math.PI / 2 - this.spherical.phi, base, this.tilt, zoomed, k);
		this.tilt = steered.tilt;
		this.spherical.phi = Math.PI / 2 - steered.pitch;
		p.setFromSpherical(this.spherical).add(t);
		// The controls' own clamp agrees with the band, and never snaps a pitch outside it.
		const polar = this.spherical.phi;
		this.controls.minPolarAngle = Math.min(polar, Math.PI / 2 - (base + this.tilt) - TILT_SLACK);
		this.controls.maxPolarAngle = Math.max(polar, Math.PI / 2 - (base + this.tilt) + TILT_SLACK);
		this.setFov(FOV[this.mode]);
	}

	/** Shows the ring at the pivot while the camera moves, fading it once it stops. */
	private showRing(moving: boolean, now: number, grid: SquareGrid, ground: Ground): boolean {
		const t = this.controls.target;
		if (moving) {
			this.stopped = null;
			this.material.opacity = RING_OPACITY;
			const y = ground.floorY(cellAt(grid, t.x, t.z)) + 0.03 * grid.cellSize;
			const s = grid.cellSize;
			this.matrix.makeScale(s, s, s).setPosition(t.x, y, t.z);
			this.ring.setMatrixAt(0, this.matrix);
			this.ring.instanceMatrix.needsUpdate = true;
			this.ring.count = 1;
			return true;
		}
		if (this.ring.count === 0) return false;
		if (this.stopped === null) {
			this.stopped = now;
			if (this.key && !this.posed && !this.shot)
				saveCamera(this.key, savedCamera(grid, rigOf(this.pose()), this.storeys, this.tilt));
		}
		const left = this.reduced ? 0 : 1 - (now - this.stopped) / RING_FADE_MS;
		this.material.opacity = RING_OPACITY * Math.max(0, left);
		if (left > 0) return true;
		this.ring.count = 0;
		return false;
	}

	/** The framing a new table, `cameraHome` or a mode change goes to; null before a table. */
	private framing(): RigPose | null {
		const { grid, ground, tokens } = this.context();
		if (!grid || !ground || !this.play) return null;
		const yaw = rigOf(this.pose()).yaw;
		const on = subjectRig(this.view, this.token(), grid, ground, yaw);
		return on ?? framePose(tokens, this.own, grid, ground, this.mode, this.play.frame);
	}

	private framePending(now: number): void {
		const { grid, ground } = this.context();
		const pending = this.pending!;
		if (!grid || !ground) return;
		this.pending = null;
		this.storeys = this.tilt = 0;
		const stored = pending.restore && this.view !== 'eye' ? loadCamera(this.key, grid) : null;
		if (stored) {
			this.storeys = stored.storeys;
			this.tilt = stored.tilt;
		}
		const to = stored ? restorePose(stored, grid, ground, this.mode) : this.framing();
		if (!to) return;
		if (pending.ease) return this.moveTo(poseOf(to), now);
		this.setRig(poseOf(to), FOV[this.mode]);
		// Placed, not moved: no ring over a table that just arrived.
		this.last.position.copy(this.camera.position);
		this.last.target.copy(this.controls.target);
	}

	/** Eases the pivot onto a cell (at once under reduced motion), keeping the view's angle. */
	private focusCell(cell: GridPos): void {
		const { grid, ground } = this.context();
		if (!grid || !ground) return;
		const at = gridToWorld(grid, cell);
		const y = pivotHeight(ground, cell, this.storeys, grid.cellSize);
		const { position: p, target: t } = this.pose();
		const position = { x: at.x + p.x - t.x, y: y + p.y - t.y, z: at.z + p.z - t.z };
		this.posed = false;
		this.moveTo({ position, target: { x: at.x, y, z: at.z } }, this.last.time);
		this.request();
	}

	/** A move to `pose` over `VIEW_TRANSITION_MS`, or at once under reduced motion. */
	private moveTo(pose: Pose, now: number): void {
		this.shot = null;
		if (this.reduced) return this.setRig(pose, FOV[this.mode]);
		const from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
		const to = { position: vec(pose.position), target: vec(pose.target), fov: FOV[this.mode] };
		this.transition = { from: { ...from, fov: this.camera.fov }, to, start: now };
	}

	private setRig(pose: Pose, fov: number): void {
		this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
		this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
		this.setFov(fov);
	}

	/** A field of view: only the projection changes, never a shader. */
	private setFov(fov: number): void {
		if (this.camera.fov === fov) return;
		this.camera.fov = fov;
		this.camera.updateProjectionMatrix();
	}
}
