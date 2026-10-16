// The stone halls' trim (the monastery): dressed stone and slate over the pilot's ashlar walls
// (scripts/make-stone-halls-art.ts), tinted over the environment's wall surface: mouldings on the
// coping and the footing, piers with bases and capitals, a turned balustrade, a lintelled doorway,
// worn treads, and the slate roof's cresting, stack and dormer. The door leaves are a CC0 model.

import type { Trim } from './all';
import { box, sweep, turned, type Part, type V3 } from './geom';
import type { Piece } from './piece';
import { roofPieces, type RoofStyle } from './roofs';
import { core, masonry } from './work';

/** The pilot's pieces (scripts/make-stone-halls-art.ts) this trim stands in for: no longer made. */
export const PILOT_REPLACED = [
	'ashlar-coping',
	'ashlar-plinth',
	'ashlar-post-end',
	'ashlar-post-l',
	'ashlar-post-t',
	'ashlar-post-x',
	'stone-balustrade',
	'ashlar-door-frame',
	'ashlar-step',
	'oak-door'
];

const STONE: V3 = [0.9, 0.88, 0.84];
const DRESSED: V3 = [0.98, 0.96, 0.92];
const SLATE: V3 = [0.46, 0.47, 0.5];
const DARK_OAK: V3 = [0.3, 0.2, 0.12];

/** The wall's coping: moulded stones with a drip, three to the cell, a joint apart. */
function coping(): Piece {
	const profile: [number, number][] = [
		[-0.1, 1.9],
		[0.1, 1.9],
		[0.1, 1.94],
		[0.088, 1.952],
		[0.088, 1.968],
		[0.068, 2.0],
		[-0.068, 2.0],
		[-0.088, 1.968],
		[-0.088, 1.952],
		[-0.1, 1.94]
	];
	const spans = [
		[-0.5, -0.16],
		[-0.15, 0.2],
		[0.21, 0.5]
	];
	return {
		id: 'moulded-coping',
		role: 'cap',
		parts: spans.map(([a, b], i) =>
			sweep(profile, a, b, { tint: DRESSED, tone: 1 - 0.04 * (i % 2) })
		)
	};
}

/** A footing: a weathered plinth course, the top chamfered back to the wall. */
function plinth(): Piece {
	const profile: [number, number][] = [
		[-0.066, 0],
		[0.066, 0],
		[0.066, 0.3],
		[0.05, 0.4],
		[-0.05, 0.4],
		[-0.066, 0.3]
	];
	return {
		id: 'chamfered-plinth',
		role: 'plinth',
		parts: [
			sweep(profile, -0.5, -0.04, { tint: STONE }),
			sweep(profile, -0.03, 0.5, { tint: STONE, tone: 0.94 })
		]
	};
}

/** A pier: a moulded base, a shaft with chamfered arrises, an abacus and a stepped cap. */
function pier(): Piece {
	return {
		id: 'moulded-pier',
		role: 'post.L',
		also: ['post.end', 'post.T', 'post.X'],
		parts: [
			box([0.34, 0.1, 0.34], [0, 0.05, 0], { tint: DRESSED, bevel: 0.02 }),
			box([0.3, 0.07, 0.3], [0, 0.135, 0], { tint: DRESSED, bevel: 0.015 }),
			box([0.25, 1.52, 0.25], [0, 0.93, 0], { tint: STONE, bevel: 0.035 }),
			box([0.3, 0.07, 0.3], [0, 1.725, 0], { tint: DRESSED, bevel: 0.015 }),
			box([0.34, 0.09, 0.34], [0, 1.805, 0], { tint: DRESSED, bevel: 0.02 }),
			...[0.28, 0.2, 0.12].map((w, i) =>
				box([w, 0.07, w], [0, 1.885 + i * 0.07, 0], { tint: DRESSED, bevel: 0.012 })
			)
		]
	};
}

/** A balustrade: a plinth course, turned balusters and a moulded rail, a newel at each end. */
function balustrade(): Piece {
	const baluster: [number, number][] = [
		[0, 0],
		[0.034, 0],
		[0.034, 0.03],
		[0.024, 0.05],
		[0.022, 0.09],
		[0.048, 0.2],
		[0.05, 0.27],
		[0.03, 0.4],
		[0.022, 0.46],
		[0.028, 0.52],
		[0.04, 0.58],
		[0.04, 0.6],
		[0, 0.6]
	];
	const parts: Part[] = [
		box([1, 0.1, 0.13], [0, 0.05, 0], { tint: STONE, bevel: 0.015 }),
		box([1, 0.07, 0.11], [0, 0.135, 0], { tint: DRESSED, bevel: 0.012 }),
		sweep(
			[
				[-0.07, 0.9],
				[0.07, 0.9],
				[0.07, 0.94],
				[0.055, 1.0],
				[-0.055, 1.0],
				[-0.07, 0.94]
			],
			-0.5,
			0.5,
			{ tint: DRESSED }
		)
	];
	for (const x of [-0.375, -0.125, 0.125, 0.375])
		parts.push(turned(baluster, [x, 0.17, 0], { tint: DRESSED, seg: 8 }));
	parts.push(
		box([0.045, 0.1, 0.1], [0.5 - 0.0225, 0.84, 0], { tint: DRESSED, bevel: 0.01 }),
		box([0.045, 0.1, 0.1], [-0.5 + 0.0225, 0.84, 0], { tint: DRESSED, bevel: 0.01 })
	);
	return { id: 'turned-balustrade', role: 'railing', parts };
}

/** A doorway: long-and-short jambs, a lintel with a chamfer, a worn threshold, ashlar above. */
function doorFrame(): Piece {
	const o = 0.34;
	const parts: Part[] = [
		core(-0.5, 0.5, 0, 2, -0.05, 0.05),
		...masonry({
			x0: -0.5,
			x1: -o,
			y0: 0,
			y1: 1.84,
			z0: -0.066,
			z1: 0.066,
			course: 0.32,
			len: [0.16, 0.16],
			seed: 301,
			tint: DRESSED
		}),
		...masonry({
			x0: o,
			x1: 0.5,
			y0: 0,
			y1: 1.84,
			z0: -0.066,
			z1: 0.066,
			course: 0.32,
			len: [0.16, 0.16],
			seed: 302,
			tint: DRESSED
		}),
		box([1, 0.16, 0.132], [0, 1.92, 0], { tint: DRESSED, bevel: 0.012 }),
		box([0.8, 0.045, 0.14], [0, 0.0225, 0], { tint: DRESSED, bevel: 0.01 })
	];
	return { id: 'lintel-door-frame', role: 'door.frame', parts };
}

/** A tread: a slab with a worn, rounded nosing; two stones to the cell. */
function step(): Piece {
	const profile: [number, number][] = [
		[-0.33, -0.4],
		[0.05, -0.4],
		[0.066, -0.37],
		[0.066, -0.06],
		[0.055, -0.016],
		[0.035, 0],
		[-0.33, 0]
	];
	return {
		id: 'worn-step',
		role: 'stair.riser',
		parts: [
			sweep(profile, -0.5, -0.02, { tint: STONE }),
			sweep(profile, -0.01, 0.5, { tint: STONE, tone: 0.93 })
		]
	};
}

const SLATE_ROOF: RoofStyle = {
	name: 'slate-',
	pitch: 40,
	roof: SLATE,
	ridge: 'stones',
	stone: STONE,
	dressed: DRESSED,
	timber: DARK_OAK,
	gothic: true
};

export function hallsTrim(): Trim {
	return {
		kit: 'stone-halls',
		pieces: [
			coping(),
			plinth(),
			pier(),
			balustrade(),
			doorFrame(),
			step(),
			...roofPieces(SLATE_ROOF)
		],
		external: { 'door.leaf': [{ model: 'iron-bound-door' }] }
	};
}
