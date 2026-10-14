import { describe, expect, it } from 'vitest';
import type { AdventureView } from '../adventure/adventure';
import { statusVisuals } from './status-visuals';

const status = (id: string, vfx?: string) => ({ id, rounds: 2, ...(vfx ? { vfx } : {}) });
const view = (characters: unknown[], enemies: unknown[] = []) =>
	({ characters, encounter: { enemies } }) as unknown as AdventureView;

describe('statusVisuals', () => {
	it('gives none for an unseen character and for no statuses', () => {
		const v = view([
			{ tokenId: null, statuses: [status('guarded', 'shimmer')] },
			{ tokenId: 'a', statuses: [] }
		]);
		expect(statusVisuals(v).size).toBe(0);
		expect(statusVisuals(null).size).toBe(0);
	});

	it('shows characters and the enemies sent', () => {
		const v = view(
			[{ tokenId: 'a', statuses: [status('guarded', 'shimmer')] }],
			[{ tokenId: 'h', statuses: [status('burning', 'embers')] }]
		);
		expect(statusVisuals(v)).toEqual(
			new Map([
				['a', ['shimmer']],
				['h', ['embers']]
			])
		);
	});

	it('gives a neutral ring to an unknown or missing preset', () => {
		const v = view([
			{ tokenId: 'a', statuses: [status('x'), status('y', 'plaid'), status('z', 'shadow')] }
		]);
		expect(statusVisuals(v).get('a')).toEqual(['neutral', 'shadow']);
	});

	it('shows a pip past three looks', () => {
		const all = ['embers', 'shimmer', 'frost', 'shadow'].map((p) => status(p, p));
		expect(statusVisuals(view([{ tokenId: 'a', statuses: all }])).get('a')).toEqual([
			'embers',
			'shimmer',
			'frost',
			'more'
		]);
	});
});
