// The wind an environment blows (#300): pure, shared by the pipeline, the manifest's parser and
// the renderer (materials/wind.ts sets its uniforms from `windParams`). One wind a table, the
// same for every viewer: nothing here depends on what a viewer was sent.

/** An environment's wind, as its JSON gives it. */
export interface WindDef {
	/** Where it blows toward, in degrees clockwise from the grid's -y (north, as a sky's path). */
	direction: number;
	/** How hard it leans what sways, 0 (still) to 1. */
	strength: number;
	/** How much gust fronts add, 0 (steady) to 1. */
	gust: number;
}

/** `raw` as a wind (direction 0-360, strength and gust 0-1), or null if it isn't one. */
export function readWind(raw: unknown): WindDef | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const { direction, strength, gust } = raw as Record<string, unknown>;
	const within = (v: unknown, max: number): v is number =>
		typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
	if (!within(direction, 360) || !within(strength, 1) || !within(gust, 1)) return null;
	return { direction, strength, gust };
}

/** The wind field's uniform values: the way it blows on the ground (x, z), unit length. */
export interface WindParams {
	direction: [number, number];
	strength: number;
	gust: number;
}

/**
 * The wind's uniforms for an environment (undefined or windless: still air), scaled by the weather
 * (`weatherFactor`, 1 until #75's weather sets it, at most 2), and still (strength 0) under reduced
 * motion or power saver, whatever the environment says.
 */
export function windParams(
	environment: { wind?: WindDef } | null | undefined,
	weatherFactor: number,
	reducedMotion: boolean,
	powerSaver: boolean
): WindParams {
	const wind = environment?.wind;
	const angle = ((wind?.direction ?? 0) * Math.PI) / 180;
	const direction: [number, number] = [Math.sin(angle) || 0, -Math.cos(angle) || 0];
	const factor = Number.isFinite(weatherFactor) ? Math.min(Math.max(weatherFactor, 0), 2) : 1;
	if (!wind || reducedMotion || powerSaver) return { direction, strength: 0, gust: 0 };
	return {
		direction,
		strength: Math.min(wind.strength * factor, 1),
		gust: Math.min(wind.gust * factor, 1)
	};
}
