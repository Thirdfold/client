// Light fixtures (#232): each light drawn with its kind's model (a wall sconce on a wall, a
// standing torch on the floor), the glow of a kind that does not burn tinted by the light and dark
// when it is off, picked by instance; a burning light's flame left to the fire layer (#312); and a
// light whose fixture is a prop on its cell (a brazier) seated on the prop's own flame, its
// GridLights entry there too.

import * as THREE from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { lightLook, type Light } from '$lib/game/lights';
import { edgeKey } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { flameSeats, FLAME_GLOW } from './light-fixtures';
import { FIXTURES, flickerPhase, flickerProfile } from './light-model';
import { LightingLayer } from './lighting';
import { PAINT_ATTRIBUTE, TINT_ATTRIBUTE } from './materials';
import { PropLayer } from './props';
import { initModels, loadModel, partsOf, releaseModels } from './models';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 6, height: 6 };
const light = (id: string, x: number, y: number, over: Partial<Light> = {}): Light => ({
	id,
	pos: { x, y },
	radius: 3,
	color: '#ffa04d',
	on: true,
	...over
});
/** A wall along the north edge of (1, 1). */
const walled = new Set([edgeKey({ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } })]);
const props: Prop[] = [{ id: 'b', assetId: 'brazier', pos: { x: 4, y: 4 }, rotation: 0, scale: 1 }];

let renderer: THREE.WebGPURenderer;
beforeAll(async () => {
	// The cooked fixtures (brazier, lantern) need the meshopt and KTX2 decoders.
	renderer = new THREE.WebGPURenderer({
		canvas: document.createElement('canvas'),
		forceWebGL: true
	});
	await renderer.init();
	initModels(renderer);
	const ids = new Set(Object.values(FIXTURES).flatMap((f) => [f.wall, f.floor]));
	await Promise.all(
		[...ids].flatMap((id) => (id ? [loadModel(id)] : [])).concat(loadModel('brazier'))
	);
});

afterAll(() => {
	releaseModels();
	renderer.dispose();
});

/** The meshes drawn (visible, with instances) under the layer. */
function drawn(layer: LightingLayer): THREE.InstancedMesh[] {
	const out: THREE.InstancedMesh[] = [];
	layer.fixtures.group.traverse((o) => {
		if (o instanceof THREE.InstancedMesh && o.visible && o.count > 0) out.push(o);
	});
	return out;
}

/** Instance tints (rgb times strength) of every flame mesh drawn. */
const flameTints = (layer: LightingLayer) =>
	drawn(layer)
		.filter((m) => (m.material as { kind?: string }).kind === 'emissive')
		.map((m) => m.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute);

const down = (x: number, y: number) => {
	const w = gridToWorld(grid, { x, y });
	return new THREE.Raycaster(new THREE.Vector3(w.x, 10, w.z), new THREE.Vector3(0, -1, 0));
};

describe('light fixtures', () => {
	it('draw each kind with its model, a wall fixture on the wall, at most two meshes a model', () => {
		const layer = new LightingLayer();
		const lights = [light('on-wall', 1, 1), light('standing', 3, 1), light('lamp', 3, 3)];
		lights[2] = { ...lights[2], kind: 'lantern' };
		layer.update(grid, 'dark', lights, [], walled);
		// wall-sconce, standing-torch, post-lantern: a body and a flame each.
		const meshes = drawn(layer);
		expect(meshes.length).toBeLessThanOrEqual(2 * 3);
		expect(meshes.length).toBeGreaterThanOrEqual(3);
		const kinds = new Set(meshes.map((m) => (m.material as { kind?: string }).kind));
		expect(kinds).toEqual(new Set(['prop', 'emissive']));
		// A burning light's flame is the fire layer's: its instance here is degenerate.
		const m = new THREE.Matrix4();
		for (const flame of meshes.filter(
			(x) => (x.material as { kind?: string }).kind === 'emissive'
		)) {
			for (let i = 0; i < flame.count; i++) {
				flame.getMatrixAt(i, m);
				expect(m.determinant()).toBe(0);
			}
		}
		layer.dispose();
	});

	it('glow with a light that does not burn, in its colour above 1, breathing with it', () => {
		const layer = new LightingLayer();
		const orb = light('orb', 3, 3, { kind: 'magic' });
		layer.update(grid, 'dark', [orb], [], new Set());
		const [tints] = flameTints(layer);
		expect(tints.getW(0)).toBe(FLAME_GLOW);
		// And breathes with its light: its kind's flicker and the light's phase (#231).
		const flame = drawn(layer).find((m) => (m.material as { kind?: string }).kind === 'emissive')!;
		const paint = flame.geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.BufferAttribute;
		expect(paint.getX(0)).toBe(flickerProfile(lightLook(orb).flicker));
		expect(paint.getY(0)).toBeCloseTo(flickerPhase('orb'), 6);
		layer.dispose();
	});

	it('are picked by instance, giving their light', () => {
		const layer = new LightingLayer();
		layer.update(grid, 'dark', [light('a', 2, 2), light('b', 4, 2)], [], new Set());
		layer.group.updateMatrixWorld(true);
		expect(layer.pick(down(2, 2))).toBe('a');
		expect(layer.pick(down(4, 2))).toBe('b');
		expect(layer.pick(down(0, 5))).toBeNull();
		layer.dispose();
	});

	it('show an unlit glow when the light is off, and none for a glow or fixture: false', () => {
		const layer = new LightingLayer();
		layer.update(grid, 'dark', [light('off', 2, 2, { kind: 'magic', on: false })], [], new Set());
		const [tints] = flameTints(layer);
		expect([tints.getX(0), tints.getW(0)]).toEqual([0, 0]);
		const none = [
			light('glow', 2, 2, { kind: 'glow' }),
			light('in-prop', 3, 3, { fixture: false })
		];
		layer.update(grid, 'dark', none, [], new Set());
		expect(drawn(layer)).toEqual([]);
		// The GM still picks them by their handles.
		layer.showHandles(grid, none, null, true);
		layer.group.updateMatrixWorld(true);
		expect(layer.pick(down(2, 2))).toBe('glow');
		layer.dispose();
	});

	it("seat a light whose fixture is a prop on the prop's flame, scaled with it", async () => {
		const model = await loadModel('brazier');
		expect(partsOf(model!, 'flame').length).toBeGreaterThan(0);
		const seat = flameSeats(grid, props).get(4 * grid.width + 4)!;
		expect(seat).toBeGreaterThan(0.5);
		const scaled = [{ ...props[0], scale: 1.5 }];
		expect(flameSeats(grid, scaled).get(4 * grid.width + 4)).toBeCloseTo(seat * 1.5);
		const layer = new LightingLayer();
		const seated = light('seated', 4, 4, { fixture: false, kind: 'brazier' });
		layer.update(grid, 'dark', [seated], [], new Set(), null, null, props);
		expect(drawn(layer)).toEqual([]); // the prop is its fixture
		const over = layer.grid!.entries.find((e) => e.id === 'seated')!;
		const w = gridToWorld(grid, { x: 4, y: 4 });
		expect([over.visual.x, over.visual.z]).toEqual([w.x, w.z]);
		expect(over.visual.y).toBeCloseTo(seat + 0.1);
		layer.dispose();
	});

	it("light a prop's flame by the light on its cell, dark when it is off", () => {
		const layer = new PropLayer();
		layer.sync(props, grid);
		const glow = () => {
			const flames: THREE.InstancedMesh[] = [];
			layer.group.traverse((o) => {
				if (!(o instanceof THREE.InstancedMesh)) return;
				if ((o.material as { kind?: string }).kind === 'emissive') flames.push(o);
			});
			expect(flames.length).toBeGreaterThan(0);
			return (flames[0].geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute).getW(0);
		};
		layer.setLights([light('fire', 4, 4)]);
		expect(glow()).toBe(FLAME_GLOW);
		layer.setLights([light('fire', 4, 4, { on: false })]);
		expect(glow()).toBe(0);
		layer.dispose();
	});
});
