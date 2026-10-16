// The roofs' pieces (roof.ridge, roof.hip, roof.chimney, roof.dormer), for a kit's roof: caps
// and chimneys and dormers that sit on the procedural slopes (src/lib/tabletop/world/roof-mesh.ts).
// Their frames: a cap's and a chimney's pivot is the ridge of a one-cell roof, `apex` up, the cap
// drawn at half size across the ridge and up; a dormer's is its wall's eave line (0, 2, 0.5), its
// front toward +z. They wear the roof's own surface (thatch, slate) tinted by vertex colours.

import { box, cyl, extrude, rng, sweep, type Part, type V3 } from './geom';
import type { Piece } from './piece';
import { masonry } from './work';

export interface RoofStyle {
	/** `thatch-` or `slate-`: ids describe looks. */
	name: string;
	pitch: number;
	/** The roof's own colour as the caps and dormer's roof are tinted. */
	roof: V3;
	/** The ridge's cap: a straw roll or a row of stone cresting. */
	ridge: 'roll' | 'stones';
	/** The walls of the chimney and the dormer's face, and their dressing. */
	stone: V3;
	dressed: V3;
	/** The window's frame and a dormer's cheeks. */
	timber: V3;
	/** Pointed or square-headed dormer window. */
	gothic: boolean;
}

const CLAY: V3 = [0.78, 0.45, 0.3];
const apexOf = (pitch: number) => 2 + 0.5 * Math.tan((pitch * Math.PI) / 180);

/** A thatched roll or a crest of stones along the ridge, a cell long. */
function ridge(s: RoofStyle): Piece {
	const apex = apexOf(s.pitch);
	const t = Math.tan((s.pitch * Math.PI) / 180);
	const parts: Part[] = [];
	if (s.ridge === 'roll') {
		// A roll that thickens to the crown, a thin band down each slope.
		const half = 0.8;
		const top: [number, number][] = [];
		for (let i = 0; i <= 10; i++) {
			const z = -half + (2 * half * i) / 10;
			const k = 1 - Math.abs(z) / half;
			top.push([z, apex - Math.abs(z) * t + 0.03 + 0.2 * k ** 1.4]);
		}
		const under = top
			.map(([z]) => [z, apex - Math.abs(z) * t - 0.03] as [number, number])
			.reverse();
		parts.push(sweep([...under, ...top], -0.5, 0.5, { tint: s.roof, solids: false }));
		// Spars across the roll, a hand apart.
		for (const x of [-0.375, -0.125, 0.125, 0.375])
			for (const side of [-1, 1])
				parts.push(
					box([0.025, 0.02, 0.5], [x, apex + 0.12 - 0.5 * 0.5 * t, side * 0.3], {
						tint: [s.roof[0] * 0.7, s.roof[1] * 0.7, s.roof[2] * 0.7],
						turn: [-side * Math.atan(t) * 1.0, 0, 0],
						solids: false
					})
				);
	} else {
		// Cresting: a stone to each fifth of the cell, a gable in section, a joint apart.
		const half = 0.26;
		const profile: [number, number][] = [
			[-half, apex - half * t - 0.03],
			[half, apex - half * t - 0.03],
			[half - 0.02, apex - half * t + 0.07],
			[0.07, apex + 0.17],
			[-0.07, apex + 0.17],
			[-half + 0.02, apex - half * t + 0.07]
		];
		for (let k = 0; k < 5; k++)
			parts.push(
				sweep(profile, -0.5 + k * 0.2 + 0.006, -0.5 + (k + 1) * 0.2 - 0.006, {
					tint: s.dressed,
					tone: 0.95 + 0.05 * (k % 2),
					solids: false
				})
			);
	}
	return { id: `${s.name}ridge`, role: 'roof.ridge', parts };
}

/** A hip's crown: a stepped stub of the roll or of cresting, round or square. */
function hip(s: RoofStyle): Piece {
	const apex = apexOf(s.pitch);
	const parts: Part[] =
		s.ridge === 'roll'
			? [cyl(0.2, 0.3, [0, apex + 0.06, 0], { tint: s.roof, seg: 10, top: 0.08, solids: false })]
			: [0.34, 0.26, 0.18, 0.1].map((w, i) =>
					box([w, 0.06, w], [0, apex - 0.02 + i * 0.055, 0], {
						tint: s.dressed,
						bevel: 0.01,
						solids: false
					})
				);
	return { id: `${s.name}hip`, role: 'roof.hip', parts };
}

/** A stack of courses with a corbelled head, a drip slab and two clay pots; its foot sunk into the roof. */
function chimney(s: RoofStyle): Piece {
	const apex = apexOf(s.pitch);
	const rand = rng(51);
	const base = apex - 0.9;
	const parts = masonryStack(0.2, 0, 0.34, base, base + 1.62, 0.18, s.stone, 51);
	const topY = base + 1.62;
	// The corbels step out, the slab caps them.
	parts.push(box([0.4, 0.05, 0.4], [0.2, topY + 0.025, 0], { tint: s.dressed, bevel: 0.01 }));
	parts.push(box([0.46, 0.05, 0.46], [0.2, topY + 0.075, 0], { tint: s.dressed, bevel: 0.01 }));
	for (const [x, h, r] of [
		[0.1, 0.22, 0.062],
		[0.3, 0.17, 0.058]
	] as const) {
		parts.push(
			cyl(r, h, [x, topY + 0.1 + h / 2, rand() * 0.04 - 0.02], {
				tint: CLAY,
				seg: 8,
				top: r * 0.88
			})
		);
		parts.push(cyl(r * 1.15, 0.03, [x, topY + 0.1 + h, 0], { tint: CLAY, seg: 8 }));
	}
	return {
		id: `${s.name}chimney`,
		role: 'roof.chimney',
		sockets: [{ kind: 'smoke', at: [0.2, topY + 0.4, 0] }],
		parts
	};
}

/** A square stack of ashlar courses, each a block square, a joint apart (four faces, so no gaps show). */
function masonryStack(
	cx: number,
	cz: number,
	side: number,
	y0: number,
	y1: number,
	course: number,
	tint: V3,
	seed: number
): Part[] {
	const rand = rng(seed);
	const rows = Math.round((y1 - y0) / course);
	const h = (y1 - y0) / rows;
	const out: Part[] = [];
	for (let i = 0; i < rows; i++) {
		const w = side - (i > rows * 0.62 ? 0.01 * (i - rows * 0.62) : 0) + (rand() - 0.5) * 0.01;
		const k = 0.9 + rand() * 0.1;
		out.push(
			box([w, h - 0.012, w], [cx, y0 + h * (i + 0.5), cz], {
				bevel: 0.012,
				tint: [tint[0] * k, tint[1] * k, tint[2] * k]
			})
		);
	}
	void masonry;
	return out;
}

/** A gabled dormer: a face with a window, cheeks, a pitched roof of the roof's own surface. */
function dormer(s: RoofStyle): Piece {
	const parts: Part[] = [];
	const [x1, y0, yWall] = [0.27, 2.0, 2.5];
	const z = 0.43;
	const wall = s.stone;
	parts.push(
		box([x1 * 2, yWall - y0, 0.06], [0, (y0 + yWall) / 2, z - 0.03], { tint: wall, bevel: 0.01 })
	);
	// The opening's frame and its dark glass.
	if (s.gothic) {
		parts.push(
			box([0.2, 0.2, 0.07], [0, 2.2, z - 0.028], { tint: [0.03, 0.03, 0.04], bevel: 0.004 })
		);
		parts.push(
			extrude(
				[
					[-0.1, 2.3],
					[0.1, 2.3],
					[0.1, 2.34],
					[0, 2.44],
					[-0.1, 2.34]
				],
				z - 0.064,
				z + 0.004,
				{ tint: [0.03, 0.03, 0.04] }
			)
		);
		parts.push(box([0.26, 0.04, 0.09], [0, 2.095, z - 0.02], { tint: s.dressed, bevel: 0.008 }));
		for (const sx of [-1, 1])
			parts.push(
				box([0.04, 0.34, 0.09], [sx * 0.12, 2.27, z - 0.02], { tint: s.dressed, bevel: 0.008 })
			);
	} else {
		parts.push(box([0.3, 0.3, 0.07], [0, 2.26, z - 0.028], { tint: s.timber, bevel: 0.01 }));
		parts.push(box([0.2, 0.2, 0.075], [0, 2.26, z - 0.024], { tint: [0.03, 0.03, 0.04] }));
		parts.push(box([0.024, 0.3, 0.075], [0, 2.26, z - 0.024], { tint: s.timber }));
		parts.push(box([0.4, 0.05, 0.1], [0, 2.1, z - 0.02], { tint: s.dressed, bevel: 0.01 }));
	}
	// The cheeks, the roof's two slopes and its crown.
	const roll = Math.atan(0.9);
	for (const sx of [-1, 1]) {
		parts.push(
			box([0.05, yWall - y0, 0.5], [sx * (x1 - 0.025), (y0 + yWall) / 2, z - 0.28], {
				tint: wall,
				bevel: 0.008
			})
		);
		parts.push(
			box([0.4, 0.07, 0.62], [sx * 0.18, yWall + 0.1, z - 0.22], {
				tint: s.roof,
				turn: [0, 0, -sx * roll],
				bevel: 0.01
			})
		);
	}
	parts.push(
		extrude(
			[
				[-x1, yWall],
				[x1, yWall],
				[0, yWall + 0.27]
			],
			z - 0.06,
			z,
			{ tint: wall }
		)
	);
	parts.push(
		box([0.07, 0.07, 0.64], [0, yWall + 0.26, z - 0.22], { tint: s.dressed, bevel: 0.01 })
	);
	return { id: `${s.name}dormer`, role: 'roof.dormer', parts };
}

/** The four pieces a kit with a roof draws on it. */
export function roofPieces(s: RoofStyle): Piece[] {
	return [ridge(s), hip(s), chimney(s), dormer(s)];
}
