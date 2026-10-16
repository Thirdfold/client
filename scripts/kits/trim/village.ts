// The village's trim (Bellweather): oak and fieldstone, plaster and thatch. Timber that stands
// alone is its own surface (`oak-timber`, the library's weathered planks, the grain along the
// beam); the plinth is fieldstone (`field-stone`, the cobbles); what stands in a plaster wall is
// tinted over it, and the roofs' caps, chimneys and dormers over the thatch.

import type { Trim } from './all';
import { box, rng, rock, type Part, type V3 } from './geom';
import { cliff, core, masonry } from './work';
import type { Piece } from './piece';
import { roofPieces, type RoofStyle } from './roofs';

const OAK = { material: 'oak-timber', tile: 1.6 } as const;
/** Linear tints over the plaster's own colour: dark oak, weathered oak, a pale footing, a dark pot. */
const DARK_OAK: V3 = [0.16, 0.1, 0.065];
const OAK_TINT: V3 = [0.22, 0.14, 0.085];
const STONE: V3 = [0.8, 0.78, 0.72];
const STRAW: V3 = [1, 0.96, 0.82];

// ---------------------------------------------------------------- timber, alone

/** A corner post: a padstone, a stop-chamfered shaft, a capital and the peg of its tie. */
function post(): Piece {
	return {
		id: 'oak-post',
		role: 'post.L',
		also: ['post.end', 'post.T', 'post.X'],
		sheet: { ...OAK, grain: 'y' },
		parts: [
			box([0.3, 0.1, 0.3], [0, 0.05, 0], { bevel: 0.015 }),
			box([0.25, 0.1, 0.25], [0, 0.15, 0], { bevel: 0.035 }),
			box([0.23, 1.62, 0.23], [0, 1.01, 0], { bevel: 0.03 }),
			box([0.25, 0.1, 0.25], [0, 1.87, 0], { bevel: 0.035 }),
			box([0.31, 0.09, 0.31], [0, 1.975, 0], { bevel: 0.015 }),
			box([0.11, 0.1, 0.11], [0, 2.07, 0], { bevel: 0.012 })
		]
	};
}

/** The wall plate: an oak beam along the wall's head, a little proud of the plaster. */
function plate(id: string, feet: boolean, weight?: number): Piece {
	return {
		id,
		role: 'cap',
		...(weight ? { weight } : {}),
		sheet: { ...OAK, grain: 'x' },
		parts: [
			box([1, 0.11, 0.17], [0, 1.935, 0], { bevel: 0.02 }),
			box([0.07, 0.09, 0.18], [-0.46, 1.935, 0], { bevel: 0.01 }),
			box([0.07, 0.09, 0.18], [0.46, 1.935, 0], { bevel: 0.01 }),
			...(feet
				? [-0.3, 0, 0.3].map((x) => box([0.07, 0.08, 0.1], [x, 1.87, 0.05], { bevel: 0.01 }))
				: [])
		]
	};
}

/** A footing of fieldstones, a course high, each a rock of its own. */
function plinth(): Piece {
	const rand = rng(11);
	const stones = [-0.375, -0.125, 0.125, 0.375].map((x, i) => {
		const h = 0.32 + rand() * 0.07;
		return rock([0.225 + rand() * 0.015, h, 0.12], [x, h / 2 + 0.002, 0], {
			seed: 20 + i,
			rough: 0.08,
			flat: 0.22
		});
	});
	return {
		id: 'fieldstone-plinth',
		role: 'plinth',
		sheet: { material: 'field-stone', tile: 1.2, grain: 'x' },
		parts: [...stones, box([1, 0.1, 0.12], [0, 0.05, 0], { bevel: 0.01 })]
	};
}

// ---------------------------------------------------------------- walls

/** A footing of fieldstones under a plaster wall, to the height of the course. */
const footing = (seed: number, y1 = 0.34, z1 = 0.066): Part[] =>
	masonry({
		x0: -0.5,
		x1: 0.5,
		y0: 0,
		y1,
		z0: -0.066,
		z1,
		course: 0.17,
		len: [0.16, 0.34],
		seed,
		tint: STONE,
		play: 0.025,
		vary: 0.2,
		joint: 0.02,
		bevel: 0.014
	});

/** Plaster on a fieldstone footing, an oak sill plate between. */
function wallPlain(): Piece {
	return {
		id: 'plaster-wall-a',
		role: 'wall.straight',
		parts: [
			core(-0.5, 0.5, 0, 0.36, -0.05, 0.05),
			...footing(701),
			box([1, 0.06, 0.13], [0, 0.37, 0], { tint: DARK_OAK, bevel: 0.012 }),
			box([1, 1.6, 0.11], [0, 1.2, 0], { bevel: 0.006, solids: false })
		]
	};
}

/** Timber framing: oak studs and rails proud of the plaster, braces across, a footing below. */
function wallFramed(id: string, weight: number, brace: 'one' | 'cross'): Piece {
	const parts: Part[] = [
		core(-0.5, 0.5, 0, 0.36, -0.05, 0.05),
		...footing(711 + weight * 10),
		box([1, 0.06, 0.13], [0, 0.37, 0], { tint: DARK_OAK, bevel: 0.012 }),
		box([1, 1.6, 0.1], [0, 1.2, 0], { bevel: 0.004, solids: false }),
		...[-0.455, 0.455].map((x) =>
			box([0.09, 1.6, 0.132], [x, 1.2, 0], { tint: DARK_OAK, bevel: 0.012 })
		),
		box([0.05, 1.6, 0.126], [0, 1.2, 0], { tint: DARK_OAK, bevel: 0.01 }),
		box([1, 0.09, 0.132], [0, 1.1, 0], { tint: DARK_OAK, bevel: 0.012 })
	];
	const braces: [number, number, number][] =
		brace === 'one'
			? [
					[-0.23, 0.72, 0.45],
					[0.23, 1.5, -0.45]
				]
			: [
					[-0.23, 0.72, 0.5],
					[-0.23, 1.5, -0.5],
					[0.23, 0.72, -0.5],
					[0.23, 1.5, 0.5]
				];
	for (const [x, y, turn] of braces)
		parts.push(
			box([0.07, brace === 'one' ? 0.62 : 0.5, 0.124], [x, y, 0], {
				tint: DARK_OAK,
				bevel: 0.01,
				turn: [0, 0, turn]
			})
		);
	return { id, role: 'wall.straight', weight, parts };
}

/** A wall's outer face toward the void: its footing a course deeper, the plaster above. */
function wallOuter(): Piece {
	return {
		id: 'plaster-wall-outer',
		role: 'wall.outer',
		parts: [
			core(-0.5, 0.5, 0, 0.4, -0.05, 0.2),
			...masonry({
				x0: -0.5,
				x1: 0.5,
				y0: 0,
				y1: 0.4,
				z0: -0.066,
				z1: 0.22,
				course: 0.2,
				len: [0.18, 0.4],
				seed: 721,
				tint: STONE,
				play: 0.03,
				vary: 0.2,
				joint: 0.02,
				bevel: 0.016
			}),
			box([1, 1.6, 0.12], [0, 1.2, 0.02], { bevel: 0.006, solids: false }),
			box([1, 0.06, 0.15], [0, 0.43, 0.03], { tint: DARK_OAK, bevel: 0.012 })
		]
	};
}

/** Fieldstone below a floor: the drop's retaining face, buried at the back. */
function retaining(): Piece {
	return {
		id: 'fieldstone-retaining',
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
				len: [0.22, 0.5],
				seed: 731,
				tint: STONE,
				play: 0.04,
				vary: 0.22,
				joint: 0.02,
				bevel: 0.016
			})
		]
	};
}

// ---------------------------------------------------------------- the door

/** A ledged and braced plank door: boards, three ledges and a brace, a latch and its ring. */
function plankDoor(): Piece {
	const w = 0.66;
	const boards = 7;
	const bw = w / boards;
	const rand = rng(31);
	const parts: Part[] = [];
	for (let i = 0; i < boards; i++) {
		const h = 1.82 - rand() * 0.012;
		parts.push(
			box([bw - 0.006, h, 0.036], [-w / 2 + bw * (i + 0.5), h / 2 + 0.01, 0.012], { bevel: 0.007 })
		);
	}
	for (const y of [0.22, 0.9, 1.6])
		parts.push(box([w - 0.02, 0.12, 0.03], [0, y, -0.026], { bevel: 0.008 }));
	// The brace, rising from the hinge side's lower ledge to the top ledge on the latch side.
	const rise = 1.6 - 0.22;
	const run = w - 0.14;
	parts.push(
		box([Math.hypot(run, rise) - 0.12, 0.1, 0.028], [0, 0.91, -0.052], {
			bevel: 0.007,
			turn: [0, 0, Math.atan2(rise, run)]
		})
	);
	parts.push(box([0.2, 0.04, 0.03], [w / 2 - 0.15, 0.95, 0.04], { bevel: 0.008 }));
	return {
		id: 'plank-door',
		role: 'door.leaf',
		sheet: { ...OAK, grain: 'y' },
		// Its hinge end at the frame's jamb: x from -0.33 to 0.33.
		parts
	};
}

/**
 * A plaster wall with a door's opening: oak jambs and a lintel proud of the plaster, a stone
 * threshold, the plaster returning into the reveal.
 */
function doorFrame(): Piece {
	const o = 0.34; // the opening's half width: the leaf's
	return {
		id: 'plaster-door-frame',
		role: 'door.frame',
		parts: [
			...[-1, 1].map((s) =>
				box([0.5 - o - 0.09, 2, 0.12], [s * (o + 0.09 + (0.5 - o - 0.09) / 2), 1, 0])
			),
			// The jambs, with a stop-chamfer, and the oak lintel with its peg heads.
			...[-1, 1].map((s) =>
				box([0.09, 1.84, 0.13], [s * (o + 0.045), 0.92, 0], { tint: DARK_OAK, bevel: 0.015 })
			),
			box([0.9, 0.15, 0.132], [0, 1.915, 0], { tint: DARK_OAK, bevel: 0.02 }),
			...[-1, 1].map((s) => box([0.03, 0.03, 0.14], [s * 0.36, 1.915, 0], { tint: DARK_OAK })),
			box([0.8, 0.045, 0.14], [0, 0.0225, 0], { tint: STONE, bevel: 0.01 })
		]
	};
}

// ---------------------------------------------------------------- windows

/** A window in plaster: a sill board, oak jambs, head and a mullion; open (the panes are glass's). */
function windowFrame(): Piece {
	const [ox, y0, y1] = [0.27, 0.86, 1.58];
	const plasterSide = (0.5 - ox - 0.06) / 2;
	return {
		id: 'plaster-window',
		role: 'window.frame',
		parts: [
			box([1, y0, 0.12], [0, y0 / 2, 0]),
			box([1, 2 - y1, 0.12], [0, (y1 + 2) / 2, 0]),
			...[-1, 1].map((s) =>
				box([plasterSide * 2, y1 - y0, 0.12], [s * (ox + 0.06 + plasterSide), (y0 + y1) / 2, 0])
			),
			...[-1, 1].map((s) =>
				box([0.06, y1 - y0, 0.132], [s * (ox + 0.03), (y0 + y1) / 2, 0], {
					tint: DARK_OAK,
					bevel: 0.01
				})
			),
			box([0.66, 0.06, 0.132], [0, y1 - 0.03, 0], { tint: DARK_OAK, bevel: 0.01 }),
			box([0.66, 0.05, 0.132], [0, y0 + 0.025, 0], { tint: DARK_OAK, bevel: 0.01 }),
			box([0.04, y1 - y0, 0.04], [0, (y0 + y1) / 2, 0], { tint: DARK_OAK, bevel: 0.006 }),
			box([0.58, 0.035, 0.04], [0, (y0 + y1) / 2 + 0.1, 0], { tint: DARK_OAK, bevel: 0.006 }),
			// The sill's board, a stone, a little proud.
			box([0.7, 0.035, 0.134], [0, y0 - 0.02, 0], { tint: STONE, bevel: 0.008 })
		]
	};
}

/** What stands between two floors under a window: the plaster to the sill and its stone. */
function windowSill(): Piece {
	return {
		id: 'plaster-sill',
		role: 'window.sill',
		parts: [
			box([1, 0.84, 0.12], [0, 0.42, 0]),
			box([0.7, 0.035, 0.134], [0, 0.86, 0], { tint: STONE })
		]
	};
}

// ---------------------------------------------------------------- rails and steps

/** A split-rail fence: posts at the ends and two rails, the top one worn on its edge. */
function rail(): Piece {
	return {
		id: 'oak-rail',
		role: 'railing',
		parts: [
			...[-0.45, 0.45].map((x) =>
				box([0.08, 0.98, 0.08], [x, 0.49, 0], { tint: OAK_TINT, bevel: 0.012 })
			),
			box([1, 0.07, 0.05], [0, 0.9, 0], { tint: OAK_TINT, bevel: 0.012 }),
			box([1, 0.06, 0.05], [0, 0.56, 0], { tint: OAK_TINT, bevel: 0.012 }),
			...[-0.15, 0.15].map((x) =>
				box([0.04, 0.34, 0.04], [x, 0.73, 0], { tint: OAK_TINT, bevel: 0.008 })
			)
		]
	};
}

/** A step: a slab with a worn nosing, its tread level with the higher floor. */
function step(): Piece {
	const rand = rng(41);
	return {
		id: 'flag-step',
		role: 'stair.riser',
		parts: [
			box([1, 0.4, 0.3], [0, -0.2, -0.16], { tint: STONE, bevel: 0.02 }),
			box([0.98, 0.07, 0.4], [0, -0.035, -0.135 + rand() * 0.004], { tint: STONE, bevel: 0.02 })
		]
	};
}

/** The cheek of a stair: a stone wall following the steps down. */
function cheek(): Piece {
	return {
		id: 'stair-cheek',
		role: 'stair.side',
		parts: [
			box([1, 2, 0.3], [0, -1, -0.17], { tint: STONE, bevel: 0.02 }),
			box([1, 0.07, 0.4], [0, -0.035, -0.135], { tint: STONE, bevel: 0.02 })
		]
	};
}

const THATCH_ROOF: RoofStyle = {
	name: 'thatch-',
	pitch: 45,
	roof: STRAW,
	ridge: 'roll',
	stone: STONE,
	dressed: STONE,
	timber: DARK_OAK,
	gothic: false
};

export function villageTrim(): Trim {
	return {
		kit: 'village',
		pieces: [
			wallPlain(),
			wallFramed('timber-wall-a', 0.7, 'one'),
			wallFramed('timber-wall-b', 0.4, 'cross'),
			wallOuter(),
			retaining(),
			cliff('earth-cliff', 'cliff.face', 741, [0.62, 0.55, 0.45]),
			cliff('earth-corner', 'cliff.corner', 751, [0.62, 0.55, 0.45]),
			post(),
			plate('oak-plate', false),
			plate('oak-plate-feet', true, 0.4),
			plinth(),
			doorFrame(),
			plankDoor(),
			windowFrame(),
			windowSill(),
			rail(),
			step(),
			cheek(),
			...roofPieces(THATCH_ROOF)
		],
		external: {}
	};
}
