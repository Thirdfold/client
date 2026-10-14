import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { settingsFor } from './quality';
import { RECIPES } from './vfx-recipes';
import { LOOP_SHARE, STILL_MS, STRIDE } from './vfx-state';

vi.mock('$lib/assets/load', () => ({
	loadManifest: async () => ({ textures: { 'vfx-sprites': {} } })
}));
vi.mock('./environment', () => ({ loadTexture: async () => new THREE.Texture() }));

const { VfxLayer } = await import('./vfx');
const { vfxNow, vfxUniforms } = await import('./materials/vfx');

/** A layer on the high tier, its atlas loaded, and how many frames it asked for. */
async function layer() {
	const asked = { frames: 0 };
	const l = new VfxLayer(() => asked.frames++);
	l.setTier(settingsFor('high', 'webgpu'));
	await vi.waitFor(() => expect(asked.frames).toBe(1)); // the atlas arrived
	return { l, asked };
}

const meshes = (l: InstanceType<typeof VfxLayer>) =>
	l.group.children as THREE.Mesh<THREE.InstancedBufferGeometry>[];

describe('VfxLayer', () => {
	it('uploads only the slots a burst wrote, once, and asks for one frame', async () => {
		const { l, asked } = await layer();
		l.burst('sparks', { x: 0, y: 1, z: 0 }, 5, 1000);
		expect(asked.frames).toBe(2);
		const [additive] = meshes(l);
		const a = additive.geometry.getAttribute('aVfxA') as THREE.InstancedBufferAttribute;
		const ring = 8000 * LOOP_SHARE;
		expect(a.updateRanges).toEqual([
			{ start: ring * STRIDE, count: RECIPES.sparks.count * STRIDE }
		]);
		expect(additive.geometry.instanceCount).toBe(ring + RECIPES.sparks.count);
	});

	it('draws a pool only while it has something alive, ACTIVE until the last burst ends', async () => {
		const { l, asked } = await layer();
		const [additive, soft] = meshes(l);
		l.burst('heal', { x: 0, y: 0, z: 0 }, 1, 0);
		expect(l.tick(10)).toMatchObject({ bursting: true });
		expect([additive.visible, soft.visible]).toEqual([true, false]);
		expect(vfxNow.value).toBeCloseTo(0.01);
		const end = RECIPES.heal.lifetime * 1000;
		expect(l.tick(end)).toEqual({ bursting: false, looping: false, bounds: null });
		expect(additive.visible).toBe(false);
		expect(asked.frames).toBe(2); // ticks never ask for frames
	});

	it('asks for AMBIENT frames only while a loop is in the camera`s view', async () => {
		const { l } = await layer();
		l.loop('fire', 'embers', { x: 0, y: 0, z: 0 }, 1);
		const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
		camera.position.set(0, 5, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		expect(l.tick(0).looping).toBe(true);
		expect(l.inView(camera)).toBe(true);
		camera.lookAt(0, 0, 100);
		camera.updateMatrixWorld();
		expect(l.inView(camera)).toBe(false);
		l.unloop('fire');
		expect(l.tick(0).looping).toBe(false);
	});

	it('spawns nothing with its layer off (`?off=vfx`)', async () => {
		const { l, asked } = await layer();
		const off = settingsFor('high', 'webgpu');
		l.setTier({ ...off, layers: { ...off.layers, vfx: false } });
		l.burst('sparks', { x: 0, y: 0, z: 0 }, 1, 0);
		expect(asked.frames).toBe(1);
		expect(l.tick(0).bursting).toBe(false);
	});

	it('holds still under reduced motion: the graph`s uniform, and a burst of STILL_MS', async () => {
		const { l } = await layer();
		l.burst('ring', { x: 0, y: 0, z: 0 }, 1, 0); // before: its full life
		l.tick(0, true);
		expect(vfxUniforms.still.value).toBe(1);
		l.burst('ring', { x: 0, y: 0, z: 0 }, 1, 1000);
		expect(l.tick(1000 + STILL_MS - 1, true).bursting).toBe(true);
		expect(l.tick(1000 + STILL_MS, true).bursting).toBe(false);
		l.tick(2000, false);
		expect(vfxUniforms.still.value).toBe(0);
		l.setReduceFlashing(true);
		expect(vfxUniforms.flashCap.value).toBe(1);
	});
});
