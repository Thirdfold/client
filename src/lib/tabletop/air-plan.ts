// What the air layer (air.ts, M75 #318 and #319) puts where: pure and Node-tested (air-plan.spec.ts).
// Motes sit on a world-fixed lattice round the camera's target, so a mote never moves when the
// camera does and only the lattice points that enter or leave the ring appear and vanish; fireflies
// sit over the grass cells the viewer knows; an effect prop or a model socket is a loop at a point
// on it; a lightning prop strikes on a schedule that is a function of the clock and its seed. Every
// choice is a hash of ids, cells and the clock, never of anything the viewer was not sent.

import { pulseBetween, type WeatherNow } from '../game/lightning';
import { footprintCells, type Prop } from '../game/props';
import { gridToWorld, worldToGrid, type SquareGrid } from '../game/grid';
import type { FxRecipe, FxSocket, Motes } from '../assets/fx';
import { HUES, HUE_SEEDS, RECIPES, type RecipeId } from './vfx-recipes';
import { seededRandom } from './world/seeded';
import type { Ground } from './ground';
import type { LoopSpec, Origin } from './vfx-state';

/** The lattice motes are laid on, world units apart: a loop's disc (radius 4.2) just overlaps its neighbours'. */
export const LATTICE = 8;
/** Motes per tier (#318); the low tier's are doubled, since the particle layer halves them there. */
export const MOTE_COUNTS = { low: 300, medium: 400, high: 1000, ultra: 1000 } as const;
/** How far above the floor a mote loop stands, and a firefly's hover. */
export const MOTE_LIFT = 0.25;
export const FIREFLY_LIFT = 0.5;
/** Fireflies: grass cells within this many cells of the target, the share of them with a loop. */
export const FIREFLY_REACH = 14;
export const FIREFLY_SHARE = 0.1;

/** A uniform number in [0, 1) from up to three integers: the same on every client. */
export function hash01(a: number, b = 0, c = 0): number {
	const seed =
		Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
	return seededRandom(seed)();
}

/** A string as a small integer (FNV-1a): the same prop id, the same number. */
export function idSeed(id: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** The recipe a mote kind loops. */
export const MOTE_RECIPE: Record<Motes, RecipeId> = {
	'cavern-motes': 'cavern-motes',
	spores: 'spores',
	fireflies: 'fireflies',
	'blowing-dust': 'blowing-dust',
	'railcar-dust': 'railcar-dust'
};

/** The recipe each socket or effect prop loops (a lightning prop's is its glow; the bolts are bursts). */
export const FX_LOOP: Record<FxRecipe, RecipeId> = {
	smoke: 'smoke',
	steam: 'steam',
	'magic-aura': 'magic-aura',
	lightning: 'lightning-glow',
	sparks: 'sparks'
};

/**
 * The lattice points nearest `target` (world x, z), as many as the tier's mote count holds of
 * `kind`'s loops, nearest first, those off the grid left out. Each is the world point of its loop.
 */
export function moteAnchors(
	kind: Exclude<Motes, 'fireflies'>,
	tier: keyof typeof MOTE_COUNTS,
	target: { x: number; z: number },
	grid: SquareGrid,
	ground: Ground
): Origin[] {
	const loops = Math.max(1, Math.floor(MOTE_COUNTS[tier] / RECIPES[MOTE_RECIPE[kind]].count));
	const [ci, cj] = [Math.floor(target.x / LATTICE), Math.floor(target.z / LATTICE)];
	const reach = Math.ceil(Math.sqrt(loops)) + 1;
	const points: (Origin & { d: number })[] = [];
	for (let j = cj - reach; j <= cj + reach; j++)
		for (let i = ci - reach; i <= ci + reach; i++) {
			const [x, z] = [(i + 0.5) * LATTICE, (j + 0.5) * LATTICE];
			const cell = worldToGrid(grid, { x, z });
			if (!cell) continue;
			points.push({
				x,
				y: ground.floorY(cell) + MOTE_LIFT,
				z,
				d: Math.hypot(x - target.x, z - target.z)
			});
		}
	points.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
	return points.slice(0, loops).map(({ x, y, z }) => ({ x, y, z }));
}

/**
 * One loop of fireflies over `FIREFLY_SHARE` of the grass cells within `FIREFLY_REACH` of the
 * target, the share decided by each cell's hash (so it stays put as the target moves), the lowest
 * hashes first when the tier's count runs out. `cells` are the known grass cells (row-major indices).
 */
export function fireflyLoops(
	cells: Uint16Array,
	tier: keyof typeof MOTE_COUNTS,
	target: { x: number; z: number },
	grid: SquareGrid,
	ground: Ground
): LoopSpec[] {
	const cap = Math.floor(MOTE_COUNTS[tier] / RECIPES.fireflies.count);
	const [tx, ty] = [
		target.x / grid.cellSize + grid.width / 2,
		target.z / grid.cellSize + grid.height / 2
	];
	const chosen: { i: number; h: number }[] = [];
	for (const i of cells) {
		const [x, y] = [i % grid.width, Math.floor(i / grid.width)];
		if (Math.abs(x + 0.5 - tx) > FIREFLY_REACH || Math.abs(y + 0.5 - ty) > FIREFLY_REACH) continue;
		const h = hash01(i, 0xf1);
		if (h < FIREFLY_SHARE) chosen.push({ i, h });
	}
	chosen.sort((a, b) => a.h - b.h || a.i - b.i);
	return chosen.slice(0, cap).map(({ i }) => {
		const cell = { x: i % grid.width, y: Math.floor(i / grid.width) };
		const { x, z } = gridToWorld(grid, cell);
		const [jx, jz] = [hash01(i, 1) - 0.5, hash01(i, 2) - 0.5];
		return {
			recipe: 'fireflies',
			origin: {
				x: x + jx * 0.6 * grid.cellSize,
				y: ground.floorY(cell) + FIREFLY_LIFT,
				z: z + jz * 0.6 * grid.cellSize
			},
			seed: i
		};
	});
}

/** The world point of a socket on a prop: its footprint's centre on its highest floor, turned and scaled. */
export function socketPoint(
	prop: Pick<Prop, 'assetId' | 'pos' | 'rotation' | 'scale'>,
	at: readonly [number, number, number],
	grid: SquareGrid,
	ground: Ground
): Origin {
	const cells = footprintCells(prop);
	const centres = cells.map((c) => gridToWorld(grid, c));
	const [cx, cz] = [
		centres.reduce((s, p) => s + p.x, 0) / centres.length,
		centres.reduce((s, p) => s + p.z, 0) / centres.length
	];
	const floor = Math.max(...cells.map((c) => ground.floorY(c)));
	const k = grid.cellSize * prop.scale;
	const turn = (-prop.rotation * Math.PI) / 2; // props.ts: the model turns about y by this
	const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
	return {
		x: cx + (at[0] * cos + at[2] * sin) * k,
		y: floor + at[1] * k,
		z: cz + (-at[0] * sin + at[2] * cos) * k
	};
}

/** The sockets an effect model declares, as loops on a prop: [recipe id, point] per socket. */
export function socketLoops(
	prop: Pick<Prop, 'assetId' | 'pos' | 'rotation' | 'scale'>,
	sockets: readonly FxSocket[],
	grid: SquareGrid,
	ground: Ground
): { fx: FxRecipe; origin: Origin }[] {
	return sockets.map((s) => ({ fx: s.recipe, origin: socketPoint(prop, s.at, grid, ground) }));
}

/** A hex tint's hue step (0 to `HUES` - 1) from the magic aura's own violet, 0 for a grey or none. */
export function hueStep(tint: string | undefined): number {
	if (!tint || !/^#[0-9a-f]{6}$/i.test(tint)) return 0;
	const [r, g, b] = [1, 3, 5].map((k) => parseInt(tint.slice(k, k + 2), 16) / 255);
	const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
	if (max - min < 0.15) return 0;
	const d = max - min;
	const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	const AURA = 262.5; // the hue of the recipe's own colour
	const turn = (((hue * 60 - AURA) % 360) + 360) % 360;
	return Math.round(turn / (360 / HUES)) % HUES;
}

/** A tinted effect's seed: its id's number below `HUE_SEEDS`, its tint's hue step above. */
export const tintSeed = (id: string, tint?: string): number =>
	hueStep(tint) * HUE_SEEDS + (idSeed(id) % HUE_SEEDS);

// Lightning (#319, made server-timed by #323). A prop strikes once in each slot of
// `STRIKE_SLOT_MS`, at an offset of its own within the slot's first `STRIKE_SPREAD_MS`, all on the
// server's clock (the caller passes server time) and seeded by the prop's position, so every client
// sees the same strike at the same moment: strikes of one prop are 4 s apart at the least. A strike
// is snapped up to the grid of `STRIKE_GAP_MS`, and of the props striking at one grid time only the
// lowest seed does, so a table's props never flash more than 3 times a second (WCAG 2.3.1,
// docs/RENDERING.md "Seeded lightning"); a prop also keeps `STRIKE_CLEAR_MS` from the weather's
// own pulses (game/lightning.ts): no second holds both, so it holds the weather's two pulses or
// at most three props' strikes.
export const STRIKE_SLOT_MS = 8000;
/** Strikes begin in the slot's first this long: with the grid's snap up, the slot's first 4 s. */
export const STRIKE_SPREAD_MS = 3660;
export const STRIKE_GAP_MS = 340;
export const STRIKE_CLEAR_MS = 1000;
/** A strike more than this late (a tab coming back) is skipped, not played at once. */
export const STRIKE_LATE_MS = 250;

/** A prop's seed from where it stands, not its id (ids differ between saves of one table). */
export const posSeed = (pos: { x: number; y: number }): number =>
	(Math.imul(pos.x + 1, 0x9e3779b1) ^ Math.imul(pos.y + 1, 0x85ebca6b)) >>> 0;

/** When a prop with `seed` strikes in `slot`, in ms on the server's clock. */
export const strikeTime = (seed: number, slot: number): number =>
	Math.ceil((slot * STRIKE_SLOT_MS + hash01(seed, slot, 0x5b) * STRIKE_SPREAD_MS) / STRIKE_GAP_MS) *
	STRIKE_GAP_MS;

/** The slot whose strike is due at server time `now` (within `STRIKE_LATE_MS` after it), or null. */
export function strikeDue(seed: number, now: number): number | null {
	const slot = Math.floor(now / STRIKE_SLOT_MS);
	const late = now - strikeTime(seed, slot);
	return late >= 0 && late < STRIKE_LATE_MS ? slot : null;
}

/**
 * Whether the prop with `seed` may strike in `slot` among the props with `seeds`: not when a lower
 * seed strikes at the same grid time, nor within `STRIKE_CLEAR_MS` of a pulse of the weather's
 * lightning (`weather`, null with none).
 */
export function strikeAllowed(
	seed: number,
	slot: number,
	seeds: readonly number[],
	weather: WeatherNow | null
): boolean {
	const at = strikeTime(seed, slot);
	if (seeds.some((o) => o < seed && strikeTime(o, slot) === at)) return false;
	return !weather || !pulseBetween(weather, at - STRIKE_CLEAR_MS + 1, at + STRIKE_CLEAR_MS);
}

/** A bolt's height above its base, cells. */
export const BOLT_HEIGHT = 4.5;
const BOLT_STEPS = 22;
const BOLT_BRANCH = [9, 8] as const; // from this step, for this many steps

/**
 * The points of the strike `slot` of a prop at `base`: a jagged line from `BOLT_HEIGHT` cells up
 * down to its base, a branch off its middle, two points to a step. The same on every client.
 */
export function boltPoints(seed: number, slot: number, base: Origin, cell: number): Origin[] {
	const spread = (k: number, step: number) =>
		(hash01(seed, slot * 64 + step, k) - 0.5) * 0.9 * cell;
	const along = (step: number): Origin => {
		const t = step / BOLT_STEPS;
		const swing = Math.sin(Math.PI * t); // the ends stay on the axis
		return {
			x: base.x + spread(1, step) * swing * 1.6,
			y: base.y + (1 - t) * BOLT_HEIGHT * cell,
			z: base.z + spread(2, step) * swing * 1.6
		};
	};
	const main = Array.from({ length: BOLT_STEPS + 1 }, (_, i) => along(i));
	const [from, length] = BOLT_BRANCH;
	const side = hash01(seed, slot, 3) < 0.5 ? -1 : 1;
	const branch = Array.from({ length }, (_, i) => {
		const p = main[from];
		const s = i + 1;
		return {
			x: p.x + side * 0.28 * s * cell + spread(4, from + s) * 0.5,
			y: p.y - 0.2 * s * cell,
			z: p.z + spread(5, from + s) * 0.9 * 0.5 * s
		};
	});
	const mid = (a: Origin, b: Origin): Origin => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
		z: (a.z + b.z) / 2
	});
	const dense = (pts: Origin[]) => pts.flatMap((p, i) => (i ? [mid(pts[i - 1], p), p] : [p]));
	return [...dense(main), ...dense([main[from], ...branch])];
}
