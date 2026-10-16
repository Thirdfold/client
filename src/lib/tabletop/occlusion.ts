// Dithering occluders (#283): props, foliage, raised ground, cliffs and roofs between the camera and
// the viewer's minis dissolve in a capsule round the line from the camera to each mini's chest, so
// the minis stay in sight. Pure (no three.js): materials/occlusion-node.ts is the same rule in the
// kinds' fragment shaders, from these constants; picking passes clicks through where it holds
// (`occlusionAt` >= `PICK_THROUGH`); the token layer picks the minis (`occluderOrder`).
// docs/RENDERING.md, "Occluder dither (#283)".

/** The rule's sizes, in cells: starting values the art review tunes. */
export const OCCLUSION = {
	/** Minis with a hole at once; unused slots are parked. */
	slots: 4,
	/** The capsule's radius, and where its edge starts softening (a fraction of the radius). */
	radius: 0.6,
	inner: 0.6,
	/** How far before the mini along the line the fade has fully come in: the mini never fades itself. */
	margin: 0.35,
	/** An up-facing surface no higher than this above a mini's floor is its ground: never faded. */
	floorEps: 0.05,
	/** What faces up: the normal's y at least this. */
	up: 0.7,
	/** The mini's chest above its floor, where the line ends. */
	chest: 0.8
} as const;

/** A slot's floor when it is parked: no fade at all. */
export const PARKED = 1e6;

/** A click passes through where the fade is at least this (#291). */
export const PICK_THROUGH = 0.5;

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** A mini with a hole: its chest point (world), and its floor's world height. */
export interface Occluder extends Vec3 {
	floor: number;
}

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * How far a surface at `p` (its normal's y `normalY`) fades for one mini, 0 (drawn) to 1 (gone),
 * with the camera at `cam`: inside the capsule round the camera-to-chest segment and before the mini
 * along it, unless it is the mini's ground. `noise` (world units) breaks the edge up; the shader's is
 * world-space noise, picking's none. Null, or a parked slot, never fades anything.
 */
export function capsuleFade(
	p: Vec3,
	normalY: number,
	cam: Vec3,
	o: Occluder | null,
	cellSize: number,
	noise = 0
): number {
	if (!o || o.floor >= PARKED / 2) return 0;
	if (normalY > OCCLUSION.up && p.y <= o.floor + OCCLUSION.floorEps * cellSize) return 0;
	const [sx, sy, sz] = [o.x - cam.x, o.y - cam.y, o.z - cam.z];
	const len2 = Math.max(sx * sx + sy * sy + sz * sz, 1e-12);
	const t = Math.min(
		1,
		Math.max(0, ((p.x - cam.x) * sx + (p.y - cam.y) * sy + (p.z - cam.z) * sz) / len2)
	);
	const d = Math.hypot(p.x - cam.x - sx * t, p.y - cam.y - sy * t, p.z - cam.z - sz * t);
	const r = OCCLUSION.radius * cellSize;
	const inside = 1 - smoothstep(r * OCCLUSION.inner, r, d + noise);
	const before = smoothstep(0, OCCLUSION.margin * cellSize, (1 - t) * Math.sqrt(len2));
	return inside * before;
}

/** The fade at `p` over every slot: the most any of them takes. */
export function occlusionAt(
	p: Vec3,
	normalY: number,
	cam: Vec3,
	occluders: readonly (Occluder | null)[],
	cellSize: number
): number {
	let fade = 0;
	for (const o of occluders) fade = Math.max(fade, capsuleFade(p, normalY, cam, o, cellSize));
	return fade;
}

/** A mini the viewer was sent, where it is drawn on the ground (x, z). */
export interface Candidate {
	id: string;
	x: number;
	z: number;
}

/**
 * Which minis get a hole, at most `OCCLUSION.slots`: the selected one, then the viewer's own (the
 * cut's kept tokens: a player's own and selected) nearest the camera's pivot, then whose turn it
 * is. So a player gets theirs, the GM the selection and the turn, a spectator the turn. Only
 * `candidates` (what the viewer was sent, and not hidden by the cut) are ever chosen.
 */
export function occluderOrder(
	candidates: readonly Candidate[],
	selected: string | null,
	own: ReadonlySet<string>,
	active: string | null,
	pivot: { x: number; z: number }
): string[] {
	const by = new Map(candidates.map((c) => [c.id, c]));
	const near = (c: Candidate) => (c.x - pivot.x) ** 2 + (c.z - pivot.z) ** 2;
	const mine = candidates.filter((c) => own.has(c.id)).sort((a, b) => near(a) - near(b));
	const out: string[] = [];
	for (const id of [selected, ...mine.map((c) => c.id), active])
		if (id && by.has(id) && !out.includes(id)) out.push(id);
	return out.slice(0, OCCLUSION.slots);
}
