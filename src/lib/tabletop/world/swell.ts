// The sea's swell (milestone 73, #296): a few Gerstner waves that lift and shift the sea ring's
// vertices, 0 on the grid's border so the ring joins the edge water flat. This is the one place
// the wave constants live; the water kind's `deep` graph builds its `positionNode` from `WAVES`
// and `swellStrength`, and `swellAt` is the same maths in Node, so the specs hold it to its bounds.
// Pure and renderer-free (no three.js); docs/RENDERING.md, "Sea surround".
//
// Everything is in cells (the waves' lengths, the ramp), so a table's cell size scales the swell
// with it, and the vertical amplitudes are in levels (one level is `STEP_HEIGHT` cells).

import { STEP_HEIGHT } from '../ground';

/** One Gerstner wave: a direction in the x-z plane (radians from +x toward +z) and its shape. */
export interface Wave {
	angle: number;
	/** Crest to crest, in cells: 6 to 20. */
	wavelength: number;
	/** How much it pulls the surface along its direction (0 round, at most 0.25). */
	steepness: number;
	/** Height of a crest, in levels: at most `MAX_AMPLITUDE`. */
	amplitude: number;
	/** Where in its cycle it starts, radians. */
	phase: number;
}

/** The longest and steepest the waves go (the issue's bounds; a spec holds `WAVES` to them). */
export const MAX_AMPLITUDE = 0.15;
export const MAX_STEEPNESS = 0.25;
export const MIN_WAVELENGTH = 6;
export const MAX_WAVELENGTH = 20;
/** Deep water's speed, in cells per second squared (omega = sqrt(g k)): a slow, heavy sea. */
export const SWELL_GRAVITY = 1.2;
/** Cells beyond the grid's border over which the swell grows from 0 to its full height. */
export const SWELL_RAMP_CELLS = 8;

/** Every tier's waves are a prefix of these four, longest first, so a tier adds detail only. */
export const WAVES: readonly Wave[] = [
	{ angle: 0.3, wavelength: 18, steepness: 0.25, amplitude: 0.15, phase: 0 },
	{ angle: 1.1, wavelength: 11, steepness: 0.2, amplitude: 0.09, phase: 1.7 },
	{ angle: -0.6, wavelength: 7, steepness: 0.2, amplitude: 0.05, phase: 3.1 },
	{ angle: 2, wavelength: 14, steepness: 0.15, amplitude: 0.07, phase: 4.6 }
];

/** How many waves a tier runs: 2 on low, 3 on medium, 4 on high and ultra. */
export const WAVE_COUNT = { low: 2, medium: 3, high: 4 } as const;
export type SeaTier = keyof typeof WAVE_COUNT;

/** What a swell is measured against: the grid's rectangle and where the haze takes the sea. */
export interface Swell {
	waves: readonly Wave[];
	/** The grid's half sizes and a cell, in world units (`Span`). */
	halfX: number;
	halfZ: number;
	cellSize: number;
	/** The swell flattens between these distances from the grid's centre (the haze's range). */
	fadeNear: number;
	fadeFar: number;
}

export const swellOf = (
	tier: SeaTier,
	span: Pick<Swell, 'halfX' | 'halfZ' | 'cellSize'> & { fogNear: number; fogFar: number }
): Swell => ({
	waves: WAVES.slice(0, WAVE_COUNT[tier]),
	halfX: span.halfX,
	halfZ: span.halfZ,
	cellSize: span.cellSize,
	fadeNear: span.fogNear,
	fadeFar: span.fogFar
});

const smooth = (a: number, b: number, x: number) => {
	const f = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return f * f * (3 - 2 * f);
};

/**
 * 0 inside the grid's rectangle and on its border, 1 from `SWELL_RAMP_CELLS` beyond it, and 0
 * again from the haze's far edge: what the shader multiplies the waves by.
 */
export function swellStrength(s: Swell, x: number, z: number): number {
	const out = Math.hypot(Math.max(Math.abs(x) - s.halfX, 0), Math.max(Math.abs(z) - s.halfZ, 0));
	const ramp = smooth(0, SWELL_RAMP_CELLS * s.cellSize, out);
	return ramp * (1 - smooth(s.fadeNear, s.fadeFar, Math.hypot(x, z)));
}

/**
 * The swell's displacement of a point of the sea at (x, z) world units and `t` seconds: y the
 * lift, x and z the pull toward each crest. Zero on the border at any `t` and bounded by the
 * waves' amplitudes everywhere.
 */
export function swellAt(
	s: Swell,
	x: number,
	z: number,
	t: number
): { x: number; y: number; z: number } {
	const strength = swellStrength(s, x, z);
	const out = { x: 0, y: 0, z: 0 };
	if (strength === 0) return out;
	const rise = STEP_HEIGHT * s.cellSize; // a level, in world units
	for (const w of s.waves) {
		const [dx, dz] = [Math.cos(w.angle), Math.sin(w.angle)];
		const k = (2 * Math.PI) / w.wavelength;
		const theta = k * ((dx * x + dz * z) / s.cellSize) - Math.sqrt(SWELL_GRAVITY * k) * t + w.phase;
		const a = w.amplitude * rise * strength;
		out.y += a * Math.sin(theta);
		out.x += w.steepness * a * Math.cos(theta) * dx;
		out.z += w.steepness * a * Math.cos(theta) * dz;
	}
	return out;
}
