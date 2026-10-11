// The spring arm (#290): how far the camera may stand from its pivot before terrain or a wall
// is in the way, found by walking the grid along the segment (no raycasts). Pure (no three.js),
// so the specs run in Node. It knows only the walls and levels the viewer was sent, so bumping
// into a wall can never reveal an unknown one. docs/RENDERING.md, "Spring arm".

import type { GridEdge, SquareGrid } from '../game/grid';
import { blockingEdges, edgeKey, type SceneObject } from '../game/objects';
import { cellAt, dampingFor } from './camera-rig';
import { WALL_HEIGHT, type Ground } from './ground';
import type { Vec3 } from './shots';
import { pickCell } from './world/pick';

/** The camera stays this far (cells) short of what blocks it, covering the near plane. */
export const ARM_MARGIN = 0.25;
/** The arm never shortens below this (cells): the camera stays out of the mini it looks from. */
export const ARM_MIN = 0.75;
/** How the camera eases back out once the way is clear: a factor at 60 Hz, about 250 ms. */
export const ARM_EASE = 0.18;
/** A floor this much (world units) over the pivot's counts as a rise toward the camera. */
const RISE = 1e-6;

/** Where the segment from `a` to `b` first crosses a blocking edge below its wall's top, as a distance. */
function wallHit(
	ground: Ground,
	edges: ReadonlySet<string>,
	grid: SquareGrid,
	a: Vec3,
	b: Vec3
): number | null {
	if (edges.size === 0) return null;
	const { width, height, cellSize } = grid;
	const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
	const u0 = a.x / cellSize + width / 2;
	const v0 = a.z / cellSize + height / 2;
	const du = (b.x - a.x) / cellSize;
	const dv = (b.z - a.z) / cellSize;
	let [cx, cy] = [Math.floor(u0), Math.floor(v0)];
	const [su, sv] = [du > 0 ? 1 : -1, dv > 0 ? 1 : -1];
	let tu = du === 0 ? Infinity : ((du > 0 ? cx + 1 : cx) - u0) / du;
	let tv = dv === 0 ? Infinity : ((dv > 0 ? cy + 1 : cy) - v0) / dv;
	const [dtu, dtv] = [
		du === 0 ? Infinity : 1 / Math.abs(du),
		dv === 0 ? Infinity : 1 / Math.abs(dv)
	];
	for (;;) {
		const t = Math.min(tu, tv);
		if (t > 1) return null;
		let edge: GridEdge;
		if (tu < tv) {
			const x = su > 0 ? cx + 1 : cx;
			edge = { a: { x, y: cy }, b: { x, y: cy + 1 } };
			[cx, tu] = [cx + su, tu + dtu];
		} else {
			const y = sv > 0 ? cy + 1 : cy;
			edge = { a: { x: cx, y }, b: { x: cx + 1, y } };
			[cy, tv] = [cy + sv, tv + dtv];
		}
		if (!edges.has(edgeKey(edge))) continue;
		const top = ground.edgeFloors(edge).high + WALL_HEIGHT * cellSize;
		if (a.y + (b.y - a.y) * t < top) return t * length;
	}
}

/**
 * How far from `pivot` toward `camera` (world units) the way is clear: the nearest of a column
 * of terrain rising above the segment (a floor higher than the pivot's, plus `clearance`) and a
 * wall edge in `edges` (`blockingEdges`: walls, windows and shut doors) crossed below its top,
 * less `ARM_MARGIN`; the segment's whole length when nothing is in the way. Cost: one step per cell the segment crosses.
 */
export function springArm(
	ground: Ground,
	edges: ReadonlySet<string>,
	grid: SquareGrid,
	pivot: Vec3,
	camera: Vec3,
	clearance: number
): number {
	const length = Math.hypot(camera.x - pivot.x, camera.y - pivot.y, camera.z - pivot.z);
	if (length < 1e-9) return 0;
	const dir = {
		x: (camera.x - pivot.x) / length,
		y: (camera.y - pivot.y) / length,
		z: (camera.z - pivot.z) / length
	};
	const base = ground.floorY(cellAt(grid, pivot.x, pivot.z));
	// Only ground that rises past the pivot's own floor can be in the way.
	const top = (x: number, y: number) => {
		const floor = ground.floorY({ x, y });
		return floor > base + RISE ? floor + clearance : floor;
	};
	let hit = length;
	const ground_ = pickCell(grid, top, pivot, dir);
	if (ground_.cell) {
		const p = ground_.point;
		hit = Math.min(hit, Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z));
	}
	hit = Math.min(hit, wallHit(ground, edges, grid, pivot, camera) ?? Infinity);
	// Nothing in the way: the whole segment, so a clear view never pulls the camera in.
	return hit >= length ? length : Math.max(0, hit - ARM_MARGIN * grid.cellSize);
}

/**
 * The camera's distance after a frame: in at once to what the arm allows (never under `min`),
 * and back out toward what the viewer wanted by `k` of the way (`dtMs` long frames, `ARM_EASE`
 * at 60 Hz; all of it at once under reduced motion).
 */
export function armDistance(
	wanted: number,
	free: number,
	current: number,
	min: number,
	dtMs: number,
	reduced: boolean
): number {
	const target = Math.max(min, Math.min(wanted, free));
	if (target <= current) return target;
	const k = reduced ? 1 : dampingFor(dtMs, ARM_EASE);
	return target - current < 1e-3 ? target : current + (target - current) * k;
}

/**
 * The spring arm's memory between frames (#290): the distance the viewer asked for, the walls
 * worked out for the last objects, and whether the camera is still easing back out.
 */
export class Arm {
	easing = false;
	private wanted = 0;
	private set = -1;
	private src: readonly SceneObject[] | null = null;
	private edges: ReadonlySet<string> = new Set();

	/** Forget it (the mode does not hold the camera off, or the camera was placed). */
	reset(): void {
		this.set = -1;
		this.easing = false;
	}

	/** The camera's distance for this frame, `pivot` to `camera` as the controls left them. */
	step(
		ground: Ground,
		objects: readonly SceneObject[],
		grid: SquareGrid,
		pivot: Vec3,
		camera: Vec3,
		clearance: number,
		dtMs: number,
		reduced: boolean
	): number {
		if (objects !== this.src) [this.src, this.edges] = [objects, blockingEdges(objects)];
		const cur = Math.hypot(camera.x - pivot.x, camera.y - pivot.y, camera.z - pivot.z);
		// The viewer zoomed (or this is the first frame): that is the distance they want.
		if (this.set < 0 || Math.abs(cur - this.set) > 0.01) this.wanted = cur;
		const k = cur > 0 ? this.wanted / cur : 1;
		const far = {
			x: pivot.x + (camera.x - pivot.x) * k,
			y: pivot.y + (camera.y - pivot.y) * k,
			z: pivot.z + (camera.z - pivot.z) * k
		};
		const free = springArm(ground, this.edges, grid, pivot, far, clearance);
		const min = ARM_MIN * grid.cellSize;
		const next = armDistance(this.wanted, free, cur, min, dtMs, reduced);
		this.set = next;
		this.easing = next < Math.max(min, Math.min(this.wanted, free)) - 1e-3;
		return next;
	}
}
