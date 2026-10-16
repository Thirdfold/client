import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewPose } from './camera-rig';
import { pickKey } from './picking';
import type { Pick } from './types';

const DIR = path.dirname(new URL(import.meta.url).pathname);

describe('the tabletop modules', () => {
	it('each stay under 500 lines', () => {
		// The folders too (materials/, #169).
		const long = readdirSync(DIR, { recursive: true, encoding: 'utf8' })
			.filter((f) => /\.(ts|svelte)$/.test(f) && !/\.spec\.ts$/.test(f))
			.map((f) => ({ f, lines: readFileSync(path.join(DIR, f), 'utf8').split('\n').length }))
			.filter(({ lines }) => lines > 500);
		expect(long).toEqual([]);
	});
});

describe('views', () => {
	it('frame the table from high above in overview and lower and closer in explore', () => {
		for (const extent of [10, 26, 54]) {
			const overview = viewPose('overview', extent);
			const explore = viewPose('explore', extent);
			const length = ({ x, y, z }: { x: number; y: number; z: number }) => Math.hypot(x, y, z);
			expect(overview.target).toEqual({ x: 0, y: 0, z: 0 });
			expect(explore.position.y).toBeLessThan(overview.position.y);
			expect(length(explore.position)).toBeLessThan(length(overview.position));
		}
	});
});

describe('hover keys', () => {
	const pick = (over: Partial<Pick> = {}): Pick => ({
		cell: { x: 1, y: 2 },
		corner: { x: 1, y: 2 },
		edge: null,
		edgeDistance: Infinity,
		tokenId: null,
		objectId: null,
		lightId: null,
		propId: null,
		...over
	});

	it('change when what is under the pointer changes, and only then', () => {
		expect(pickKey(pick())).toBe(pickKey(pick()));
		expect(pickKey(pick({ cell: { x: 2, y: 2 } }))).not.toBe(pickKey(pick()));
		expect(pickKey(pick({ tokenId: 'a' }))).not.toBe(pickKey(pick()));
		const edge = { a: { x: 1, y: 2 }, b: { x: 2, y: 2 } };
		// Moving along an edge changes nothing; coming close to it (under 0.2 cells) does.
		expect(pickKey(pick({ edge, edgeDistance: 0.4 }))).toBe(
			pickKey(pick({ edge, edgeDistance: 0.3 }))
		);
		expect(pickKey(pick({ edge, edgeDistance: 0.1 }))).not.toBe(
			pickKey(pick({ edge, edgeDistance: 0.3 }))
		);
	});
});
