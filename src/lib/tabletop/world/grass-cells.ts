// The cells that grow grass (milestone 74, #302): worked out on the CPU from what the viewer was
// sent, handed to the GPU layer as a compact list. Pure and renderer-free (no three.js), so its
// specs run in the server project.
//
// It reads only the world shape (the viewer's floors, levels, water, walls and explored mask), the
// roof mask and the props the viewer was sent, so a GM-hidden prop leaves no gap in a player's
// grass and nothing about unexplored ground is an input: an unexplored cell grows none, and none of
// its sides is inset.

import { FLOOR_IDS, SOLID_FLOORS } from '../../game/floor';
import { ASSETS, footprintCells, type Prop } from '../../game/props';
import type { CellMask } from '../../game/visibility';
// Types only from shape.ts: its code is the world chunk's, and the grass chunk keeps clear of it.
import type { WorldShape } from './shape';

const GRASS = FLOOR_IDS.indexOf('grass');
const PLAIN = FLOOR_IDS.indexOf('plain');

/**
 * `insets` bits, one per side in the order north, east, south, west (the order of `DX`/`DY` in
 * shape.ts). The low nibble keeps blades half a wall's thickness off a wall, window or door; the
 * high nibble keeps them `MAX_ROUND` (0.25 cell) off a drop, the void, lava or water.
 */
export const INSET = { wall: 1, wide: 16 } as const;
/** North, east, south, west: the neighbour offsets, matching the inset bit order. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** A nature prop's footprint grows grass at this density (of 255). */
export const NATURE_DENSITY = 128;

export interface GrassInput {
	/** The viewer's shape (`worldShape`), with `water` from `waterCells` when liquid props count. */
	shape: WorldShape;
	/** The roofed cells as sent (`room.interior`, masked to the viewer): plain ground inside is not lawn. */
	interior: CellMask | null;
	/** The props the viewer was sent. */
	props: readonly Pick<Prop, 'assetId' | 'pos' | 'rotation'>[];
	/** The environment's default ground is grass: plain cells outside roofs grow it. */
	defaultIsGrass: boolean;
	/** The manifest's `liquid` flag (shore.ts `isLiquid`): such a prop's footprint is water, not lawn. */
	isLiquid?: (assetId: string) => boolean;
}

export interface GrassCells {
	count: number;
	/** Row-major cell indices (`y * width + x`); a table has at most 100 x 100 cells, so 16 bits do. */
	cells: Uint16Array;
	/** Per cell, `INSET` bits per side. */
	insets: Uint8Array;
	/** Per cell, 255 full, `NATURE_DENSITY` under a nature prop. */
	density: Uint8Array;
}

/** The grass cells of a viewer's table, in row-major order: deterministic. */
export function grassCells(input: GrassInput): GrassCells {
	const { shape, interior, props, defaultIsGrass, isLiquid } = input;
	const { grid, known, floor, levels, water } = shape;
	const { width: w, height: h } = grid;
	const size = w * h;

	// Props: 255 clear, 0 covered, NATURE_DENSITY under a tree or a rock.
	const under = new Uint8Array(size).fill(255);
	for (const p of props) {
		const nature = ASSETS[p.assetId].category === 'nature';
		const wet = isLiquid?.(p.assetId) === true;
		for (const c of footprintCells(p)) {
			if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
			const i = c.y * w + c.x;
			under[i] = wet || !nature ? 0 : Math.min(under[i], NATURE_DENSITY);
		}
	}

	const seen = (i: number) => !known || known[i] === 1;
	const grows = (i: number) => {
		if (!seen(i) || !under[i] || water[i] || SOLID_FLOORS.has(floor[i])) return false;
		return floor[i] === GRASS || (floor[i] === PLAIN && defaultIsGrass && !interior?.[i]);
	};

	const cells: number[] = [];
	const insets: number[] = [];
	const density: number[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (!grows(i)) continue;
			let bits = 0;
			for (let d = 0; d < 4; d++) {
				const nx = x + DX[d];
				const ny = y + DY[d];
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
				const j = ny * w + nx;
				if (!seen(j)) continue; // nothing toward unexplored ground
				// Anything built on the side (`EDGE_BUILT`: a wall, window or door; 0 is none).
				if (builtOn(shape, x, y, d)) bits |= INSET.wall << d;
				if (SOLID_FLOORS.has(floor[j]) || water[j] || levels[j] < levels[i])
					bits |= INSET.wide << d;
			}
			cells.push(i);
			insets.push(bits);
			density.push(under[i]);
		}
	return {
		count: cells.length,
		cells: Uint16Array.from(cells),
		insets: Uint8Array.from(insets),
		density: Uint8Array.from(density)
	};
}

/**
 * What stands on side `d` (north, east, south, west) of cell (x, y): its `EDGE_BUILT`, read at
 * shape.ts's `hEdge` (`y * width + x`) and `vEdge` (`y * (width + 1) + x`).
 */
function builtOn(shape: WorldShape, x: number, y: number, d: number): number {
	const { grid, edges } = shape;
	const w = grid.width;
	if (d % 2 === 0) return edges.built.h[(y + d / 2) * w + x];
	return edges.built.v[y * (w + 1) + x + (d === 1 ? 1 : 0)];
}

/**
 * A 32-bit FNV-1a hash of a result and the grid's width: equal when the cell list, its insets and
 * densities are equal, so the layer rebuilds its texture only when this changes (the inputs
 * themselves are many and large; the output is a few kilobytes).
 */
export function grassSignature(grass: GrassCells, width: number): number {
	let hash = 0x811c9dc5 ^ width;
	const mix = (v: number) => (hash = Math.imul(hash ^ v, 0x01000193));
	for (let k = 0; k < grass.count; k++) {
		const c = grass.cells[k];
		mix(c & 255);
		mix(c >> 8);
		mix(grass.insets[k]);
		mix(grass.density[k]);
	}
	return mix(grass.count) >>> 0;
}
