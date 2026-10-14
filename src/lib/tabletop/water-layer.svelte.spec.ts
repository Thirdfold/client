// The water layer's falls, lava and hosts (#295, #296, #297), without drawing: a stepped river
// hangs a fall a run of drop edges in one mesh a chunk, `falls()` lists them for #311's mist, lava
// cells are lava's own mesh and never fall, and the tier's twin reaches the sea ring and the
// molten chasm the layer was attached to.

import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { PerfRecorder } from './perf';
import { WaterLayer, ready } from './water-layer';
import { loadWorld, type WorldLayer } from './world-layer';
import type { WorldGround } from './landscape';

const WATER = FLOOR_IDS.indexOf('water');
const LAVA = FLOOR_IDS.indexOf('lava');
const grid: SquareGrid = { kind: 'square', width: 5, height: 8, cellSize: 1 };

/** A river down the middle three columns: level 3, then 2, then 0; lava on the bottom row. */
function river(): { levels: Uint8Array; floor: Uint8Array } {
	const floor = new Uint8Array(40);
	const levels = new Uint8Array(40).fill(3);
	for (let y = 0; y < 8; y++)
		for (let x = 1; x <= 3; x++) {
			const i = y * 5 + x;
			[floor[i], levels[i]] = [y === 7 ? LAVA : WATER, y < 3 ? 3 : y < 6 ? 2 : 0];
		}
	return { levels, floor };
}

async function made() {
	await ready;
	const build = await loadWorld();
	const layer = new WaterLayer(
		build,
		new PerfRecorder(),
		() => null,
		() => {}
	);
	const { levels, floor } = river();
	const water = layer.cells(grid, floor, []);
	const shape = build.worldShape({ grid, levels, floor, objects: [], known: null, water });
	layer.update(grid, shape, [], [], [], null, null);
	return { layer, water };
}

describe('the water layer', () => {
	it('hangs a fall a run of drop edges, in one mesh a chunk, listed for the mist', async () => {
		const { layer } = await made();
		const falls = layer.falls();
		expect(falls).toHaveLength(2); // 3 to 2, and 2 to 0 (lava beside the foot, at its level)
		for (const f of falls) expect(f.width).toBeCloseTo(3);
		const meshes = layer.group.children.filter(
			(o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible
		);
		const kinds = meshes.map((m) => (m.material as unknown as { options: object }).options);
		expect(kinds.filter((o) => 'fall' in o && o.fall)).toHaveLength(1); // one chunk, one draw
		expect(kinds.filter((o) => 'lava' in o && o.lava)).toHaveLength(1);
		for (const m of meshes) expect(m.castShadow).toBe(false);
		layer.dispose();
	});

	it('counts lava among the water cells: a bed and a surface', async () => {
		const { water } = await made();
		expect(Array.from(water.subarray(36, 39))).toEqual([1, 1, 1]);
	});

	it('swaps the sea ring`s and the molten chasm`s materials for the tier`s twins', async () => {
		const { layer } = await made();
		const land = { group: new THREE.Group(), sea: null } as unknown as WorldGround;
		const world = { group: new THREE.Group(), molten: null } as unknown as WorldLayer;
		layer.attach(land, world);
		const span = { fogNear: 10, fogFar: 20 } as Parameters<NonNullable<WorldGround['sea']>>[0];
		const ring = new THREE.Mesh(new THREE.BufferGeometry(), land.sea!(span));
		const chasm = new THREE.Mesh(new THREE.BufferGeometry(), world.molten!());
		land.group.add(ring);
		world.group.add(chasm);
		expect(layer.setAntiTiled(false)).toBe(true);
		expect(ring.material).toBe(land.sea!(span));
		expect(chasm.material).toBe(world.molten!());
		expect((ring.material as unknown as { options: object }).options).toMatchObject({
			deep: true,
			antiTiled: false
		});
		expect(layer.setAntiTiled(false)).toBe(false);
		layer.dispose();
	});

	it('moves no clock under reduced motion', async () => {
		const { layer } = await made();
		const camera = new THREE.PerspectiveCamera();
		camera.position.set(0, 10, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		expect(layer.tick(1000, true, camera, false)).toBe(false);
		expect(layer.tick(1000, false, camera, false)).toBe(true);
		layer.dispose();
	});
});
