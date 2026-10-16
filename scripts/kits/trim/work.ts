// Larger work built from geom.ts's shapes: coursed masonry, cords and roots, bone and sinew.

import * as THREE from 'three';
import { box, noise3, part, rng, rock, type Look, type Part, type V3 } from './geom';
import type { Piece } from './piece';

export interface Courses {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	z0: number;
	z1: number;
	/** About how tall a course is; the run is divided into whole courses. */
	course: number;
	/** The shortest and longest block along the wall. */
	len: [number, number];
	seed: number;
	/** Spans of x left open (a niche, an opening). */
	gaps?: [number, number][];
	joint?: number;
	/** Blocks sit back from the face by up to this much (their depth varies). */
	play?: number;
	tint?: V3;
	/** Each block's own tone varies by this share. */
	vary?: number;
	bevel?: number;
}

/**
 * Coursed blocks between x0..x1 and y0..y1, each a bevelled box a joint apart, courses staggered,
 * lengths random between `len`, cut by `gaps`, slivers joined to their neighbour: ashlar, dressed
 * or rubble by the course height and lengths given.
 */
export function masonry(o: Courses): Part[] {
	const rand = rng(o.seed);
	const joint = o.joint ?? 0.014;
	const rows = Math.max(1, Math.round((o.y1 - o.y0) / o.course));
	const h = (o.y1 - o.y0) / rows;
	const out: Part[] = [];
	for (let r = 0; r < rows; r++) {
		// Blocks along this course, from a staggered start.
		const cuts: number[] = [];
		let x = o.x0 - rand() * o.len[0] * (r % 2 ? 0.7 : 0.2);
		while (x < o.x1) {
			cuts.push(x);
			x += o.len[0] + rand() * (o.len[1] - o.len[0]);
		}
		cuts.push(Math.max(x, o.x1 + 0.01));
		let spans: [number, number][] = [];
		for (let i = 0; i + 1 < cuts.length; i++)
			spans.push([Math.max(cuts[i], o.x0), Math.min(cuts[i + 1], o.x1)]);
		spans = spans.filter(([a, b]) => b - a > 1e-6);
		for (const [ga, gb] of o.gaps ?? [])
			spans = spans.flatMap(([a, b]) =>
				(
					[
						[a, Math.min(b, ga)],
						[Math.max(a, gb), b]
					] as [number, number][]
				).filter(([p, q]) => q - p > 1e-6)
			);
		// Slivers join the block beside them.
		const merged: [number, number][] = [];
		for (const s of spans) {
			const last = merged.at(-1);
			if (
				last &&
				Math.abs(last[1] - s[0]) < 1e-6 &&
				(s[1] - s[0] < 0.09 || last[1] - last[0] < 0.09)
			)
				last[1] = s[1];
			else merged.push([...s]);
		}
		const y = o.y0 + (r + 0.5) * h;
		for (const [a, b] of merged) {
			if (b - a < 0.04) continue;
			const back = rand() * (o.play ?? 0.012);
			const d = o.z1 - o.z0 - back;
			const w = b - a - joint;
			const hh = h - joint;
			const tint = o.tint ?? [1, 1, 1];
			const k = 1 - (o.vary ?? 0.07) * rand();
			out.push(
				box([w, hh, d], [(a + b) / 2, y, (o.z0 + o.z1) / 2 - back / 2], {
					bevel: o.bevel ?? Math.min(0.012, hh / 5),
					tint: [tint[0] * k, tint[1] * k, tint[2] * k],
					solids: [{ shape: 'box', size: [w, hh, d], at: [(a + b) / 2, y, (o.z0 + o.z1) / 2] }]
				})
			);
		}
	}
	return out;
}

/** What shows through the joints: the wall's core, dark. */
export function core(
	x0: number,
	x1: number,
	y0: number,
	y1: number,
	z0: number,
	z1: number,
	tone = 0.45
): Part {
	return box([x1 - x0, y1 - y0, z1 - z0], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], {
		tone,
		bevel: 0.001,
		solids: false
	});
}

/** A tube of `radius` along a path of points: cords, ropes, ribs, roots; tapering and lumpy if asked. */
export function tube(
	path: V3[],
	radius: number,
	look: Look & {
		radial?: number;
		segs?: number;
		taper?: [number, number];
		seed?: number;
		lump?: number;
	} = {}
): Part {
	const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
	const segs = look.segs ?? Math.max(4, path.length * 3);
	const radial = look.radial ?? 7;
	const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
	const pos = g.getAttribute('position');
	const n = noise3(look.seed ?? 5);
	const taper = look.taper ?? [1, 1];
	// A tube's rings are `radial + 1` points each; scale each about its path centre.
	for (let i = 0; i < pos.count; i++) {
		const ring = Math.floor(i / (radial + 1));
		const t = ring / segs;
		const c = curve.getPoint(t);
		const k = taper[0] + (taper[1] - taper[0]) * t;
		const lump = 1 + (look.lump ?? 0) * n(pos.getX(i) * 6, pos.getY(i) * 6, pos.getZ(i) * 6);
		pos.setXYZ(
			i,
			c.x + (pos.getX(i) - c.x) * k * lump,
			c.y + (pos.getY(i) - c.y) * k * lump,
			c.z + (pos.getZ(i) - c.z) * k * lump
		);
	}
	g.computeVertexNormals();
	g.deleteAttribute('uv');
	const bb = new THREE.Box3().setFromBufferAttribute(pos);
	const size = bb.getSize(new THREE.Vector3());
	const c = bb.getCenter(new THREE.Vector3());
	return part(g, {
		...look,
		solids: look.solids ?? [{ shape: 'box', size: [size.x, size.y, size.z], at: [c.x, c.y, c.z] }]
	});
}

/**
 * A lumpy column or knuckle: a lathe of `radiusAt(t)` (t 0..1 up its height) round `seg` sides and
 * `rings` rings, every vertex pushed by noise: bone, root, swollen sinew.
 */
export function organic(
	radiusAt: (t: number) => number,
	height: number,
	at: V3,
	look: Look & {
		seg?: number;
		rings?: number;
		lump?: number;
		seed?: number;
		twist?: number;
		/** Stretches it across x and z: a bulge squashed against a wall. */
		squash?: [number, number];
	} = {}
): Part {
	const seg = look.seg ?? 9;
	const rings = look.rings ?? 8;
	const n = noise3(look.seed ?? 3);
	const positions: number[] = [];
	for (let r = 0; r <= rings; r++) {
		const t = r / rings;
		for (let k = 0; k < seg; k++) {
			const a = (k / seg) * Math.PI * 2 + (look.twist ?? 0) * t;
			const [c, s] = [Math.cos(a), Math.sin(a)];
			const base = radiusAt(t);
			const bump = 1 + (look.lump ?? 0.15) * n(c * 1.8 + 7, t * 3.1, s * 1.8 + 2);
			positions.push(
				base * bump * c * (look.squash?.[0] ?? 1),
				t * height,
				base * bump * s * (look.squash?.[1] ?? 1)
			);
		}
	}
	const indices: number[] = [];
	for (let r = 0; r < rings; r++)
		for (let k = 0; k < seg; k++) {
			const [a, b] = [r * seg + k, r * seg + ((k + 1) % seg)];
			const [c, d] = [a + seg, b + seg];
			indices.push(a, c, b, b, c, d);
		}
	// Caps: a point at each end.
	const bottom = positions.length / 3;
	positions.push(0, 0, 0);
	const top = bottom + 1;
	positions.push(0, height, 0);
	for (let k = 0; k < seg; k++) {
		indices.push(bottom, k, (k + 1) % seg);
		indices.push(top, rings * seg + ((k + 1) % seg), rings * seg + k);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	g.setIndex(indices);
	g.computeVertexNormals();
	const radius = Math.max(...Array.from({ length: 9 }, (_, i) => radiusAt(i / 8)));
	g.translate(at[0], at[1], at[2]);
	return part(g, {
		...look,
		solids: look.solids ?? [
			{
				shape: 'cylinder',
				size: [radius * 2, height, radius * 2],
				at: [at[0], at[1] + height / 2, at[2]]
			}
		]
	});
}

/** The strata of a cliff: slabs of rock laid flat, each pushed out a little, ragged-edged. */
export function cliff(
	id: string,
	role: 'cliff.face' | 'cliff.corner',
	seed: number,
	tint: V3
): Piece {
	const rand = rng(seed);
	const parts: Part[] = [];
	const slabs = role === 'cliff.face' ? 7 : 5;
	const face = role === 'cliff.face';
	for (let i = 0; i < slabs; i++) {
		const h = 2 / slabs;
		const y = -2 + (i + 0.5) * h - 0.09;
		const k = 0.85 + rand() * 0.25;
		parts.push(
			rock(
				[0.78, h * 1.3, 0.3 + rand() * 0.06],
				[face ? 0 : -0.05, y, face ? -0.18 + rand() * 0.03 : -0.05],
				{
					tint: [tint[0] * k, tint[1] * k, tint[2] * k],
					seed: seed + i,
					rough: 0.16,
					flat: 0.1,
					detail: 1
				}
			)
		);
	}
	return { id, role, parts };
}
