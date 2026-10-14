// The scatter rules (M74 #305): the shape both the pipeline and the client's parser accept, and
// what only the build checks (floors, decor models, the catalogue, the height cap).

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnvironmentDef, ModelEntry } from '../../src/lib/assets/manifest';
import { readScatter, type ScatterRule } from '../../src/lib/assets/scatter';
import { buildAssets } from './pipeline';
import { checkScatter } from './pipeline-scatter';

const rule: ScatterRule = {
	decor: 'tuft',
	on: ['grass', 'default'],
	where: 'wallFoot',
	density: 1.5,
	scale: [0.8, 1.3]
};
const decor = (height: number) =>
	({ kind: 'decor', bounds: { min: [0, 0, 0], max: [0.1, height, 0.1] } }) as unknown as ModelEntry;
const env = (...scatter: ScatterRule[]) =>
	({ v: { scatter } }) as unknown as Record<string, EnvironmentDef>;
const check = (rules: ScatterRule[], models = { tuft: decor(0.1) }) =>
	checkScatter(env(...rules), models, { tree: { category: 'nature' } });

describe('readScatter', () => {
	it('reads rules and drops what it does not know', () => {
		expect(readScatter([{ ...rule, extra: 1 }])).toEqual([rule]);
		const beside = { ...rule, where: 'besideProp', beside: 'nature', outdoor: true };
		expect(readScatter([beside])).toEqual([beside]);
		expect(readScatter([])).toEqual([]);
	});

	it('refuses a malformed rule or list', () => {
		const bad: unknown[] = [
			null,
			'rules',
			[null],
			[{ ...rule, decor: 'Tuft' }],
			[{ ...rule, on: [] }],
			[{ ...rule, on: ['Grass'] }],
			[{ ...rule, where: 'roof' }],
			[{ ...rule, where: 'besideProp' }],
			[{ ...rule, beside: 'tree' }],
			[{ ...rule, density: 5 }],
			[{ ...rule, density: -1 }],
			[{ ...rule, scale: [1] }],
			[{ ...rule, scale: [1.5, 1] }],
			[{ ...rule, scale: [0.1, 1] }],
			[{ ...rule, outdoor: 'yes' }],
			Array.from({ length: 17 }, () => rule)
		];
		for (const raw of bad) expect(readScatter(raw), JSON.stringify(raw)).toBeNull();
	});
});

describe('checkScatter', () => {
	it('accepts a rule on a decor model and a floor, or beside a prop or a category', () => {
		expect(() => check([rule, { ...rule, where: 'besideProp', beside: 'tree' }])).not.toThrow();
		expect(() => check([{ ...rule, where: 'besideProp', beside: 'nature' }])).not.toThrow();
	});

	it('refuses a decor model that is missing or not decor', () => {
		expect(() => check([{ ...rule, decor: 'ghost' }])).toThrow(/models\/decor/);
		expect(() => check([rule], { tuft: { kind: 'prop' } as ModelEntry })).toThrow(/models\/decor/);
	});

	it('refuses floors that take no decor and floors that do not exist', () => {
		for (const on of ['void', 'lava', 'water', 'plain', 'moss'])
			expect(() => check([{ ...rule, on: [on] }]), on).toThrow(/"on"/);
	});

	it('refuses a beside that is neither a prop nor a category', () => {
		expect(() => check([{ ...rule, where: 'besideProp', beside: 'dragon' }])).toThrow(/beside/);
	});

	it('holds decor under 0.15 cell at its largest scale', () => {
		const exact = () => check([{ ...rule, scale: [0.5, 1.5] }], { tuft: decor(0.1) });
		expect(exact).not.toThrow(); // 0.15 exactly
		expect(() => check([{ ...rule, scale: [0.5, 1.6] }], { tuft: decor(0.1) })).toThrow(
			/0.160 cells tall/
		);
		expect(() => check([rule], { tuft: decor(0.2) })).toThrow(/over 0.15/);
	});
});

describe('the built-in environments', () => {
	it('keep their scatter rules in the built manifest, and every rule passes the build', async () => {
		const { manifest } = await buildAssets(path.resolve('assets'));
		const ruled = Object.entries(manifest.environments).filter(([, e]) => e.scatter);
		expect(ruled.map(([id]) => id)).toContain('village');
		for (const [, e] of ruled)
			for (const r of e.scatter!) {
				expect(manifest.models[r.decor].kind).toBe('decor');
				expect(manifest.models[r.decor].triangles).toBeLessThanOrEqual(300);
			}
	}, 120_000);
});
