// three.js view of the tabletop. Pure presentation: it is handed domain data (grid, tokens, walls
// and doors, selection, editor previews) and reports what the user pointed at in grid terms: cell,
// corner, edge, token and object ids. It never owns or mutates game state. Renders on demand rather
// than every frame, so an idle table costs nothing. Every animation runs on one clock
// (`TabletopOptions.now`); tests hold it still (a fixed pixel ratio, reduced motion, a posed
// camera), so a table always draws the same pixels; only perf.ts times cost. Its pieces live beside
// it, one per concern (docs/RENDERING.md, Modules).

import * as THREE from 'three/webgpu';
import { sameGrid, type SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { FogView } from '$lib/game/visibility';
import { AtmosphereLayer } from './atmosphere';
import { CameraRig } from './camera';
import { QualityControl } from './capabilities';
import { CellMaps } from './cell-maps';
import { cutApi } from './cut-layer';
import { DiceLayer, throwFromView } from './dice3d';
import { FogCloudLayer } from './fog-cloud';
import { loadEnvironment, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import type { Ground } from './ground';
import { labelFontReady } from './label-font';
import { LodWatch } from './lod-watch';
import { WorldGround } from './landscape';
import { LightingLayer, ProbeLayer } from './lighting';
import { frameOverview, Gallery, warmUp } from './warmup';
import { advanceNodeFrame, createNodeRenderer, setUpRenderer, watchReducedMotion } from './loop';
import { RenderScheduler, type FrameReport } from './scheduler';
import { instrument, PerfRecorder, perfMethods } from './perf';
import { placePose } from './poses';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { listenForPicks, Picker } from './picking';
import { PreviewLayer } from './previews';
import { initModels, loadProgress, loadsSettled, prefetch, releaseModels } from './models';
import { PropLayer } from './props';
import { createScene, createSceneLights, fitToTable } from './scene-lights';
import { TokenLayer } from './tokens';
import type { QualitySettings } from './quality';
import type { Tabletop, TabletopEvents, TabletopOptions } from './types';
import { WallLayer } from './walls';
import { loadWorld, WorldLayer } from './world-layer';
export { warmLobby } from './lobby-load'; // the lobby's warm-up (#180), a lazy chunk
export { loadWorld } from './world-layer';

export async function createTabletop(
	canvas: HTMLCanvasElement,
	events: TabletopEvents,
	options: TabletopOptions = {}
): Promise<Tabletop> {
	const clock = options.now ?? (() => performance.now());
	// A renderer the lobby warmed up (lobby.ts, #180) comes with its shaders compiled.
	const made = options.warm?.renderer ?? createNodeRenderer(canvas, options);
	// Lazy chunks (world, water #293, grass #302 with wind, decor, vfx and effects), before drawing.
	const w$ = import('./water-layer').then((m) => m.ready);
	const g$ = import('./grass').then(async (m) => [m, await m.decor, await m.vfx] as const);
	const [renderer, build, Water, [G, Decor, Fx]] = await Promise.all([made, loadWorld(), w$, g$]);
	if (options.warm) setUpRenderer(renderer, options);
	initModels(renderer); // models upload to it; the last table's dispose frees them
	let shadowsDirty = true;
	let shadowMapDrawn = false; // a shadow map never drawn reads as garbage: the first frame draws it
	let [wasMoving, steady] = [false, false]; // moved last frame (shadows); drawn at play, no gallery or loads
	const perf = new PerfRecorder();
	if (options.warm) perf.add('lobby', options.warm.warmupMs);
	const loop = new RenderScheduler(render, canvas);
	const requestRender = loop.request;
	const scene = createScene();
	const rig = new CameraRig(
		canvas,
		requestRender,
		() => ({ grid, ground, tokens, land, objects }),
		() => events.onCamera?.() // #279
	);
	const { camera, controls } = rig;
	const [lights, overlay] = [createSceneLights(scene), new OverlayLayer()];
	const post = new Post(renderer, scene, camera, overlay.scene, (now) => ({
		reduced: reducedMotion,
		shot: rig.focusAt(now),
		tactical: rig.mode === 'overview',
		target: rig.focus, // the pivot, or a shot's focus (#280)
		pull: camera.position.distanceTo(controls.target) / controls.maxDistance
	}));
	post.grade.onLoad = requestRender; // another tone mapper's grades arrived: blend them in
	const land = new WorldGround(scene, build); // the ground to the horizon and beyond (#220, #244)
	/** A model arrived: warm up its shaders, then draw it (shadows too). */
	const onModel = () => {
		shadowsDirty = warmPending = lods.due = true;
		refreshLighting(); // a fixture to draw, or a prop's flame to seat its light on
	};
	let warmPending = true; // new shaders to compile before the next frame (warmup.ts)
	let warming: Promise<void> = Promise.resolve();
	const warmCamera = new THREE.PerspectiveCamera(60, 1, 0.1);
	const tokenLayer = new TokenLayer(overlay, onModel, clock, requestRender);
	const water = new Water(build, perf, tokenLayer.rootOf, requestRender); // #293
	const wallLayer = new WallLayer(build, clock); // kit pieces by chunk (#252), roofs (#257)
	scene.add(tokenLayer.group, wallLayer.group);
	let [floor, lawn]: [Uint8Array | null, Uint8Array | null | undefined] = [null, undefined]; // lawn: the GM's grass paint (M74)
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const cellMaps = new CellMaps(clock); // every material's fog and dark (worldModify, #171, #173)
	const cloud = new FogCloudLayer(); // #174: over a player's hidden cells, with its layer on
	const [diceLayer, decor] = [new DiceLayer(), new Decor(build, perf, requestRender)];
	const grass = new G.GrassLayer(perf, tokenLayer, diceLayer, cellMaps); // #302; wind: #300
	const vfx = new Fx.VfxLayer(requestRender, {
		roofs: wallLayer.roofs, // chimney smoke (#319)
		target: controls.target, // the motes round it (#318)
		view: () => [grid, worldLayer.shape, props, environment, lightState[0], grass.lawn]
	}); // the particle layer (#311): bursts and loops; its air (#318, #319)
	const play = Fx.vfxPlayer(vfx, decor.decals); // combat and status effects (#315, #316)
	scene.add(cloud.group, diceLayer.group, grass.group, decor.group, vfx.group); // decor: #305
	const motion = watchReducedMotion(options.reducedMotion, (reduced) => {
		reducedMotion = reduced;
		for (const l of stillable()) l.setReducedMotion(reduced); // instant reveals, a still cloud
		rig.setReducedMotion(reduced); // ends a shot; camera moves jump
		refreshLighting();
	});
	let reducedMotion = motion.reduced; // read live: a change applies at once, without a reload
	const gm = () => fogState.mode === 'gm'; // effect props are markers for the GM alone (#319)
	const propLayer = new PropLayer(onModel, clock, tokenLayer.contact, build, gm); // contact shadows (#271), decor jitter (#306), plants (#304)
	const lods = new LodWatch(camera, canvas, [tokenLayer, propLayer], perf); // levels (#274)
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer(lights.grid, onModel, lights.heroes, requestRender, vfx.fire);
	scene.add(propLayer.group, lighting.group, water.group);
	const hooks = { post, lighting, walls: wallLayer, renderer, perf, request: requestRender };
	const atmosphere = new AtmosphereLayer({ ...lights, ...hooks }, clock, refreshLighting);
	const { sky } = atmosphere; // the dome, or the horizon's colour on low (#214)
	scene.add(sky.group);
	let lightState: Parameters<Tabletop['setLighting']> = ['day', []]; // band, lights, look
	let darkness: Uint8Array | null = null;
	let freshTable = false; // the table was just replaced: the next tokens snap into place
	const stillable = () => [loop, propLayer, wallLayer, cellMaps, cloud, sky, lighting, tokenLayer];
	for (const l of stillable()) l.setReducedMotion(reducedMotion);
	const worldLayer = new WorldLayer(perf, land, build, propLayer.drops, onModel); // #240, #254, #255
	water.attach(land, worldLayer); // the sea ring's swell (#296), the molten chasm (#297)
	const [effects, previews] = [new Fx.EffectsLayer(), new PreviewLayer()];
	scene.add(worldLayer.group, effects.group);
	const world = [diceLayer, effects, cloud, sky, worldLayer, wallLayer, water, grass, vfx];
	const gallery = new Gallery(scene, overlay.scene, world, [tokenLayer, worldLayer.grid]);
	overlay.scene.add(previews.group, worldLayer.grid.group, rig.ring); // grid (#245), pivot (#280)
	// Labels drawn before the label font arrived are drawn again in it.
	void labelFontReady.then(() => {
		if (disposed) return;
		tokenLayer.labels.redraw();
		requestRender();
	});
	let [levels, ground]: [Uint8Array | null, Ground | null] = [null, null];
	let [disposed, swinging]: [boolean, string | null] = [false, null]; // swinging: a cue's bell
	const shakeOffset = new THREE.Vector3();
	/**
	 * Light depends on tokens (carried light), walls, fog and lights: worked out again when they
	 * change, once just before the next frame however many updates came together (a new table).
	 */
	let lightingStale = false;
	function refreshLighting(): void {
		lightingStale = true;
		requestRender();
	}

	function relight(): void {
		lightingStale = false;
		if (!grid) return;
		const [ambient, lights, world = null] = lightState;
		atmosphere.setWorld(world, ambient, environment, reducedMotion);
		land.setBackdrop(world, environment); // what lies beyond the grid (#244)
		const blocked = obstaclesFor(grid, objects, props, levels, floor);
		propLayer.setLights(lights); // the flames on props, lit by a light on their cell (#232)
		lighting.update(grid, ambient, lights, tokens, blocked, ground, darkness, props, floor);
		lighting.showHandles(grid, lights, ground, fogState.mode === 'gm');
		const shape = worldLayer.shape!; // the continued maps (#240)
		cellMaps.update(grid, fogState, ambient, lighting.levels, darkness, shape.floor, shape.levels);
		water.update(grid, shape, props, objects, tokens, world, environment); // #292, #293
		grass.update(shape, props, environment, lawn); // #302, its wind (#300)
		decor.update(shape, props, environment, quality.current, cellMaps.interior); // #305
		cloud.update(grid, fogState.fog, fogState.mode);
		post.setLook(environment, grid.cellSize, look?.grades ?? null, ambient); // AO, grade
	}

	/** Tokens drawn lying down; kept here so newly synced minis pick it up. */
	let fallen: ReadonlySet<string> = new Set();
	let [tokens, objects]: [readonly Token[], readonly SceneObject[]] = [[], []];
	let grid: SquareGrid | null = null; // fits: a per-cell map of the grid's size, or null
	const view = () => ({ grid, ground, tokens, props, objects, focus: controls.target }); // vfx
	const fits = (m: Uint8Array | null) => (m?.length === grid!.width * grid!.height ? m : null);
	let frame = 20; // what views and shots frame: the play area and a margin (world-ground.ts)
	options.devScene?.(scene, () => ((shadowsDirty = true), requestRender()));
	/** Draws one frame: counters and the node frame are advanced here, since the internal loop is off. */
	function drawScene(): void {
		renderer.info.reset();
		advanceNodeFrame(renderer);
		post.render(clock());
	}

	function render(): FrameReport {
		if (warmPending && grid) return startWarmUp();
		const start = performance.now();
		perf.frame(start);
		const report = drawFrame(clock());
		perf.add('frame', performance.now() - start);
		return report;
	}

	/** Compiles the table's shaders while frames are held, then draws (the sun's shadow too). */
	function startWarmUp(): FrameReport {
		warmPending = false;
		if (lightingStale) perf.time('lighting', relight);
		atmosphere.frame(clock()); // the first capture: no frame draws with an empty cube
		const t0 = performance.now();
		frameOverview(warmCamera, frame, camera.aspect);
		const targets = { scene: post.targets(), overlay: post.overlayTargets() };
		warming = warmUp(renderer, warmCamera, gallery.batches(targets)).then(() => {
			perf.add('warmup', performance.now() - t0);
			shadowsDirty = gallery.due = true;
		});
		loop.hold(warming);
		loop.request();
		return { active: false, ambient: false };
	}

	/** Draws a frame for time `now` and reports what still moves or animates (scheduler.ts). */
	function drawFrame(now: number): FrameReport {
		if (lightingStale) perf.time('lighting', relight);
		const tokensMoving = lighting.carry(tokenLayer, tokenLayer.tick(now, camera.position)); // lights too
		const doorsMoving = wallLayer.tick(now);
		const diceRolling = diceLayer.tick(now);
		const fx = effects.tick(now);
		atmosphere.setFlash(fx.flash, fx.policy);
		cellMaps.setFlash(fx.flash);
		const bellSwinging = !!swinging;
		if (swinging) propLayer.setSwing(swinging, fx.bellAngle);
		if (!fx.active) swinging = null;
		if (vfx.tick(now, reducedMotion).bursting) fx.active = true; // particles (#311): ACTIVE
		const propsMoving = propLayer.tick(now);
		// Only what casts shadows redraws them: dust, a flash or a shudder move none.
		const casters = tokensMoving || doorsMoving || diceRolling || propsMoving || bellSwinging;
		if (casters || wasMoving) shadowsDirty = true;
		wasMoving = casters;
		const shooting = rig.tick(now); // first, so the pivot's readers below see this frame's camera
		const flickering = lighting.animating(camera, now, controls.target, gallery.due); // #230, #231
		const drifting = [worldLayer.tick(now, reducedMotion, controls.target), cloud.tick(now)]; // #243, #254
		drifting.push(tokenLayer.pulsing, water.tick(now, reducedMotion, camera, tokensMoving)); // #265, #293
		drifting.push(grass.tick(now, loop.still, camera, controls.target, casters)); // wind, #302
		drifting.push(grass.wind.on && propLayer.foliageInView(camera), decor.tick(camera)); // #304, #305
		drifting.push(vfx.inView(camera)); // particle loops in view (#311)
		const turning = atmosphere.tick(now, cellMaps.focusAt(controls.target.x, controls.target.z));
		atmosphere.frame(now); // the sky's clock, and its capture when due (#216)
		const revealing = cellMaps.tick(now) || propLayer.drops.active; // reveals (#174), drops (#249)
		const fading = wallLayer.roofs.tick(now, controls.target) || tokenLayer.posing; // #259, #272: no shadows
		const steering = rig.update(now); // damping, pivot, bounds, pitch, clearance, ring (#280)
		const moving = casters || turning || revealing || fading || fx.active || shooting || steering;
		lods.run(quality.current.tier); // levels by the camera, never the shadows (#274)
		shakeOffset.copy(fx.shake); // a shudder from a cue: the camera's offset, this frame only
		camera.position.add(shakeOffset);
		const hideGallery = gallery.show(); // drawn once after a warm-up, out of sight (warmup.ts)
		steady = !hideGallery && loadsSettled();
		if (atmosphere.shadowFrame(shadowsDirty, !shadowMapDrawn || !!hideGallery))
			perf.add('shadows', 0);
		if (lights.sun.intensity > 0) shadowsDirty = false; // with the key light out, until it is back
		shadowMapDrawn = true;
		const draw = performance.now();
		drawScene();
		hideGallery?.();
		perf.add('draw', performance.now() - draw);
		camera.position.sub(shakeOffset);
		return { active: moving || post.blending, ambient: flickering || drifting.includes(true) };
	}

	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;
	const replan = () =>
		prefetch({ environment, tokens, props }, grid, controls.target, post.toneMapper);

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		land.dress(look, grid);
		worldLayer.setLook(look, grid, environment);
		wallLayer.setLook(look?.walls ?? null, look?.kit ?? null, look?.roof ?? null); // roofs: #257
		tokenLayer.bases.setTop(look?.miniBase ?? null); // the bases' discs (#265)
		refreshLighting();
		shadowsDirty = warmPending = true;
		requestRender();
	}

	/** Raised ground, and everything standing on the ground, for a table's ground. */
	function placeOnGround(g: SquareGrid, on: Ground): void {
		tokenLayer.sync(tokens, g, on);
		wallLayer.sync(objects, worldLayer.shape!, on);
		propLayer.sync(water.dry(props), g, on, worldLayer.shape?.known);
	}

	/** The world's shape from what the viewer was sent (#240), its ground; true if `known` changed. */
	function reshape(): boolean {
		const { fog, mode } = fogState;
		const wet = water.cells(grid!, floor, props); // a bed under water (#293); walls: #255
		const explored = worldLayer.update(grid!, levels, floor, fog, mode, objects, wet);
		ground = worldLayer.ground;
		return explored;
	}

	function buildTable(g: SquareGrid): void {
		const extents = fitToTable(lights, atmosphere, camera, controls, g, levels, true);
		land.build(extents);
		applyLook();
		frame = extents.play.frame;
		rig.frame(extents.play); // on the party at the next frame (#280)
		effects.setBounds(extents.play.width, extents.play.depth);
	}

	const quality = new QualityControl(
		{ renderer, canvas, camera, sun: lights.sun, perf, loop, steady: () => steady },
		options
	);
	/** A tier's settings on every layer that takes them; true if materials or lights were remade. */
	function applyTier(settings: QualitySettings): boolean {
		post.set(settings); // drawn through from the first frame, so nothing compiles twice
		atmosphere.setTier(settings.tier, settings.layers.sky);
		for (const l of [land, worldLayer, diceLayer]) l.setTier(settings.tier); // #254, dice: #275
		for (const l of [tokenLayer, grass, vfx]) l.setTier(settings); // contact, x-ray, grass, caps
		cloud.setLayer(settings.layers.fogcloud, settings.tier === 'low');
		const anti = [land, worldLayer, wallLayer].map((l) => l.setAntiTiled(settings.antiTile));
		anti.push(water.setTier(settings)); // the swell (#296), ripples (#293), refraction (#298)
		return lighting.setTier(settings) || anti.includes(true); // K: #228
	}
	applyTier(quality.current);
	controls.addEventListener('change', requestRender);

	const pickable = { tokens: tokenLayer, walls: wallLayer, lighting, props: propLayer };
	const picker = new Picker(canvas, camera, pickable, () => ({ grid, ground }));
	const stopPicking = listenForPicks(canvas, picker, events, perf, () => rig.endShot(), controls);
	const measured = { loop, quality, lighting, world: worldLayer, vfx, warming: () => warming };
	const tabletop: Tabletop = {
		setGrid(next) {
			if (grid && sameGrid(grid, next)) return (propLayer.drops.hold(), rig.reframe()); // a load: #249
			grid = { ...next };
			freshTable = true;
			levels = fits(levels);
			reshape();
			buildTable(grid);
			placeOnGround(grid, ground!);
			tokenLayer.setFallen(fallen);
			refreshLighting();
		},
		setTokens(next) {
			tokens = next;
			wallLayer.roofs.setTokens(next); // own and selected ones open their roofs (#259)
			replan(); // their downloads, nearest the camera first (#192), before the layer asks
			if (!grid) return;
			// The first tokens after a new table take their places at once, gliding in from nowhere.
			tokenLayer.sync(tokens, grid, ground, freshTable);
			freshTable = false;
			tokenLayer.setFallen(fallen);
			refreshLighting();
		},
		setObjects(next) {
			if (((objects = next), !grid)) return;
			reshape(); // stairs stop at walls and rail no walled side (#255)
			wallLayer.sync(objects, worldLayer.shape!, ground!);
			refreshLighting();
		},
		setHoveredObject: (objectId) => wallLayer.setHovered(objectId) && requestRender(),
		setPreview: (items) => (previews.set(items, grid, ground), requestRender()),
		setFog(fog, mode) {
			fogState = { fog, mode };
			wallLayer.roofs.setSight(fog, mode); // roofs never hide what the rules show (#257, #259)
			if (!grid) return;
			if (reshape()) wallLayer.sync(objects, worldLayer.shape!, ground!);
			refreshLighting();
		},
		throwDice(t) {
			if (!grid || t.dice.length === 0) return 0;
			const aim = throwFromView(controls.target, camera.position, grid, ground, floor); // #247
			const ms = diceLayer.throw(t, aim, grid.cellSize, reducedMotion, clock());
			requestRender();
			return ms;
		},
		setProps(next) {
			props = next;
			replan();
			if (!grid) return;
			reshape(); // the liquid sheets' cells are water (#293)
			propLayer.sync(water.dry(props), grid, ground, worldLayer.shape?.known);
			refreshLighting();
		},
		setSelectedProp: (propId) => propLayer.setSelected(propId) && requestRender(),
		setHoveredProp: (propId) => propLayer.setHovered(propId) && requestRender(),
		setLighting(...state) {
			if (state[1] !== lightState[1]) shadowsDirty = true;
			lightState = state;
			refreshLighting();
		},
		setSelected: (id) =>
			(wallLayer.roofs.setSelected(id), tokenLayer.setSelected(id)) && requestRender(),
		setOwnTokens: (ids) => (rig.setOwn(ids), wallLayer.roofs.setOwn(ids)) && requestRender(),
		setHoveredToken: (id) => tokenLayer.bases.setHovered(id) && requestRender(),
		setRings: (rings) => tokenLayer.bases.setRings(rings) && requestRender(),
		setGridMode: (mode, focus, cells) =>
			(wallLayer.roofs.setBuilding(mode === 'build'),
			worldLayer.grid.setMode(mode, focus, cells)) && requestRender(),
		setFallen(tokenIds) {
			fallen = new Set(tokenIds);
			if (tokenLayer.setFallen(fallen)) requestRender();
		},
		setActive: (tokenId, enemy) => tokenLayer.setActive(tokenId, enemy) && requestRender(),
		showFloat: (id, text, color) => tokenLayer.float(id, text, color) && requestRender(),
		setLabels: (state) => tokenLayer.labels.set(state) && requestRender(), // names (#268)
		setHighlight: (cell, kind) => (worldLayer.grid.setHighlight(cell, kind), requestRender()),
		setDarkness(next) {
			wallLayer.setDarkness((darkness = next)); // windows into it stay dark (#260)
			refreshLighting();
		},
		setInterior: (next) =>
			// roofs and boundary walls (#251, #257), sky light (#219)
			(wallLayer.setInterior(next), cellMaps.setInterior(next)) && refreshLighting(),
		setEnvironment(next) {
			if (next === environment) return;
			environment = next;
			if (!next) return void ((look = null), applyLook());
			void loadEnvironment(next, post.toneMapper).then((loaded) => {
				// Only if it is still the one wanted (tables can change quickly).
				if (environment !== next) return;
				look = loaded;
				applyLook();
			});
		},
		setTerrain(next) {
			levels = next;
			if (!grid) return;
			levels = fits(levels);
			reshape();
			placeOnGround(grid, ground!);
			fitToTable(lights, atmosphere, camera, controls, grid, levels, false); // its top
			refreshLighting();
		},
		setFloor(next, paint) {
			floor = next;
			if (((lawn = paint), !grid)) return;
			floor = fits(floor);
			reshape();
			wallLayer.sync(objects, worldLayer.shape!, ground!); // the void's walls are outer (#251)
			refreshLighting();
		},
		playMotions: (motions) => (propLayer.playMotions(motions, clock()), requestRender()),
		playVfx: (events) => play(events, view(), clock(), reducedMotion), // #315
		playCue(cue, swingPropId) {
			swinging = swingPropId;
			effects.play(cue, clock(), reducedMotion);
			requestRender();
		},
		playShot(next) {
			if (reducedMotion || !grid) return;
			rig.playShot(next, grid, ground, frame, clock());
			requestRender();
		},
		setView: (next, subject) => rig.setMode(next, clock(), subject),
		...rig.api, // PageUp/PageDown, home, a cell, the stored pose (#279, #280)
		...cutApi(rig, () => ({ grid, ground, objects, tokens }), requestRender), // #281, #282
		...tokenLayer.api, // the path preview and the carried mini (#286, #287)
		setPose: (pose) => (rig.setPose(pose), requestRender()),
		cameraPose: () => (grid ? rig.pose() : null),
		setGridPose(pose) {
			if (grid) rig.setPose(...placePose(grid, ground, pose));
			requestRender();
		},
		dispose() {
			disposed = true;
			loop.dispose();
			motion.stop();
			quality.dispose();
			stopPicking();
			const layers = [rig, land, tokenLayer, wallLayer, lighting, post, cloud, atmosphere, grass];
			const more = [overlay, worldLayer, effects, propLayer, diceLayer, previews, water, decor];
			for (const l of [...layers, ...more, cellMaps, vfx]) l.dispose();
			releaseModels();
			// Not while a warm-up is still compiling for it; a lost context may throw.
			return warming.then(() => renderer.dispose()).catch(() => {});
		},
		setQuality(settings, refine) {
			quality.set(settings, refine);
			if (applyTier(settings)) warmPending = true;
			refreshLighting(); // shows or hides the cloud
		},
		capabilities: () => quality.caps,
		loads: loadProgress,
		setPowerSaver: (on) => (loop.setPowerSaver(on), cloud.setPowerSaver(on)),
		setReduceFlashing: (on) => (effects.setReduceFlashing(on), vfx.setReduceFlashing(on)),
		...perfMethods(renderer, perf, drawScene, measured)
	};
	// Changes to the table redraw the sun's shadows on the next frame; the hour turns the key light,
	// redrawn by its own rule (AtmosphereLayer.shadowFrame), and lights only when they change.
	instrument(tabletop, perf, (key) => key === 'setLighting' || (shadowsDirty = lods.due = true));
	const unbaked = [tokenLayer, diceLayer, effects, cloud, wallLayer.glass, vfx].map((l) => l.group);
	const probeHooks = { renderer, scene, loop, clock, perf, warm: onModel };
	new ProbeLayer({ ...probeHooks, spacing: options.probeSpacing }, unbaked).watch(tabletop);
	return tabletop;
}
