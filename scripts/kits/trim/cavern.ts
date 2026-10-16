// The cavern's trim (the Hollow): ancient squared stone, dark and weathered, over the cavern's
// block surface (`ancient-stone`): heavy coursed walls with a carved band, massive piers, slab
// copings, a lintelled gate, round arches for the island's arcades, a parapet of blocks, rough-hewn
// steps and the strata of the cliffs. Tinted over the world's surface, never a texture of their own.

import type { Trim } from './all';
import { box, rock, sweep, type V3 } from './geom';
import type { Piece } from './piece';
import { voussoirs } from './geom';
import { cliff, core, masonry } from './work';

const STONE: V3 = [0.72, 0.72, 0.74];
const DRESSED: V3 = [0.82, 0.82, 0.84];
const WEATHER: V3 = [0.55, 0.57, 0.58];

const z = 0.066;

/** Heavy ashlar: five courses of long blocks, one course set back where it has weathered. */
function wallAncient(id: string, seed: number, band: boolean, weight?: number): Piece {
	return {
		id,
		role: 'wall.straight',
		...(weight ? { weight } : {}),
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.05),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0,
				y1: band ? 1.1 : 2,
				z0: -z,
				z1: z,
				course: 0.4,
				len: [0.4, 0.7],
				seed,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			...(band
				? [
						box([1, 0.1, 0.136], [0, 1.15, 0], { tint: DRESSED, bevel: 0.01 }),
						...masonry({
							x0: -0.5,
							x1: 0.5,
							y0: 1.2,
							y1: 2,
							z0: -z,
							z1: z,
							course: 0.4,
							len: [0.4, 0.7],
							seed: seed + 1,
							tint: STONE,
							play: 0.02,
							vary: 0.14
						})
					]
				: [])
		]
	};
}

/** Rubble: small stones of every size, laid in rough courses, a chipped course here and there. */
function wallRough(): Piece {
	return {
		id: 'rough-wall',
		role: 'wall.straight',
		weight: 0.6,
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.05, 0.4),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0,
				y1: 2,
				z0: -z,
				z1: z,
				course: 0.285,
				len: [0.16, 0.42],
				seed: 411,
				tint: WEATHER,
				play: 0.03,
				vary: 0.22,
				joint: 0.02,
				bevel: 0.016
			})
		]
	};
}

/** A wall's outer face toward the void: thicker, battered, its foot a heavier course. */
function wallOuter(): Piece {
	return {
		id: 'ancient-wall-outer',
		role: 'wall.outer',
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.22),
			box([1, 0.4, 0.4], [0, 0.2, 0.13], { tint: STONE, bevel: 0.02 }),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0.4,
				y1: 2,
				z0: -z,
				z1: 0.24,
				course: 0.4,
				len: [0.4, 0.7],
				seed: 421,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			})
		]
	};
}

/** Rubble below the floor: a drop's retaining face, buried at the back. */
function retaining(): Piece {
	return {
		id: 'ancient-retaining',
		role: 'wall.retaining',
		parts: [
			core(-0.5, 0.5, -2, 0, -0.35, 0.05, 0.4),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: -2,
				y1: 0,
				z0: -0.3,
				z1: 0.066,
				course: 0.285,
				len: [0.2, 0.5],
				seed: 431,
				tint: WEATHER,
				play: 0.04,
				vary: 0.2,
				joint: 0.02,
				bevel: 0.016
			})
		]
	};
}

/** Slab coping, chipped: three stones to the cell with a drip, one with its corner gone. */
function coping(): Piece {
	const profile = (chip: number): [number, number][] => [
		[-0.1, 1.9],
		[0.1, 1.9],
		[0.1, 1.95],
		[0.096 - chip, 1.985],
		[0.07 - chip, 2.0],
		[-0.07, 2.0],
		[-0.1, 1.95]
	];
	return {
		id: 'slab-coping',
		role: 'cap',
		parts: [
			sweep(profile(0), -0.5, -0.12, { tint: DRESSED }),
			sweep(profile(0.03), -0.11, 0.24, { tint: DRESSED, tone: 0.92 }),
			sweep(profile(0), 0.25, 0.5, { tint: DRESSED, tone: 0.97 })
		]
	};
}

/** A footing: two rough squared blocks, a chunk fallen from the first. */
function plinth(): Piece {
	return {
		id: 'rough-plinth',
		role: 'plinth',
		parts: [
			box([0.55, 0.4, 0.13], [-0.225, 0.2, 0], { tint: STONE, bevel: 0.025 }),
			box([0.43, 0.36, 0.13], [0.28, 0.18, 0], { tint: WEATHER, bevel: 0.025 }),
			rock([0.12, 0.1, 0.1], [-0.4, 0.052, 0.0], { tint: WEATHER, seed: 5, rough: 0.1, flat: 0.2 })
		]
	};
}

/** A pier: a squat block base, drums with carved bands, a heavy capital. */
function pier(): Piece {
	return {
		id: 'ancient-pier',
		role: 'post.L',
		also: ['post.end', 'post.T', 'post.X'],
		parts: [
			box([0.38, 0.22, 0.38], [0, 0.11, 0], { tint: DRESSED, bevel: 0.03 }),
			box([0.34, 0.5, 0.34], [0, 0.47, 0], { tint: STONE, bevel: 0.035 }),
			box([0.37, 0.07, 0.37], [0, 0.755, 0], { tint: DRESSED, bevel: 0.015 }),
			box([0.34, 0.5, 0.34], [0, 1.04, 0], { tint: STONE, bevel: 0.035, tone: 0.95 }),
			box([0.37, 0.07, 0.37], [0, 1.325, 0], { tint: DRESSED, bevel: 0.015 }),
			box([0.34, 0.44, 0.34], [0, 1.58, 0], { tint: STONE, bevel: 0.035, tone: 0.9 }),
			box([0.38, 0.12, 0.38], [0, 1.86, 0], { tint: DRESSED, bevel: 0.03 }),
			box([0.3, 0.1, 0.3], [0, 1.97, 0], { tint: DRESSED, bevel: 0.025 }),
			box([0.2, 0.1, 0.2], [0, 2.07, 0], { tint: DRESSED, bevel: 0.02 })
		]
	};
}

/** A gate: monolith jambs, a heavy lintel with a relieving course, a worn sill. */
function doorFrame(): Piece {
	const o = 0.34;
	return {
		id: 'lintel-gate-frame',
		role: 'door.frame',
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.05),
			...[-1, 1].flatMap((s) => [
				box([0.16, 1.2, 0.136], [s * (o + 0.08), 0.6, 0], { tint: DRESSED, bevel: 0.015 }),
				box([0.16, 0.64, 0.136], [s * (o + 0.08), 1.52, 0], { tint: STONE, bevel: 0.015 })
			]),
			box([1, 0.16, 0.136], [0, 1.92, 0], { tint: DRESSED, bevel: 0.012 }),
			box([0.8, 0.05, 0.14], [0, 0.025, 0], { tint: DRESSED, bevel: 0.01 })
		]
	};
}

/** A round arch for the island's arcades: imposts, voussoirs, spandrels. */
function arch(): Piece {
	const r = 0.38;
	const spring = 1.4;
	return {
		id: 'ancient-arch',
		role: 'arch',
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.05),
			...[-1, 1].flatMap((s) => [
				box([0.2, 0.9, 0.136], [s * 0.4, 0.45, 0], { tint: STONE, bevel: 0.02 }),
				box([0.2, 0.5, 0.136], [s * 0.4, 1.15, 0], { tint: DRESSED, bevel: 0.02 }),
				box([0.22, 0.07, 0.136], [s * 0.39, spring - 0.035, 0], { tint: DRESSED, bevel: 0.01 })
			]),
			...voussoirs(0, spring, r - 0.04, r + 0.1, -0.066, 0.066, 8, { tint: DRESSED, seed: 7 }),
			box([0.9, 0.16, 0.136], [0, 1.92, 0], { tint: STONE, bevel: 0.012 })
		]
	};
}

/** A parapet: a course of blocks, a slab on top, a pier at each end of the cell. */
function parapet(): Piece {
	return {
		id: 'block-parapet',
		role: 'railing',
		parts: [
			box([1, 0.14, 0.13], [0, 0.07, 0], { tint: DRESSED, bevel: 0.015 }),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0.14,
				y1: 0.8,
				z0: -0.056,
				z1: 0.056,
				course: 0.33,
				len: [0.35, 0.6],
				seed: 441,
				tint: STONE,
				play: 0.015,
				vary: 0.1
			}),
			sweep(
				[
					[-0.066, 0.8],
					[0.066, 0.8],
					[0.066, 0.86],
					[0.05, 0.9],
					[-0.05, 0.9],
					[-0.066, 0.86]
				],
				-0.5,
				0.5,
				{ tint: DRESSED }
			),
			...[-1, 1].map((s) =>
				box([0.12, 1.0, 0.13], [s * 0.44, 0.5, 0], { tint: DRESSED, bevel: 0.02 })
			)
		]
	};
}

/** A rough-hewn step: one block, its nosing broken. */
function step(): Piece {
	const profile: [number, number][] = [
		[-0.33, -0.4],
		[0.04, -0.4],
		[0.066, -0.36],
		[0.066, -0.08],
		[0.05, -0.02],
		[0.02, 0],
		[-0.33, 0]
	];
	return {
		id: 'hewn-step',
		role: 'stair.riser',
		parts: [
			sweep(profile, -0.5, -0.05, { tint: STONE }),
			sweep(profile, -0.04, 0.5, { tint: WEATHER })
		]
	};
}

/** A stair's cheek: heavy blocks stepping down with the run. */
function cheek(): Piece {
	return {
		id: 'ancient-cheek',
		role: 'stair.side',
		parts: [
			core(-0.5, 0.5, -2, 0, -0.34, 0.05, 0.4),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: -2,
				y1: 0,
				z0: -0.34,
				z1: 0.066,
				course: 0.4,
				len: [0.4, 0.7],
				seed: 451,
				tint: STONE,
				play: 0.03,
				vary: 0.16
			}),
			sweep(
				[
					[-0.34, -0.06],
					[0.066, -0.06],
					[0.066, 0],
					[-0.34, 0]
				],
				-0.5,
				0.5,
				{ tint: DRESSED }
			)
		]
	};
}

/** A window: a square opening with a monolith lintel and a worn sill, ashlar all round. */
function windowFrame(): Piece {
	const [o, y0, y1] = [0.3, 0.9, 1.6];
	return {
		id: 'ancient-window',
		role: 'window.frame',
		parts: [
			core(-0.5, 0.5, 0, 2, -0.05, 0.05),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0,
				y1: y0 - 0.06,
				z0: -z,
				z1: z,
				course: 0.4,
				len: [0.4, 0.7],
				seed: 481,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			...masonry({
				x0: -0.5,
				x1: -o,
				y0: y0 - 0.06,
				y1: y1,
				z0: -z,
				z1: z,
				course: 0.35,
				len: [0.2, 0.2],
				seed: 482,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			...masonry({
				x0: o,
				x1: 0.5,
				y0: y0 - 0.06,
				y1: y1,
				z0: -z,
				z1: z,
				course: 0.35,
				len: [0.2, 0.2],
				seed: 483,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			box([0.74, 0.2, 0.136], [0, y1 + 0.1, 0], { tint: DRESSED, bevel: 0.012 }),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: y1 + 0.2,
				y1: 2,
				z0: -z,
				z1: z,
				course: 0.2,
				len: [0.4, 0.7],
				seed: 484,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			box([0.72, 0.06, 0.14], [0, y0 - 0.03, 0], { tint: DRESSED, bevel: 0.01 })
		]
	};
}

/** What stands under a window between two floors: the wall below the floor and a sill stone. */
function windowSill(): Piece {
	return {
		id: 'ancient-sill',
		role: 'window.sill',
		parts: [
			core(-0.5, 0.5, -2, 0, -0.05, 0.05),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: -2,
				y1: 0,
				z0: -z,
				z1: z,
				course: 0.4,
				len: [0.4, 0.7],
				seed: 491,
				tint: STONE,
				play: 0.02,
				vary: 0.14
			}),
			sweep(
				[
					[-0.066, 0.8],
					[0.066, 0.8],
					[0.066, 0.84],
					[0.05, 0.88],
					[-0.066, 0.88]
				],
				-0.4,
				0.4,
				{ tint: DRESSED }
			)
		]
	};
}

export function cavernTrim(): Trim {
	return {
		kit: 'cavern',
		pieces: [
			wallAncient('ancient-wall-a', 401, false),
			wallAncient('ancient-wall-b', 405, true, 0.7),
			wallRough(),
			wallOuter(),
			retaining(),
			coping(),
			plinth(),
			pier(),
			doorFrame(),
			arch(),
			windowFrame(),
			windowSill(),
			parapet(),
			step(),
			cheek(),
			cliff('strata-cliff', 'cliff.face', 461, [0.52, 0.54, 0.57]),
			cliff('strata-corner', 'cliff.corner', 471, [0.52, 0.54, 0.57])
		],
		external: { 'door.leaf': [{ model: 'iron-bound-door' }] }
	};
}
