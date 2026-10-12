// Water's refraction on high (#298, materials/water-high.ts): the frame's colour and depth are
// copied (the backend's `copyFramebufferToTexture`) once each in every frame that draws water,
// never in a frame without water in view, and never on low or medium, nor with `?off=refraction`.
// After the warm-up on high, water painted, sunk, looked at and gone again compiles nothing.
// The test world as the GM sees it, by day, reduced motion (no ambient frames: a frame is drawn
// only for a change), on both backends.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import { decodeLevels } from '$lib/game/terrain';
import { shaderCounts } from './perf';
import { settingsFor, type Tier } from './quality';
import { BACKEND, loadView, mountFixture, settle, type FixtureView, type Mounted } from './testing';

vi.setConfig({ testTimeout: 300_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

const WATER = FLOOR_IDS.indexOf('water');
const backend = BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';

/** The test world's floor with a 5x3 pond at its centre, and where the pond is. */
function pond(view: FixtureView) {
	const { width: w, height: h } = view.grid;
	const floor = (view.floor ? decodeFloor(view.floor, w * h) : null) ?? new Uint8Array(w * h);
	const centre = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
	const wet = floor.map((f, i) =>
		Math.abs((i % w) - centre.x) <= 2 && Math.abs(Math.floor(i / w) - centre.y) <= 1 ? WATER : f
	);
	return { dry: floor, wet, centre };
}

/** Mounts the test world on `tier`, with the renderer the warm-up compiled with and a copy spy. */
async function mount(tier: Tier) {
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const view = await loadView('test-world', 'day', 'gm');
	const { dry, wet, centre } = pond(view);
	const pose = { target: centre, distance: 10, azimuth: 30, elevation: 55 };
	mounted = await mountFixture(view, pose, { tier, reducedMotion: true, heroes: false });
	const t = mounted.tabletop;
	await settle(t);
	const renderer = compile.mock.contexts[0] as THREE.WebGPURenderer;
	const backendOf = renderer.backend as unknown as { copyFramebufferToTexture(): void };
	const copy = vi.spyOn(backendOf, 'copyFramebufferToTexture');
	/** Does `change`, lets the table come to rest, and returns the frames drawn and copies made. */
	const after = async (change: () => void) => {
		const [frames, copies] = [t.stats().frames, copy.mock.calls.length];
		change();
		await settle(t);
		return { frames: t.stats().frames - frames, copies: copy.mock.calls.length - copies };
	};
	return { t, view, renderer, dry, wet, centre, after };
}

describe('refraction on high (#298)', () => {
	it('copies colour and depth once in each frame that draws water, none without', async () => {
		const { t, dry, wet, centre, after } = await mount('high');
		const painted = await after(() => t.setFloor(wet));
		expect(painted.frames).toBeGreaterThan(0);
		expect(painted.copies).toBe(2 * painted.frames);
		// Turned from the pond where it is out of view: only frames that draw water copy.
		const corner = { x: 1, y: 1 };
		let culled = 0;
		for (const azimuth of [0, 90, 180, 270]) {
			const away = { target: corner, distance: 3, azimuth, elevation: 15 };
			const { frames, copies } = await after(() => t.setGridPose(away));
			expect(frames).toBeGreaterThan(0);
			expect([0, 2 * frames]).toContain(copies);
			if (copies === 0) culled++;
		}
		expect(culled, 'some pose has the pond out of view').toBeGreaterThan(0);
		const back = await after(() =>
			t.setGridPose({ target: centre, distance: 10, azimuth: 30, elevation: 55 })
		);
		expect(back.copies).toBe(2 * back.frames);
		const gone = await after(() => t.setFloor(dry));
		const still = await after(() =>
			t.setGridPose({ target: centre, distance: 9, azimuth: 40, elevation: 50 })
		);
		expect(gone.frames + still.frames).toBeGreaterThan(0);
		expect(still.copies).toBe(0);
	});

	it.each(['low', 'medium'] as const)('never copies on %s', async (tier) => {
		const { t, wet, after } = await mount(tier);
		const painted = await after(() => t.setFloor(wet));
		expect(painted.frames).toBeGreaterThan(0);
		expect(painted.copies).toBe(0);
	});

	it('never copies with ?off=refraction', async () => {
		const { t, wet, after } = await mount('high');
		const s = settingsFor('high', backend);
		t.setQuality({ ...s, layers: { ...s.layers, refraction: false } });
		await settle(t);
		const painted = await after(() => t.setFloor(wet));
		expect(painted.frames).toBeGreaterThan(0);
		expect(painted.copies).toBe(0);
	});

	it('compiles nothing after the warm-up for water coming and going', async () => {
		const { t, view, renderer, dry, wet, centre, after } = await mount('high');
		const size = view.grid.width * view.grid.height;
		const levels = view.terrain ? decodeLevels(view.terrain, size) : null;
		const was = shaderCounts(renderer);
		await after(() => t.setFloor(wet));
		await after(() => t.setTerrain(wet.map((f) => (f === WATER ? 0 : 2)))); // sunk: deep
		await after(() => t.setGridPose({ target: centre, distance: 6, azimuth: 120, elevation: 35 }));
		await after(() => t.setLighting('dark', view.lights)); // no caustics
		await after(() => (t.setTerrain(levels), t.setFloor(dry), t.setLighting('day', view.lights)));
		const now = shaderCounts(renderer);
		expect({ programs: now.programs, pipelines: now.pipelines }).toEqual({
			programs: was.programs,
			pipelines: was.pipelines
		});
	});
});
