// Lava (#297), in the lazy `water-layer` chunk with the water kind's graph: the water kind's
// `lava` variant, registered over the water's own graphs (`lazyGraphs.water`) when the chunk loads.
// Floors' lava (the water layer's lava meshes, with a bank) and the molten chasm's floor
// (`WorldLayer.molten`, no bank) share the graph; `params.opacity` tells them apart.

import * as T from 'three/tsl';
import { hash2d } from 'three/addons/tsl/math/voronoiNoise.js';
import { cellUniforms } from '../cell-maps';
import { SHORE_MAX } from '../world/shore-scale';
import { lazyGraphs, worldTime, type Graph, type Variant } from './kinds';
import { tsl, type N } from './tsl';
import { shoreAt, twoPhase } from './water';
import { worldEmissive, worldModify } from './world-modify';

const loose = (node: unknown) => node as N;

/** A crust plate is about this many cells across. */
const LAVA_CELLS = 1.4;
/** The crust, the molten glow and its hottest core. */
const LAVA = { crust: '#1c0a06', molten: '#ff5a1f', core: '#ffb04a' } as const;
/**
 * The glow's strengths (HDR, so bloom takes the seams and the rim, never the crust): a seam's core,
 * the faint warmth either side of it, the rim along a bank, and the molten chasm's whole floor.
 */
const GLOW = { seam: 4, halo: 0.12, rim: 1.6, pool: { seam: 2.2, halo: 0.3, base: 0.05 } } as const;
/** A seam's half width in plates' units, on a floor's lava and under the molten chasm. */
const SEAM = { bank: 0.05, pool: 0.11 } as const;
/**
 * The bank's band, in cells from it (the shore field): crusted to `lip`, molten to `rim`, the
 * plates beyond; `wander` cells of noise curve the bands, so a lone cell's glow is no square.
 */
const BANK = { lip: [0.04, 0.12], rim: [0.1, 0.24], wander: 0.08 } as const;
/** The plates' slow churn, radians a second: whole turns an hour. */
const MORPH = (2 * Math.PI * 360) / 3600;
const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;
const hash = hash2d as unknown as (p: N) => N;

/**
 * Edge voronoi: the second nearest of the plates' points less the nearest (`voronoi2d`'s points,
 * orbiting their cells on `time`), 0 on a seam between two plates.
 */
const cracks = (T.Fn as unknown as (f: (a: N[]) => N, layout: object) => (p: N, time: N) => N)(
	([p, time]) => {
		const n = p.floor().toConst();
		const f = p.fract().toConst();
		const f1 = t.float(8).toVar();
		const f2 = t.float(8).toVar();
		const loop = (name: string, body: (i: { x: N; y: N }) => void) =>
			t.Loop({ start: t.int(-1), end: t.int(1), name, condition: '<=' }, body);
		loop('x', ({ x }) =>
			loop('y', ({ y }) => {
				const g = t.vec2(t.float(x), t.float(y)).toConst();
				const o = hash(n.add(g)).toConst();
				const r = g.sub(f).add(
					t
						.sin(time.add(o.mul(2 * Math.PI)))
						.mul(0.5)
						.add(0.5)
				);
				const d = r.dot(r).toConst();
				t.If(d.lessThan(f1), () => {
					f2.assign(f1);
					f1.assign(d);
				}).ElseIf(d.lessThan(f2), () => {
					f2.assign(d);
				});
			})
		);
		return f2.sqrt().sub(f1.sqrt());
	},
	{ p: 'vec2', time: 'float', return: 'float' }
);

/** How far from the fragment `rounded` reads the shore field, in cells. */
const ROUND = 0.2;

/**
 * The shore field averaged over four reads `ROUND` cells away on the diagonals: inside a cell its
 * distance's lines are squares, and the average rounds their corners, so the bank's bands curve.
 */
function rounded(): N {
	const at = shoreAt;
	return at(ROUND, ROUND)
		.add(at(-ROUND, ROUND))
		.add(at(ROUND, -ROUND))
		.add(at(-ROUND, -ROUND))
		.mul(0.25);
}

/**
 * Lava: dark crust plates (edge voronoi on world x-z, carried down the flow in two phases) cracked
 * by thin molten seams glowing at `GLOW.seam` with a faint warmth either side, and a finer, dimmer
 * set of cracks on medium and up. Along a bank (the shore field) a crusted lip, then a molten rim,
 * both wandering by noise. `params.opacity` is how much bank there is: 1 on a floor's lava, 0 under
 * the molten chasm, which has no bank and is molten all over: wide seams, the warmth wider, a glow
 * of its own. Only seams and rim glow; the crust is dark and rough. Opaque (`deep`), lit;
 * `worldEmissive` dims the glow by the fog, as every emissive.
 */
function lavaGraph(variant: Variant): Graph {
	const cs = loose(cellUniforms.cellSize);
	const at = tsl.positionWorld.xz.div(cs);
	const p = at.div(LAVA_CELLS);
	const morph = loose(worldTime).mul(MORPH);
	const bank = tsl.materialReference('params.opacity', 'float');
	const pool = bank.oneMinus();
	const width = tsl.mix(SEAM.bank, SEAM.pool, pool);
	const glows = twoPhase((o) => {
		const e = cracks(p.sub(o), morph);
		let seam = tsl.smoothstep(0, width, e).oneMinus();
		if (variant.antiTiled) {
			const fine = cracks(p.sub(o).mul(2.3), morph.mul(1.3));
			seam = tsl.max(seam, tsl.smoothstep(0, width.mul(0.6), fine).oneMinus().mul(0.45));
		}
		return tsl.vec2(seam, tsl.smoothstep(0, width.mul(tsl.mix(3, 2.5, pool)), e).oneMinus());
	});
	// The bank: crust at its edge, molten along it, the plates beyond (none under the chasm).
	const wander = tsl.mx_noise_float(at.mul(3.1)).mul(BANK.wander);
	const d = rounded().mul(SHORE_MAX).add(wander);
	const lip = tsl.mix(1, tsl.smoothstep(BANK.lip[0], BANK.lip[1], d), bank);
	// The rim runs hotter and cooler along the bank, so it is no even ring.
	const along = tsl
		.smoothstep(-0.5, 0.6, tsl.mx_noise_float(at.mul(2.3).add(7.3)))
		.mul(0.65)
		.add(0.35);
	const band = tsl.smoothstep(BANK.rim[0], BANK.rim[1], d).oneMinus();
	const rim = band.mul(lip).mul(bank).mul(along);
	const seam = glows.x.mul(lip);
	const heat = tsl.max(seam, rim);
	const hot = tsl.mix(loose(T.color(LAVA.molten)), loose(T.color(LAVA.core)), heat.mul(heat));
	const strength = seam
		.mul(tsl.mix(GLOW.seam, GLOW.pool.seam, pool))
		.add(rim.mul(GLOW.rim))
		.add(glows.y.mul(lip).mul(tsl.mix(GLOW.halo, GLOW.pool.halo, pool)))
		.add(pool.mul(GLOW.pool.base));
	const emissive = worldEmissive(hot.mul(strength));
	const plates = tsl.mx_noise_float(at.mul(0.9)).mul(0.25).add(0.85);
	const albedo = tsl.mix(loose(T.color(LAVA.crust)).mul(plates), hot.mul(0.35), heat);
	return {
		colorNode: tsl.vec4(albedo, 1),
		opacityNode: null,
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, emissive, true),
		lit: {
			roughnessNode: tsl.mix(0.92, 0.45, heat),
			metalnessNode: loose(T.float(0)),
			aoNode: loose(T.float(1)),
			normalNode: tsl.vec3(0, 1, 0).transformDirection(tsl.cameraViewMatrix).normalize(),
			emissiveNode: emissive,
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}

const waterOf = lazyGraphs.water!;
lazyGraphs.water = (variant: Variant): Graph =>
	variant.lava ? lavaGraph(variant) : waterOf(variant);
