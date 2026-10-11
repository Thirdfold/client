// The cut plane and the walls' cutaway at the table (#281, #282): the tabletop's `setCut`,
// `cutLevel` and `setWalls`. The cut's height is a uniform (`cellUniforms.cutY`) worked out as
// each frame is drawn: a locked level as it is, or the auto cut (cut.ts `autoCut`) from the
// camera's pivot, the walls and the kept tokens in view. The cutaway's focus is the pivot itself.
// Neither touches the sun's shadow (not instrumented, perf.ts), and neither compiles anything.

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { roomBoundary } from '$lib/game/rooms';
import type { Token } from '$lib/game/token';
import { cellAt } from './camera-rig';
import { cellUniforms, NO_CUT } from './cell-maps';
import { autoCut, cutHeight, levelAt } from './cut';
import { CUTAWAY_MODE } from './cutaway';
import type { Ground } from './ground';
import { cutawayUniforms } from './materials/cutaway-node';
import type { Tabletop } from './types';

/** The cut's level as last drawn (null: none), for picking (world/pick.ts). */
export const cutNow: { level: number | null } = { level: null };

interface CutTable {
	grid: SquareGrid | null;
	ground: Ground | null;
	objects: readonly SceneObject[];
	tokens: readonly Token[];
}

export function cutApi(
	rig: { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3 } },
	table: () => CutTable,
	request: () => void
): Pick<Tabletop, 'setCut' | 'cutLevel' | 'setWalls'> {
	let wanted: number | null | 'auto' = 'auto';
	let keep: ReadonlySet<string> = new Set();
	let walls: [readonly SceneObject[], Set<string>] | null = null;
	let last: { key: string; walls: object; grid: SquareGrid; level: number | null } | null = null;
	const frustum = new THREE.Frustum();
	const view = new THREE.Matrix4();
	const at = new THREE.Vector3();
	const { camera, controls } = rig;
	cutawayUniforms.focus.value = controls.target; // read as each frame is drawn

	/** The cut's level now: the locked one, or auto's from the pivot. */
	function levelNow(): number | null {
		const { grid, ground, objects, tokens } = table();
		if (wanted !== 'auto' || !grid || !ground) return wanted === 'auto' ? null : wanted;
		if (walls?.[0] !== objects) walls = [objects, roomBoundary(objects)];
		const cs = grid.cellSize;
		view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(view);
		const kept: number[] = [];
		for (const t of tokens) {
			if (!keep.has(t.id)) continue;
			const floor = ground.floorY(t.pos);
			const w = gridToWorld(grid, t.pos);
			if (frustum.containsPoint(at.set(w.x, floor, w.z))) kept.push(levelAt(floor, cs));
		}
		const { x, y, z } = controls.target;
		const pivot = cellAt(grid, x, z);
		const pivotLevel = levelAt(y, cs);
		// Drawn several passes a frame: the room's flood fill only when something it reads changed.
		const key = `${pivot.x},${pivot.y},${pivotLevel},${kept.join()}`;
		if (last?.key !== key || last.walls !== walls || last.grid !== grid) {
			const level = autoCut({ grid, boundary: walls[1], pivot, pivotLevel, keep: kept });
			last = { key, walls, grid, level };
		}
		return last.level;
	}

	(cellUniforms.cutY as unknown as THREE.UniformNode<'float', number>).onRenderUpdate(() => {
		const grid = table().grid;
		cutNow.level = grid ? levelNow() : null;
		return cutNow.level === null || !grid ? NO_CUT : cutHeight(cutNow.level, grid.cellSize);
	});

	return {
		setCut(level, ids = []) {
			wanted = level;
			keep = new Set(ids);
			request();
		},
		cutLevel: () => (table().grid ? levelNow() : null),
		setWalls(setting) {
			cutawayUniforms.mode.value = CUTAWAY_MODE[setting];
			request();
		}
	};
}
