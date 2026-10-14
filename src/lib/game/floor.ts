// Floors: what each cell of a table is made of, painted by the GM (stone,
// wood, grass, water...), or `void`, off the map: nobody can stand there.
// Like the level map (terrain.ts) it is one byte per cell, and a table with
// nothing painted has no floor map at all (null): every cell is the table's
// own surface (its environment, or the plain ground). The grass map (below) is kept beside it.

import type { GridPos, SquareGrid } from './grid';
import { rectCells, type CellMask } from './visibility';

/**
 * The floors, by the byte stored for each cell. `plain` (0) is the table's own surface, shown as
 * "Default ground". Append-only (#248, and tile and grating from #254): a save stores the index, so a floor is only ever added at
 * the end, and every floor after `void` is rule-neutral (moved over and seen through like stone),
 * except `lava` (#297): solid like `void`, and a short-range light (`lavaSources`).
 */
export const FLOORS = [
	{ id: 'plain', name: 'Default ground' },
	{ id: 'stone', name: 'Stone' },
	{ id: 'wood', name: 'Wood' },
	{ id: 'grass', name: 'Grass' },
	{ id: 'dirt', name: 'Dirt' },
	{ id: 'sand', name: 'Sand' },
	{ id: 'water', name: 'Water' },
	{ id: 'void', name: 'Off the map' },
	{ id: 'cobble', name: 'Cobble' },
	{ id: 'flagstone', name: 'Flagstone' },
	{ id: 'rock', name: 'Rock' },
	{ id: 'mud', name: 'Mud' },
	{ id: 'snow', name: 'Snow' },
	{ id: 'gravel', name: 'Gravel' },
	{ id: 'tile', name: 'Tile' },
	{ id: 'grating', name: 'Grating' },
	{ id: 'lava', name: 'Lava' }
] as const;

export type FloorId = (typeof FLOORS)[number]['id'];
export const FLOOR_IDS: readonly FloorId[] = FLOORS.map((f) => f.id);

/** The byte for cells off the map: they block movement like a solid prop. */
export const VOID = FLOOR_IDS.indexOf('void');
/** The byte for molten ground: solid, and lit (see `lavaSources` in lights.ts). */
export const LAVA = FLOOR_IDS.indexOf('lava');
/** The floors nobody can stand on (`obstaclesFor` makes them solid, never opaque). */
export const SOLID_FLOORS: ReadonlySet<number> = new Set([VOID, LAVA]);

/** One byte per cell, row-major, like a CellMask; values index FLOORS. */
export type FloorMap = Uint8Array;

export function isFloorId(value: unknown): value is FloorId {
	return typeof value === 'string' && (FLOOR_IDS as readonly string[]).includes(value);
}

/** Paints every cell of a rectangle. Returns the new map (null again once all plain). */
export function withFloor(
	floor: FloorMap | null,
	grid: SquareGrid,
	from: GridPos,
	to: GridPos,
	id: FloorId
): FloorMap | null {
	const next = floor ? floor.slice() : new Uint8Array(grid.width * grid.height);
	const value = FLOOR_IDS.indexOf(id);
	for (const i of rectCells(grid, from, to)) next[i] = value;
	return next.some((v) => v !== 0) ? next : null;
}

/** Packs a floor map as base64, one byte per cell. */
export function encodeFloor(floor: FloorMap): string {
	let binary = '';
	for (const v of floor) binary += String.fromCharCode(v);
	return btoa(binary);
}

/** Inverse of encodeFloor; null if the data is malformed, the wrong size or names no floor. */
export function decodeFloor(encoded: string, size: number): FloorMap | null {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return null;
	}
	if (binary.length !== size) return null;
	const floor = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		const v = binary.charCodeAt(i);
		if (v >= FLOORS.length) return null;
		floor[i] = v;
	}
	return floor;
}

/** What a viewer may know of the floors: only where `known` (the rest reads as plain). */
export function knownFloor(floor: FloorMap, known: CellMask | null): FloorMap {
	if (!known) return floor;
	const out = new Uint8Array(floor.length);
	for (let i = 0; i < floor.length; i++) if (known[i]) out[i] = floor[i];
	return out;
}

// The grass on the floors (M74, the owner's revision): how dense and how tall it grows on each
// cell, painted by the GM like floors and saved with the table (`grass` in the scene file, v11).
// One byte per cell: the low nibble the density's code, the high nibble the height's, both 0 for
// Normal, so a table with nothing painted has no grass map at all (null). It changes how grass
// grows where grass grows (a grass floor, or the plain ground of a grassy environment) and plants
// none elsewhere. Presentation only: no rule (movement, sight, light) reads it.

/** By code (the byte's low nibble): Normal first, so 0 is the default. `scale` times blades. */
export const GRASS_DENSITIES = [
	{ id: 'normal', name: 'Normal', scale: 1 },
	{ id: 'none', name: 'None', scale: 0 },
	{ id: 'sparse', name: 'Sparse', scale: 0.5 },
	{ id: 'dense', name: 'Dense', scale: 1.75 },
	{ id: 'lush', name: 'Lush', scale: 2.5 }
] as const;

/** By code (the byte's high nibble): Normal first. `scale` times a blade's height. */
export const GRASS_HEIGHTS = [
	{ id: 'normal', name: 'Normal', scale: 1 },
	{ id: 'short', name: 'Short', scale: 0.6 },
	{ id: 'tall', name: 'Tall', scale: 1.6 },
	{ id: 'very-tall', name: 'Very tall', scale: 2.4 }
] as const;

export type GrassDensity = (typeof GRASS_DENSITIES)[number]['id'];
export type GrassHeight = (typeof GRASS_HEIGHTS)[number]['id'];

/** One byte per cell, row-major, like a FloorMap. */
export type GrassMap = Uint8Array;

const densityCode = (id: unknown) => GRASS_DENSITIES.findIndex((d) => d.id === id);
const heightCode = (id: unknown) => GRASS_HEIGHTS.findIndex((h) => h.id === id);

export const isGrassDensity = (v: unknown): v is GrassDensity => densityCode(v) >= 0;
export const isGrassHeight = (v: unknown): v is GrassHeight => heightCode(v) >= 0;

/** A cell's byte read back as multipliers: blades (0 grows none) and height. */
export function grassScales(byte: number): { density: number; height: number } {
	return {
		density: GRASS_DENSITIES[byte & 15]?.scale ?? 1,
		height: GRASS_HEIGHTS[byte >> 4]?.scale ?? 1
	};
}

/** Paints every cell of a rectangle. Returns the new map (null again once all Normal). */
export function withGrass(
	grass: GrassMap | null,
	grid: SquareGrid,
	from: GridPos,
	to: GridPos,
	density: GrassDensity,
	height: GrassHeight
): GrassMap | null {
	const next = grass ? grass.slice() : new Uint8Array(grid.width * grid.height);
	const value = densityCode(density) | (heightCode(height) << 4);
	for (const i of rectCells(grid, from, to)) next[i] = value;
	return next.some((v) => v !== 0) ? next : null;
}

/** Packs a grass map as base64, one byte per cell (as floors are). */
export const encodeGrass: (grass: GrassMap) => string = encodeFloor;

/** Inverse of encodeGrass; null if malformed, the wrong size or a code names no level. */
export function decodeGrass(encoded: string, size: number): GrassMap | null {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return null;
	}
	if (binary.length !== size) return null;
	const grass = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		const v = binary.charCodeAt(i);
		if ((v & 15) >= GRASS_DENSITIES.length || v >> 4 >= GRASS_HEIGHTS.length) return null;
		grass[i] = v;
	}
	return grass;
}

/** What a viewer may know of the grass: only where `known` (the rest reads as Normal). */
export const knownGrass: (grass: GrassMap, known: CellMask | null) => GrassMap = knownFloor;
