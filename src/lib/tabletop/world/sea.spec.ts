// The sea ring (#296): a hole exactly the grid's, no vertex or triangle inside it, a join with
// the edge cells' surfaces that eases out over eight cells, tiered vertex counts, and the same
// bytes for the same input.

import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { spanOf, worldExtents } from '../world-ground';
import { beyondOf, skirtMesh, type Beyond, type BeyondMesh } from './beyond';
import { deepSurfaceY, SEA_RING, SEA_VERTICES, seaMesh, wadeSurfaceY } from './sea';
import { SWELL_RAMP_CELLS, type SeaTier } from './swell';

const grid = (width: number, height: number, cellSize = 1): SquareGrid => ({
	kind: 'square',
	cellSize,
	width,
	height
});
const GRIDS = [grid(4, 4), grid(16, 16), grid(64, 64), grid(48, 36), grid(68, 7), grid(10, 6, 2)];
const TIERS = Object.keys(SEA_RING) as SeaTier[];
const make = (g: SquareGrid, level = 0): Beyond =>
	beyondOf({
		environment: 'village',
		backdrop: { kind: 'sea', level },
		span: spanOf(worldExtents(g))
	});
const label = (g: SquareGrid) => `${g.width}x${g.height} at ${g.cellSize}`;
const at = (m: BeyondMesh, v: number) => ({
	x: m.positions[v * 3],
	y: m.positions[v * 3 + 1],
	z: m.positions[v * 3 + 2]
});
const inside = (b: Beyond, x: number, z: number) =>
	Math.abs(x) < b.span.halfX - 1e-6 && Math.abs(z) < b.span.halfZ - 1e-6;

describe('the sea ring', () => {
	it.each(GRIDS.map((g) => [label(g), g] as const))(
		'has no vertex, edge midpoint or triangle centre inside the grid of %s, and faces up',
		(_, g) => {
			const b = make(g);
			for (const tier of TIERS) {
				const m = seaMesh(b, tier);
				const count = m.positions.length / 3;
				expect(m.uvs.length).toBe(count * 2);
				expect(m.indices.reduce((hi, v) => Math.max(hi, v), 0)).toBeLessThan(count);
				let bad = 0; // counted, not asserted one by one: a ring has tens of thousands
				for (let v = 0; v < count; v++) bad += inside(b, at(m, v).x, at(m, v).z) ? 1 : 0;
				for (let i = 0; i < m.indices.length; i += 3) {
					const [p, q, r] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((v) => at(m, v));
					if ((q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) <= 0) bad++;
					for (const [a, c] of [
						[p, q],
						[q, r],
						[r, p]
					])
						bad += inside(b, (a.x + c.x) / 2, (a.z + c.z) / 2) ? 1 : 0;
					bad += inside(b, (p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3) ? 1 : 0;
				}
				expect(bad).toBe(0);
			}
		}
	);

	it('starts on the grid rectangle, through all four corners, and reaches the horizon', () => {
		const b = make(grid(48, 36));
		const { halfX: hw, halfZ: hd, horizon } = b.span;
		const m = seaMesh(b, 'medium');
		const rows = SEA_RING.medium.rows;
		const inner = Array.from({ length: m.positions.length / 3 / rows }, (_, i) => at(m, i * rows));
		for (const p of inner)
			expect(Math.abs(Math.abs(p.x) - hw) < 1e-4 || Math.abs(Math.abs(p.z) - hd) < 1e-4).toBe(true);
		for (const x of [-1, 1])
			for (const z of [-1, 1])
				expect(inner.some((p) => Math.hypot(p.x - x * hw, p.z - z * hd) < 1e-4)).toBe(true);
		for (let i = 0; i < inner.length; i++) {
			const p = at(m, i * rows + rows - 1);
			expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(horizon - 1e-3);
		}
	});

	it('has the tier table’s vertex counts (within 5%) and rows denser at the grid', () => {
		const b = make(grid(64, 64));
		for (const tier of TIERS) {
			const m = seaMesh(b, tier);
			const count = m.positions.length / 3;
			expect(Math.abs(count - SEA_VERTICES[tier])).toBeLessThan(SEA_VERTICES[tier] * 0.05);
			const rows = SEA_RING[tier].rows;
			const out = (k: number) => Math.hypot(at(m, k).x - at(m, 0).x, at(m, k).z - at(m, 0).z);
			// The first step off the grid is a fraction of a cell; the last is tens of cells.
			expect(out(1)).toBeLessThan(0.5);
			expect(out(rows - 1) - out(rows - 2)).toBeGreaterThan(10);
		}
	});

	it('is flat at the backdrop’s wade height without edge data, and eases to its deep height', () => {
		for (const level of [0, 2]) {
			const b = make(grid(32, 32), level);
			const m = seaMesh(b, 'low');
			const c = b.span.cellSize;
			const ys = Array.from({ length: m.positions.length / 3 }, (_, v) => at(m, v).y);
			expect(Math.max(...ys)).toBeCloseTo(wadeSurfaceY(level, c), 5);
			expect(Math.min(...ys)).toBeCloseTo(deepSurfaceY(level, c), 5);
			expect(at(m, 0).y).toBeCloseTo(wadeSurfaceY(level, c), 5);
			expect(at(m, SEA_RING.low.rows - 1).y).toBeCloseTo(deepSurfaceY(level, c), 5);
		}
	});

	it('takes the edge cells’ surfaces at the border and eases out over eight cells with no step', () => {
		const b = make(grid(32, 32));
		const c = b.span.cellSize;
		const surface = (x: number, y: number) => (y === 0 ? (x < 16 ? 0.6 : 0.2) : -1);
		const m = seaMesh(b, 'high', surface);
		const rows = SEA_RING.high.rows;
		const columns = m.positions.length / 3 / rows;
		let seen = 0;
		for (let i = 0; i < columns; i++) {
			const p = at(m, i * rows);
			if (Math.abs(p.z + b.span.halfZ) > 1e-6) continue; // the north edge's columns
			seen++;
			// On the border: the edge cells' surfaces, blended between their centres.
			const u = Math.min(Math.max(p.x + 16 - 0.5, 0), 31);
			const [u0, f] = [Math.floor(u), u - Math.floor(u)];
			const want = surface(u0, 0) * (1 - f) + surface(Math.min(u0 + 1, 31), 0) * f;
			expect(p.y).toBeCloseTo(want, 5);
			// Out along the column it reaches the deep height by eight cells, never jumping.
			let last = p.y;
			for (let k = 1; k < rows; k++) {
				const q = at(m, i * rows + k);
				if (Math.hypot(q.x - p.x, q.z - p.z) >= SWELL_RAMP_CELLS * c) {
					expect(q.y).toBeCloseTo(deepSurfaceY(0, c), 5);
					break;
				}
				expect(Math.abs(q.y - last)).toBeLessThan(0.2 * Math.abs(p.y - deepSurfaceY(0, c)) + 1e-3);
				last = q.y;
			}
		}
		expect(seen).toBeGreaterThan(10);
	});

	it('is built from the backdrop and the grid’s size only, byte for byte', () => {
		const [p, q] = [seaMesh(make(grid(48, 36)), 'medium'), seaMesh(make(grid(48, 36)), 'medium')];
		for (const k of ['positions', 'uvs', 'indices'] as const)
			expect(Buffer.from(p[k].buffer).equals(Buffer.from(q[k].buffer))).toBe(true);
	});

	it('is what the skirt builds for a sea backdrop, and only for one', () => {
		const b = make(grid(32, 32));
		expect(skirtMesh(b, true).positions.length).toBe(seaMesh(b, 'low').positions.length);
		expect(skirtMesh(b, false).positions.length).toBe(seaMesh(b, 'medium').positions.length);
		const plains = beyondOf({
			environment: 'village',
			backdrop: { kind: 'plains', level: 0 },
			span: b.span
		});
		expect(skirtMesh(plains, false).positions.length).not.toBe(
			seaMesh(b, 'medium').positions.length
		);
	});
});
