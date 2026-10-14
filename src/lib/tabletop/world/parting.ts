// Parting the grass (milestone 74, #303): which footprints (a mini's base, a resting die) the grass
// graph bends round. Pure and renderer-free (no three.js): the layers fill `Footprint`s from what
// they draw, so only what the viewer was sent can dent the grass.

/** Most footprints the grass graph loops over (a uniform array of that many vec4). */
export const MAX_PARTING = 32;

/** Where something stands on the grass, in world units. */
export interface Footprint {
	id: string;
	x: number;
	z: number;
	/** Radius of the base (or die) on the ground. */
	radius: number;
	/** 1 parts the grass fully; 0 not at all (a mini lifted a level or more above its floor). */
	weight: number;
}

/**
 * A footprint's weight for a figure lifted `lift` above its floor (#202), where `level` is one
 * level's height: 1 on the ground, fading to 0 as the lift reaches one level.
 */
export function liftWeight(lift: number, level: number): number {
	return level > 0 ? Math.min(Math.max(1 - lift / level, 0), 1) : 1;
}

/** Fills a reusable record. */
export function setFootprint(
	to: Footprint,
	id: string,
	x: number,
	z: number,
	radius: number,
	weight: number
): Footprint {
	to.id = id;
	to.x = x;
	to.z = z;
	to.radius = radius;
	to.weight = weight;
	return to;
}

/** Grows `out` to hold index `n` and returns its record (so callers fill without allocating per frame). */
export function slotAt(out: Footprint[], n: number): Footprint {
	while (out.length <= n) out.push({ id: '', x: 0, z: 0, radius: 0, weight: 0 });
	return out[n];
}

// Selection scratch, module-level so a call allocates nothing once warm.
let keptDistance = new Float64Array(MAX_PARTING);
const keptId: string[] = [];
let keptAt = new Int32Array(MAX_PARTING);

export interface Parting {
	/** `count` vec4s: x, z, radius, weight. Longer than `count * 4` when reused. */
	data: Float32Array;
	count: number;
}

/**
 * The `max` footprints nearest `target` (the camera's focus; the squared distance to a centre), ties
 * broken by id, as packed vec4s (x, z, radius, weight). A weightless footprint (lifted a level or
 * more) is left out. The nearest come first. `into`, when given and big enough (`max * 4`), is
 * written and returned instead of a new array; `count` says how many of `footprints` are live
 * (the layers' pooled arrays are longer).
 */
export function partingSet(
	footprints: readonly Footprint[],
	target: { x: number; z: number },
	max = MAX_PARTING,
	into?: Parting,
	count = footprints.length
): Parting {
	if (keptDistance.length < max) {
		keptDistance = new Float64Array(max);
		keptAt = new Int32Array(max);
	}
	keptId.length = max;
	let n = 0;
	for (let i = 0; i < count; i++) {
		const f = footprints[i];
		if (!(f.weight > 0)) continue;
		const d = (f.x - target.x) ** 2 + (f.z - target.z) ** 2;
		// Where it ranks among those kept: after everything nearer, or equally near with a smaller id.
		let k = n;
		while (
			k > 0 &&
			(keptDistance[k - 1] > d || (keptDistance[k - 1] === d && keptId[k - 1] > f.id))
		)
			k--;
		if (k >= max) continue;
		const last = Math.min(n, max - 1);
		for (let m = last; m > k; m--) {
			keptDistance[m] = keptDistance[m - 1];
			keptId[m] = keptId[m - 1];
			keptAt[m] = keptAt[m - 1];
		}
		keptDistance[k] = d;
		keptId[k] = f.id;
		keptAt[k] = i;
		if (n < max) n++;
	}
	const out =
		into && into.data.length >= max * 4 ? into : { data: new Float32Array(max * 4), count: 0 };
	for (let k = 0; k < n; k++) {
		const f = footprints[keptAt[k]];
		const o = k * 4;
		out.data[o] = f.x;
		out.data[o + 1] = f.z;
		out.data[o + 2] = f.radius;
		out.data[o + 3] = f.weight;
	}
	out.data.fill(0, n * 4, max * 4);
	out.count = n;
	return out;
}
