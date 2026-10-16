// Geometry for the kits' trim (M76, docs/ASSETS.md "The kits' trim"): the shapes a mason or a
// carpenter makes, as indexed meshes (positions, normals) in a piece's own frame, so a piece is
// proportioned like the real thing: bevelled blocks, turned balusters, mouldings swept along an
// edge, voussoir arches, hewn beams, split rock. A carrier of the real surface laid over it, never
// painted art: colours are tints, the maps are the library's (or the model's own).

import * as THREE from 'three';
import { chamferedBox, chamferOf } from '../../../server/assets/models';

export type V3 = [number, number, number];

/** What the occlusion bake treats a part as: a box, cylinder or ball of this size at this place. */
export interface SolidSpec {
	shape: 'box' | 'cylinder' | 'sphere';
	size: V3;
	at: V3;
	turn?: V3;
}

export interface Part {
	g: THREE.BufferGeometry;
	/** Linear colour multiplier (a tinted piece), times `tone`. */
	tint: V3;
	tone: number;
	/** Solids shading its neighbours; a bounding box when absent, none when `false`. */
	solids?: SolidSpec[] | false;
}

export interface Look {
	tint?: V3;
	tone?: number;
	solids?: SolidSpec[] | false;
}

const part = (g: THREE.BufferGeometry, look: Look = {}): Part => ({
	g,
	tint: look.tint ?? [1, 1, 1],
	tone: look.tone ?? 1,
	...(look.solids !== undefined ? { solids: look.solids } : {})
});

/** A seeded generator (mulberry32), so the same run gives the same stones. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function place(g: THREE.BufferGeometry, at: V3, turn?: V3): THREE.BufferGeometry {
	g.deleteAttribute('uv');
	if (turn) {
		g.applyMatrix4(
			new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(turn[0], turn[1], turn[2], 'XYZ'))
		);
	}
	return g.translate(at[0], at[1], at[2]);
}

// ---------------------------------------------------------------- blocks

/** A bevelled box (`bevel` defaults to the part lists' 8% of its least side), turned about its centre. */
export function box(size: V3, at: V3, look: Look & { turn?: V3; bevel?: number } = {}): Part {
	const c = Math.min(look.bevel ?? chamferOf(size), Math.min(...size) / 3);
	const g = place(chamferedBox(size, c), at, look.turn);
	return part(g, {
		...look,
		solids: look.solids ?? [{ shape: 'box', size, at, ...(look.turn ? { turn: look.turn } : {}) }]
	});
}

/** A cylinder (or, with `top`, a cone frustum) standing on y, centred on `at`: a lathe of three bands. */
export function cyl(
	radius: number,
	height: number,
	at: V3,
	look: Look & { top?: number; seg?: number } = {}
): Part {
	const [y0, y1] = [-height / 2, height / 2];
	const top = look.top ?? radius;
	const g = lathe(
		[
			[0, y0],
			[radius, y0],
			[top, y1],
			[0, y1]
		],
		at,
		look.seg ?? 12
	);
	return part(g, {
		...look,
		solids: look.solids ?? [{ shape: 'cylinder', size: [radius * 2, height, radius * 2], at: at }]
	});
}

// ---------------------------------------------------------------- turned work

/**
 * A lathe: `profile` is (radius, y) points from the foot up, each edge a band shaded as one (so a
 * moulding's steps stay crisp) round `seg` sides; a point on the axis closes it.
 */
export function lathe(profile: [number, number][], at: V3, seg = 12): THREE.BufferGeometry {
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i + 1 < profile.length; i++) {
		const [r0, y0] = profile[i];
		const [r1, y1] = profile[i + 1];
		const [dr, dy] = [r1 - r0, y1 - y0];
		const len = Math.hypot(dr, dy);
		if (len < 1e-9) continue;
		const [nr, ny] = [dy / len, -dr / len];
		const base = positions.length / 3;
		for (let k = 0; k <= seg; k++) {
			const a = (k / seg) * Math.PI * 2;
			const [c, s] = [Math.cos(a), Math.sin(a)];
			positions.push(r0 * c, y0, r0 * s, r1 * c, y1, r1 * s);
			normals.push(nr * c, ny, nr * s, nr * c, ny, nr * s);
		}
		for (let k = 0; k < seg; k++) {
			const q = base + k * 2;
			// Wound so the face looks along its normal.
			indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
		}
	}
	const g = fromArrays(positions, normals, indices);
	fixWinding(g);
	return place(g, at);
}

/** A turned part (a baluster, a finial, a lathed foot) from a profile. */
export function turned(
	profile: [number, number][],
	at: V3,
	look: Look & { seg?: number } = {}
): Part {
	const g = lathe(profile, at, look.seg ?? 10);
	const rMax = Math.max(...profile.map(([r]) => r));
	const [yMin, yMax] = [
		Math.min(...profile.map(([, y]) => y)),
		Math.max(...profile.map(([, y]) => y))
	];
	return part(g, {
		...look,
		solids: look.solids ?? [
			{
				shape: 'cylinder',
				size: [rMax * 2, yMax - yMin, rMax * 2],
				at: [at[0], at[1] + (yMin + yMax) / 2, at[2]]
			}
		]
	});
}

// ---------------------------------------------------------------- swept work

/**
 * A profile (z, y points, counter-clockwise seen from +x) swept from x0 to x1: copings, string
 * courses, beams with chamfers, lintels. Edges are shaded flat; the ends are capped.
 */
export function sweep(
	profile: [number, number][],
	x0: number,
	x1: number,
	look: Look & { at?: V3 } = {}
): Part {
	const n = profile.length;
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i < n; i++) {
		const [z0, y0] = profile[i];
		const [z1, y1] = profile[(i + 1) % n];
		const [dz, dy] = [z1 - z0, y1 - y0];
		const len = Math.hypot(dz, dy) || 1;
		const [nz, ny] = [dy / len, -dz / len];
		const b = positions.length / 3;
		positions.push(x0, y0, z0, x1, y0, z0, x1, y1, z1, x0, y1, z1);
		for (let k = 0; k < 4; k++) normals.push(0, ny, nz);
		indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
	}
	const tris = THREE.ShapeUtils.triangulateShape(
		profile.map(([z, y]) => new THREE.Vector2(z, y)),
		[]
	);
	for (const [x, nx] of [
		[x0, -1],
		[x1, 1]
	] as const) {
		const b = positions.length / 3;
		for (const [z, y] of profile) {
			positions.push(x, y, z);
			normals.push(nx, 0, 0);
		}
		for (const [a, bb, c] of tris)
			indices.push(...(nx > 0 ? [b + a, b + bb, b + c] : [b + a, b + c, b + bb]));
	}
	const g = fromArrays(positions, normals, indices);
	fixWinding(g);
	const at = look.at ?? [0, 0, 0];
	const ys = profile.map(([, y]) => y);
	const zs = profile.map(([z]) => z);
	const size: V3 = [x1 - x0, Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
	const centre: V3 = [
		at[0] + (x0 + x1) / 2,
		at[1] + (Math.max(...ys) + Math.min(...ys)) / 2,
		at[2] + (Math.max(...zs) + Math.min(...zs)) / 2
	];
	g.translate(at[0], at[1], at[2]);
	return part(g, { ...look, solids: look.solids ?? [{ shape: 'box', size, at: centre }] });
}

/** An extruded outline (x, y points) from z0 to z1: a gable, a bracket, a window head. */
export function extrude(
	outline: [number, number][],
	z0: number,
	z1: number,
	look: Look & { bevel?: number } = {}
): Part {
	const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
	const bevel = look.bevel ?? 0;
	const g0 = new THREE.ExtrudeGeometry(shape, {
		depth: z1 - z0 - bevel * 2,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelSegments: 1,
		curveSegments: 6
	});
	g0.translate(0, 0, z0 + bevel);
	g0.deleteAttribute('uv');
	const g = toIndexed(g0);
	return part(g, { ...look, solids: look.solids ?? false });
}

/**
 * A ring of voussoirs round (cx, cy): a round arch or, with `point`, a pointed one (two arcs,
 * centres offset along x), from the springing (angle 0 at +x, π at -x) over the top. Each stone is a
 * wedge between the radii, a joint apart, `z0` to `z1` deep.
 */
export function voussoirs(
	cx: number,
	cy: number,
	rIn: number,
	rOut: number,
	z0: number,
	z1: number,
	count: number,
	look: Look & { point?: number; joint?: number; vary?: number; seed?: number } = {}
): Part[] {
	const rand = rng(look.seed ?? 1);
	const joint = look.joint ?? 0.012;
	const point = look.point ?? 0;
	const out: Part[] = [];
	// A pointed arch: the right half is an arc about (cx - point, cy), the left about (cx + point, cy).
	const at = (side: 1 | -1, a: number, r: number): [number, number] => {
		const ox = cx - side * point;
		return [ox + side * r * Math.cos(a), cy + r * Math.sin(a)];
	};
	const half = Math.ceil(count / 2);
	for (const side of [1, -1] as const) {
		const top = point > 0 ? Math.acos(point / rIn) : Math.PI / 2;
		const span = Math.PI / 2 - (Math.PI / 2 - top);
		for (let k = 0; k < half; k++) {
			const [a0, a1] = [(k / half) * span, ((k + 1) / half) * span];
			const pad = joint / rOut;
			const quad: [number, number][] = [
				at(side, a0 + pad, rIn),
				at(side, a0 + pad, rOut),
				at(side, a1 - pad, rOut),
				at(side, a1 - pad, rIn)
			];
			const wedge = extrude(
				side > 0 ? quad : [...quad].reverse(),
				z0 + rand() * 0.004,
				z1 - rand() * 0.004,
				{ bevel: 0.006 }
			);
			wedge.tint = look.tint ?? [1, 1, 1];
			wedge.tone = (look.tone ?? 1) * (1 - (look.vary ?? 0.06) * rand());
			out.push(wedge);
		}
	}
	return out;
}

// ---------------------------------------------------------------- natural work

/** Value noise on a 3D lattice, -1 to 1, from a seed: what the rocks' faces are made of. */
export function noise3(seed: number) {
	const rand = rng(seed);
	const table = Float32Array.from({ length: 512 }, () => rand() * 2 - 1);
	const hash = (x: number, y: number, z: number) =>
		table[(((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 512];
	const fade = (t: number) => t * t * (3 - 2 * t);
	return (x: number, y: number, z: number) => {
		const [xi, yi, zi] = [Math.floor(x), Math.floor(y), Math.floor(z)];
		const [fx, fy, fz] = [fade(x - xi), fade(y - yi), fade(z - zi)];
		const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
		const plane = (dz: number) =>
			lerp(
				lerp(hash(xi, yi, zi + dz), hash(xi + 1, yi, zi + dz), fx),
				lerp(hash(xi, yi + 1, zi + dz), hash(xi + 1, yi + 1, zi + dz), fx),
				fy
			);
		return lerp(plane(0), plane(1), fz);
	};
}

/**
 * A hewn or split stone: an icosphere of `size` pushed about by noise, faceted, its underside
 * flattened (`flat`, 0-1: how much of its height is cut off below), so it sits like a quarried
 * rock rather than a ball. `detail` 1 is 80 faces, 2 is 320.
 */
export function rock(
	size: V3,
	at: V3,
	look: Look & { seed?: number; rough?: number; flat?: number; detail?: number } = {}
): Part {
	const seed = look.seed ?? 1;
	const n = noise3(seed);
	const rough = look.rough ?? 0.22;
	const flat = look.flat ?? 0.25;
	const ico = new THREE.IcosahedronGeometry(0.5, look.detail ?? 1);
	const position = ico.getAttribute('position');
	const [fx, fy, fz] = [1.7 + (seed % 5) * 0.13, 1.7 + (seed % 3) * 0.2, 1.7 + (seed % 7) * 0.11];
	const p = new THREE.Vector3();
	for (let i = 0; i < position.count; i++) {
		p.fromBufferAttribute(position, i);
		const k =
			1 +
			rough *
				(n(p.x * fx * 2 + 9, p.y * fy * 2 + 4, p.z * fz * 2 + 1) * 0.8 +
					n(p.x * fx * 5, p.y * fy * 5, p.z * fz * 5) * 0.35);
		p.multiplyScalar(k);
		// The underside cut off flat.
		const floor = -0.5 + flat;
		if (p.y < floor) p.y = floor;
		position.setXYZ(i, p.x, p.y, p.z);
	}
	// Fitted to its box: `size` is the stone's extent, so a piece's envelope holds by arithmetic.
	const box3 = new THREE.Box3().setFromBufferAttribute(position);
	const [lo, hi] = [box3.min, box3.max];
	for (let i = 0; i < position.count; i++) {
		position.setXYZ(
			i,
			((position.getX(i) - lo.x) / (hi.x - lo.x) - 0.5) * size[0],
			((position.getY(i) - lo.y) / (hi.y - lo.y) - 0.5) * size[1],
			((position.getZ(i) - lo.z) / (hi.z - lo.z) - 0.5) * size[2]
		);
	}
	// Shaded per face: a rock reads as planes, not a ball.
	ico.deleteAttribute('uv');
	ico.computeVertexNormals();
	const g = toIndexed(ico);
	g.translate(at[0], at[1], at[2]);
	return part(g, {
		...look,
		solids: look.solids ?? [
			{ shape: 'sphere', size: [size[0] * 0.9, size[1] * 0.9, size[2] * 0.9], at }
		]
	});
}

// ---------------------------------------------------------------- merge

/** Non-indexed geometry as indexed (no vertex merging: every face keeps its own normals). */
function toIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
	if (g.index) return g;
	g.deleteAttribute('uv');
	const count = g.getAttribute('position').count;
	g.setIndex(Array.from({ length: count }, (_, i) => i));
	return g;
}

function fromArrays(positions: number[], normals: number[], indices: number[]) {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	g.setIndex(indices);
	return g;
}

/** Flips each triangle that winds against its vertex normals. */
function fixWinding(g: THREE.BufferGeometry): void {
	const index = g.getIndex()!;
	const position = g.getAttribute('position');
	const normal = g.getAttribute('normal');
	const [a, b, c, n] = [0, 0, 0, 0].map(() => new THREE.Vector3());
	const arr = index.array as Uint32Array | Uint16Array | number[];
	for (let i = 0; i < arr.length; i += 3) {
		a.fromBufferAttribute(position, arr[i]);
		b.fromBufferAttribute(position, arr[i + 1]);
		c.fromBufferAttribute(position, arr[i + 2]);
		n.fromBufferAttribute(normal, arr[i]).add(
			new THREE.Vector3().fromBufferAttribute(normal, arr[i + 1])
		);
		const face = b.clone().sub(a).cross(c.clone().sub(a));
		if (face.dot(n) < 0) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
	}
}

export { part };
