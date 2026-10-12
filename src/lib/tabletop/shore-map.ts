// The shore map (#292): the shore field (world/shore.ts) as a texture. R8, linear, clamped, rows in
// grid order like the cell maps (no flip: `TextureNode.setupUV` flips only render targets and
// flipped bitmaps on WebGL2). Like them it is made once at the largest grid's size and kept
// (#380): a table's field, `SHORE_TEXELS` texels a cell, is copied into its corner, so a reader
// keeps its graph and holds its sample inside the grid (as `visibilitySmooth` does). The field is
// built in the world chunk (`build`, build.ts). The water layer (#293, water-layer.ts, a lazy
// chunk with this file) owns it and its water graphs sample it (materials/water.ts); it is rebuilt
// only when its inputs change, which the layer offers it at every relight.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { WorldLook } from '$lib/game/world';
import type { Prop } from '$lib/game/props';
import { MAP_SIDE } from './cell-maps-kept';
import type { PerfRecorder } from './perf';
import type { WorldShape } from './world/shape';
import { SHORE_TEXELS } from './world/shore-scale';
import type { WorldBuilders } from './world-layer';

/** The kept texture's side, in texels. */
export const SHORE_SIDE = MAP_SIDE * SHORE_TEXELS;

export class ShoreMap {
	/** Linear, so a fragment reads a smooth distance; the blank (0) is a shore until a table. */
	readonly texture = new THREE.DataTexture(
		new Uint8Array(SHORE_SIDE * SHORE_SIDE),
		SHORE_SIDE,
		SHORE_SIDE,
		THREE.RedFormat,
		THREE.UnsignedByteType,
		undefined,
		undefined,
		undefined,
		THREE.LinearFilter,
		THREE.LinearFilter
	);
	/** The inputs of the last rebuild, compared by identity. */
	last: unknown[] = [];
	readonly side = SHORE_SIDE;

	/** Rebuilds the field if its inputs changed (the shape's maps, the props, the backdrop). */
	update(
		grid: SquareGrid,
		shape: WorldShape,
		props: readonly Prop[],
		world: Pick<WorldLook, 'backdrop'> | null,
		perf: PerfRecorder,
		build: WorldBuilders,
		isLiquid: (assetId: string) => boolean
	): void {
		build.refreshShore(this, grid, shape, props, world?.backdrop.kind, perf, isLiquid);
	}
}
