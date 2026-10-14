// Decals (M74 #307): grime, moss, damp, soot, scorch, cracks, leaf litter and blood laid where an
// environment's rules say (src/lib/assets/decals.ts), worked out on the CPU from what the viewer
// was sent and handed to the GPU layer (decals.ts). Pure and renderer-free (no three.js), so its
// specs run in the server project. docs/RENDERING.md, "Decals", is the contract.
//
// What decides a placement, as for scatter (scatter.ts):
// - Only what the viewer was sent: the shape's continued maps and edges, the roof mask and the
//   props. An unexplored cell gets none, and no wall decal faces one, so nothing about unexplored
//   ground is an input (a GM-hidden brazier the viewer wasn't sent leaves no soot).
// - Nothing from an id: the seed is the environment, the rule and the cell and side, never a room,
//   an object or a prop id. A sealed secret door is a wall as sent and dresses like any wall.
// - Nothing on void or lava or in water, nor on a roofed cell for an `outdoor` rule; floor decals
//   lie on a prop's cells only when that prop is what the rule lies beside (scorch under a brazier).
// - A floor decal is a flat quad: it keeps inside its cell, and inside the flat middle of a cell
//   whose 3x3 neighbourhood isn't one known flat level (the ground rounds near a step or a drop).
// - A wall decal is a quad on the wall's face, `FACE` in from the edge (the kit's thin half), clear
//   of the corners' posts; on a window only at its foot, under the sill.

import { DECAL_KEYS, DECAL_VARIANTS, type DecalRule } from '../../assets/decals';
import { POST_SIZE, WALL_HALF_THIN } from '../../assets/kit';
import { FLOOR_IDS, SOLID_FLOORS } from '../../game/floor';
import { gridToWorld } from '../../game/grid';
import { ASSETS, footprintCells, type Prop } from '../../game/props';
import type { CellMask } from '../../game/visibility';
import { WALL_HEIGHT } from '../ground';
import { keyHash, seededRandom } from './hash';
import { seedOf } from './scatter';
import {
	EDGE_BUILT,
	hEdge,
	MAX_NOISE,
	MAX_ROUND,
	vEdge,
	visualFloorY,
	type WorldShape
} from './shape';

/** Floats per decal: x, y, z (its centre), yaw, size, atlas cell, shade, face, thinning key. */
export const DECAL_STRIDE = 9;
/** `face` of a floor decal; a wall decal's is its side of the cell, 0-3 (north, east, south, west). */
export const FLOOR_FACE = -1;
/** How far a wall decal stands off the wall's edge, in cells: the kit's thin half and a lift. */
export const FACE = WALL_HALF_THIN + 0.002;
/** How far a floor decal lies over its floor, in cells (kit tiles never rise above it, #254). */
export const FLOOR_LIFT = 0.002;
/** Half a flat cell's room for a decal, and the flat middle's of a cell by uneven ground. */
const ROOM = 0.48;
const MIDDLE = 0.5 - MAX_ROUND - MAX_NOISE;
/** The smallest decal worth laying, in cells. */
const LEAST = 0.2;
/** A wall foot's decal sinks this far under its floor, so its cut edge never shows. */
const SINK = 0.02;
/** The highest a window's foot decal reaches: under its sill (wall-batch.ts's 0.35 of the wall). */
const SILL = 0.33 * WALL_HEIGHT;
/** Along a wall a decal keeps clear of the posts at its ends. */
const CLEAR = 0.5 - POST_SIZE / 2;
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const PLAIN = FLOOR_IDS.indexOf('plain');

export interface DecalInput {
	/** The viewer's shape (`worldShape`, with `water` from `waterCells` when liquid props count). */
	shape: WorldShape;
	/** The roofed cells as sent, masked to the viewer. */
	interior: CellMask | null;
	/** The props the viewer was sent. */
	props: readonly Pick<Prop, 'assetId' | 'pos' | 'rotation'>[];
	/** The environment's id: with the rule index and the place, the whole seed. */
	environment: string;
	rules: readonly DecalRule[];
}

/** The atlas cell of a decal's variant (`DECAL_VARIANTS` per decal, in `DECAL_KEYS` order). */
export const atlasCell = (decal: DecalRule['decal'], variant: number): number =>
	DECAL_KEYS.indexOf(decal) * DECAL_VARIANTS + (variant % DECAL_VARIANTS);

/** Every decal of the table for this viewer (`DECAL_STRIDE` floats each), in cell order. */
export function decalsFor(input: DecalInput): Float32Array {
	const { shape, interior, props, rules } = input;
	const { grid, known, floor, water, levels } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const env = keyHash(input.environment);
	const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
	const isKnown = (j: number) => j >= 0 && (!known || !!known[j]);
	// Under any prop; and per rule, the cells of (`own`) and beside (`near`) the props it names.
	const covered = new Uint8Array(w * h);
	for (const p of props)
		for (const c of footprintCells(p)) if (at(c.x, c.y) >= 0) covered[at(c.x, c.y)] = 1;
	const masks = rules.map((rule) => {
		if (!rule.beside) return null;
		const [own, near] = [new Uint8Array(w * h), new Uint8Array(w * h)];
		for (const p of props) {
			if (
				!rule.beside.includes(p.assetId) &&
				!rule.beside.includes(ASSETS[p.assetId]?.category ?? '')
			)
				continue;
			for (const c of footprintCells(p)) {
				if (at(c.x, c.y) >= 0) own[at(c.x, c.y)] = 1;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++)
						if (at(c.x + dx, c.y + dy) >= 0) near[at(c.x + dx, c.y + dy)] = 1;
			}
		}
		return { own, near };
	});
	const takes = rules.map((rule) => {
		const set = new Uint8Array(FLOOR_IDS.length);
		for (const id of rule.on) set[id === 'default' ? PLAIN : FLOOR_IDS.indexOf(id as never)] = 1;
		return set;
	});
	/** Whether cell (x, y) and its eight neighbours are known, dry, solid ground at one level. */
	const flat = (x: number, y: number) => {
		const i = y * w + x;
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const j = at(x + dx, y + dy);
				if (!isKnown(j) || levels[j] !== levels[i] || water[j] || SOLID_FLOORS.has(floor[j]))
					return false;
			}
		return true;
	};

	const out: number[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (!isKnown(i) || water[i] || SOLID_FLOORS.has(floor[i])) continue;
			const centre = gridToWorld(grid, { x, y });
			const ground = visualFloorY(shape, { x, y });
			for (let k = 0; k < rules.length; k++) {
				const rule = rules[k];
				if (!takes[k][floor[i]] || (rule.outdoor && interior?.[i])) continue;
				const mask = masks[k];
				if (mask && !mask.near[i]) continue;
				const cell = (rng: () => number) =>
					atlasCell(rule.decal, Math.floor(rng() * DECAL_VARIANTS));
				const sized = (rng: () => number) => rule.size[0] + (rule.size[1] - rule.size[0]) * rng();
				if (rule.where === 'open') {
					if (covered[i] && !mask?.own[i]) continue;
					const rng = seededRandom(seedOf(env, k, x, y, 0));
					if (rng() >= rule.chance) continue;
					const [yaw, room] = [rng() * Math.PI * 2, flat(x, y) ? ROOM : MIDDLE];
					// A turned square's half reach along x and z; shrunk to fit its room.
					const spread = (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw))) / 2;
					const size = Math.min(sized(rng), room / spread);
					if (size < LEAST) continue;
					const m = room - size * spread;
					const [u, v] = [(rng() * 2 - 1) * m, (rng() * 2 - 1) * m];
					const [c, shade, key] = [cell(rng), 0.85 + 0.3 * rng(), rng()];
					out.push(centre.x + u * cs, ground + FLOOR_LIFT * cs, centre.z + v * cs);
					out.push(yaw, size * cs, c, shade, FLOOR_FACE, key);
					continue;
				}
				for (let d = 0; d < 4; d++) {
					const built = wallOn(shape, x, y, d);
					const j = at(x + DX[d], y + DY[d]);
					if (!built || (j >= 0 && !isKnown(j))) continue; // nothing faces unexplored ground
					if (built === EDGE_BUILT.window && rule.where !== 'wallFoot') continue;
					const rng = seededRandom(seedOf(env, k, x, y, d + 1));
					if (rng() >= rule.chance) continue;
					let size = Math.min(sized(rng), 2 * CLEAR);
					if (built === EDGE_BUILT.window) size = Math.min(size, SILL + SINK);
					const along = (rng() * 2 - 1) * (CLEAR - size / 2);
					const top = WALL_HEIGHT - 0.15 - size / 2;
					const rise =
						rule.where === 'wallFoot'
							? size / 2 - SINK
							: Math.min(top, WALL_HEIGHT * (0.4 + 0.3 * rng()));
					const off = 0.5 - FACE;
					const [c, shade, key] = [cell(rng), 0.85 + 0.3 * rng(), rng()];
					out.push(centre.x + (DX[d] * off + DY[d] * along) * cs, ground + rise * cs);
					out.push(centre.z + (DY[d] * off + DX[d] * along) * cs, 0, size * cs, c, shade, d, key);
				}
			}
		}
	return Float32Array.from(out);
}

/** What stands on side `d` of cell (x, y): a wall or a window (`EDGE_BUILT`), else 0. */
function wallOn(shape: WorldShape, x: number, y: number, d: number): number {
	const { grid, edges } = shape;
	const built =
		d & 1
			? edges.built.v[vEdge(grid, d === 1 ? x + 1 : x, y)]
			: edges.built.h[hEdge(grid, x, d === 0 ? y : y + 1)];
	return built === EDGE_BUILT.wall || built === EDGE_BUILT.window ? built : 0;
}
