// The living cave's trim (the Heart's chamber): sinew and bone over the cave's hide surfaces:
// ribbed membrane walls, cords for a coping, lumpy bone piers, swollen steps with a fleshy lip,
// roots at the foot. Organic work (work.ts): every lump from a seed, the same bytes each run.

import type { Trim } from './all';
import { box, rng, rock, type Part, type V3 } from './geom';
import type { Piece } from './piece';
import { organic, tube } from './work';

const SINEW: V3 = [0.88, 0.62, 0.58];
const FLESH: V3 = [0.8, 0.5, 0.48];
const DEEP: V3 = [0.47, 0.28, 0.3];
const BONE: V3 = [0.92, 0.86, 0.76];

/** A vertical rib: a lumpy tube, slightly bowed in and out of the wall. */
const rib = (x: number, y0: number, y1: number, r: number, seed: number, bow = 0.02): Part =>
	tube(
		[
			[x, y0 + 0.03, 0],
			[x + bow, (y0 * 2 + y1) / 3, bow],
			[x - bow, (y0 + y1 * 2) / 3, 0],
			[x, y1 - 0.03, bow / 2]
		],
		r,
		{ tint: SINEW, lump: 0.25, seed, taper: [1.25, 0.8], radial: 7 }
	);

/** Sinew over membrane: ribs, cross-cords and nodules, in the wall's thickness. */
function wallSinew(): Piece {
	const rand = rng(501);
	return {
		id: 'sinew-wall-a',
		role: 'wall.straight',
		parts: [
			box([1, 2, 0.09], [0, 1, 0], { tint: DEEP, bevel: 0.002, solids: false }),
			rib(-0.4, 0, 2, 0.04, 11),
			rib(0.38, 0, 2, 0.038, 12, 0.025),
			rib(0, 0, 2, 0.026, 13, 0.03),
			...[0.7, 1.35].map((y, i) =>
				tube(
					[
						[-0.47, y, 0.018],
						[-0.2, y - 0.07, 0.03],
						[0.2, y - 0.04, 0.022],
						[0.47, y, 0.018]
					],
					0.022,
					{ tint: FLESH, lump: 0.3, seed: 20 + i, radial: 6 }
				)
			),
			...[0, 1, 2, 3].map((i) =>
				rock(
					[0.13 + rand() * 0.08, 0.1 + rand() * 0.1, 0.05],
					[-0.3 + i * 0.22, 0.4 + rand() * 1.2, 0.03],
					{
						tint: FLESH,
						seed: 30 + i,
						rough: 0.2,
						flat: 0,
						detail: 1
					}
				)
			)
		]
	};
}

/** A swollen wall: a bulging mass over the membrane, a bundle of cords twisting up it. */
function wallSwollen(): Piece {
	return {
		id: 'sinew-wall-b',
		role: 'wall.straight',
		weight: 0.6,
		parts: [
			box([1, 2, 0.09], [0, 1, 0], { tint: DEEP, bevel: 0.002, solids: false }),
			organic((t) => 0.2 + 0.2 * Math.sin(Math.PI * t) ** 0.8, 2, [0, 0, 0.0], {
				tint: FLESH,
				seed: 41,
				lump: 0.2,
				seg: 10,
				rings: 8,
				twist: 0.6,
				squash: [1.05, 0.12],
				solids: false
			}),
			...[-1, 0, 1].map((k) =>
				tube(
					[
						[-0.08 + k * 0.07, 0.03, 0.025],
						[0.06 + k * 0.03, 0.7, 0.03],
						[-0.06 + k * 0.04, 1.4, 0.03],
						[0.04 + k * 0.05, 1.97, 0.03]
					],
					0.028,
					{ tint: SINEW, lump: 0.3, seed: 50 + k, radial: 6 }
				)
			),
			rib(-0.43, 0, 2, 0.038, 14),
			rib(0.43, 0, 2, 0.038, 15)
		]
	};
}

/** A wall's outer face toward the void: thicker, its ribs standing out. */
function wallOuter(): Piece {
	return {
		id: 'sinew-wall-outer',
		role: 'wall.outer',
		parts: [
			box([1, 2, 0.26], [0, 1, 0.08], { tint: DEEP, bevel: 0.02, solids: false }),
			...[-0.3, 0, 0.3].map((x, i) =>
				organic((t) => 0.07 + 0.035 * Math.sin(Math.PI * t * 3) ** 2, 2, [x, 0, 0.2], {
					tint: SINEW,
					seed: 60 + i,
					lump: 0.2,
					seg: 8,
					rings: 9,
					squash: [1, 1],
					solids: false
				})
			),
			tube(
				[
					[-0.46, 1.0, 0.24],
					[-0.15, 0.93, 0.27],
					[0.2, 0.96, 0.26],
					[0.46, 1.0, 0.24]
				],
				0.04,
				{ tint: FLESH, lump: 0.25, seed: 66, radial: 6 }
			)
		]
	};
}

/** A cord along the wall's head: twisted, sagging between the cells, with a few strands hanging. */
function cord(): Piece {
	const parts: Part[] = [
		tube(
			[
				[-0.47, 1.88, 0],
				[-0.25, 1.85, 0.01],
				[0.1, 1.89, -0.01],
				[0.47, 1.88, 0]
			],
			0.062,
			{ tint: SINEW, lump: 0.3, seed: 71, radial: 8, taper: [1, 1.05] }
		),
		tube(
			[
				[-0.47, 1.9, 0.05],
				[-0.1, 1.86, 0.06],
				[0.3, 1.89, 0.05],
				[0.47, 1.9, 0.04]
			],
			0.03,
			{ tint: FLESH, lump: 0.35, seed: 72, radial: 6 }
		)
	];
	for (const [x, len] of [
		[-0.3, 0.22],
		[0.2, 0.3]
	] as const)
		parts.push(
			tube(
				[
					[x, 1.88, 0.03],
					[x + 0.02, 1.88 - len / 2, 0.05],
					[x, 1.88 - len, 0.04]
				],
				0.018,
				{ tint: FLESH, lump: 0.3, seed: 73, radial: 5, taper: [1, 0.4] }
			)
		);
	return { id: 'sinew-cord', role: 'cap', parts };
}

/** A pier of bone: flared at the foot, waisted, a knuckle at the head, joints ringed. */
function pillar(): Piece {
	return {
		id: 'bone-pillar',
		role: 'post.L',
		also: ['post.end', 'post.T', 'post.X'],
		parts: [
			organic((t) => 0.16 - 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.3)) ** 1, 0.3, [0, 0, 0], {
				tint: BONE,
				seed: 81,
				lump: 0.1,
				seg: 9,
				rings: 4
			}),
			organic((t) => 0.1 + 0.025 * Math.sin(Math.PI * t * 2) ** 2, 1.55, [0, 0.28, 0], {
				tint: BONE,
				seed: 82,
				lump: 0.12,
				seg: 9,
				rings: 9,
				twist: 0.5
			}),
			organic((t) => 0.1 + 0.07 * Math.sin(Math.PI * t) ** 0.7, 0.34, [0, 1.8, 0], {
				tint: BONE,
				seed: 83,
				lump: 0.12,
				seg: 9,
				rings: 5
			}),
			...[0.9, 1.35].map((y, i) =>
				organic((t) => 0.125 + 0.012 * Math.sin(Math.PI * t), 0.06, [0, y, 0], {
					tint: FLESH,
					seed: 90 + i,
					lump: 0.1,
					seg: 9,
					rings: 2
				})
			)
		]
	};
}

/** Roots at the foot of a wall: three swellings and the strands between. */
function roots(): Piece {
	return {
		id: 'root-footing',
		role: 'plinth',
		parts: [
			...[-0.3, 0, 0.3].map((x, i) =>
				rock([0.27, 0.32, 0.11], [x, 0.17, 0], {
					tint: FLESH,
					seed: 100 + i,
					rough: 0.2,
					flat: 0.15
				})
			),
			tube(
				[
					[-0.47, 0.06, 0.012],
					[-0.15, 0.13, 0.018],
					[0.2, 0.08, 0.015],
					[0.47, 0.1, 0.012]
				],
				0.032,
				{ tint: SINEW, lump: 0.3, seed: 104, radial: 6 }
			)
		]
	};
}

/** A swollen step: a rounded slab with a fleshy lip along its nosing. */
function step(): Piece {
	return {
		id: 'swollen-step',
		role: 'stair.riser',
		parts: [
			box([1, 0.4, 0.3], [0, -0.2, -0.16], { tint: FLESH, bevel: 0.07 }),
			tube(
				[
					[-0.47, -0.07, 0.01],
					[-0.15, -0.075, 0.016],
					[0.2, -0.07, 0.012],
					[0.47, -0.07, 0.01]
				],
				0.04,
				{ tint: SINEW, lump: 0.25, seed: 111, radial: 7 }
			)
		]
	};
}

/** A cheek: a swollen wall following the steps, a rib on its face. */
function cheek(): Piece {
	return {
		id: 'swollen-cheek',
		role: 'stair.side',
		parts: [
			box([1, 2, 0.3], [0, -1, -0.17], { tint: FLESH, bevel: 0.08 }),
			rock([0.5, 0.5, 0.14], [-0.15, -0.9, -0.0], {
				tint: SINEW,
				seed: 121,
				rough: 0.22,
				flat: 0,
				detail: 1
			})
		]
	};
}

/** Flesh heaped down a drop: lumps over a membrane, buried at the back. */
function retaining(): Piece {
	const rand = rng(131);
	return {
		id: 'sinew-retaining',
		role: 'wall.retaining',
		parts: [
			box([1, 2, 0.3], [0, -1, -0.19], { tint: DEEP, bevel: 0.01, solids: false }),
			...Array.from({ length: 7 }, (_, i) =>
				rock([0.34, 0.34, 0.2], [-0.28 + (i % 2) * 0.3 + rand() * 0.06, -0.19 - i * 0.26, -0.1], {
					tint: FLESH,
					seed: 140 + i,
					rough: 0.22,
					flat: 0,
					detail: 1
				})
			)
		]
	};
}

/** A cliff of heaped flesh, as a drop's face and corner. */
function heap(id: string, role: 'cliff.face' | 'cliff.corner', seed: number): Piece {
	const rand = rng(seed);
	const face = role === 'cliff.face';
	return {
		id,
		role,
		parts: Array.from({ length: face ? 6 : 4 }, (_, i) =>
			rock(
				[0.7, 0.45, 0.3],
				[face ? (i % 2) * 0.1 - 0.05 : -0.05, -0.35 - i * 0.3, face ? -0.18 : -0.05],
				{
					tint: FLESH,
					tone: 0.85 + 0.15 * rand(),
					seed: seed + i,
					rough: 0.2,
					flat: 0,
					detail: 1
				}
			)
		)
	};
}

/** A rail of bone: a rib along the top, struts of bone at each end. */
function boneRail(): Piece {
	return {
		id: 'bone-rail',
		role: 'railing',
		parts: [
			tube(
				[
					[-0.47, 0.92, 0],
					[-0.15, 0.97, 0.01],
					[0.2, 0.93, -0.01],
					[0.47, 0.92, 0]
				],
				0.04,
				{ tint: BONE, lump: 0.2, seed: 151, radial: 7 }
			),
			...[-0.42, 0.42].map((x, i) =>
				organic((t) => 0.035 + 0.03 * (1 - t) ** 2, 0.95, [x, 0, 0], {
					tint: BONE,
					seed: 152 + i,
					lump: 0.12,
					seg: 7,
					rings: 6
				})
			)
		]
	};
}

export function caveTrim(): Trim {
	return {
		kit: 'living-cave',
		pieces: [
			wallSinew(),
			wallSwollen(),
			wallOuter(),
			cord(),
			pillar(),
			roots(),
			step(),
			cheek(),
			retaining(),
			heap('flesh-heap', 'cliff.face', 161),
			heap('flesh-corner', 'cliff.corner', 171),
			boneRail()
		],
		external: {}
	};
}
