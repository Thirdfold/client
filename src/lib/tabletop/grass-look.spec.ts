import { describe, expect, it } from 'vitest';
import { bladesFor, MAX_BLADES, readGrass, withGrassLook } from './grass-look';
import { VEGETATION } from './world/vegetation-tiers';

describe('grass settings', () => {
	it('reads only known, non-default values', () => {
		expect(readGrass({ grassDensity: 'lush', grassHeight: 'tall' })).toEqual({
			grassDensity: 'lush',
			grassHeight: 'tall'
		});
		expect(readGrass({ grassDensity: 'normal', grassHeight: 'toString' })).toEqual({});
		expect(readGrass({ grassDensity: 7, grassHeight: null })).toEqual({});
	});
	it('multiplies the tier and caps blades', () => {
		expect(bladesFor(withGrassLook(VEGETATION.high, {}))).toBe(40);
		expect(bladesFor(withGrassLook(VEGETATION.high, { grassDensity: 'lush' }))).toBe(MAX_BLADES);
		expect(bladesFor(withGrassLook(VEGETATION.low, { grassDensity: 'sparse' }))).toBe(5);
		expect(withGrassLook(VEGETATION.low, { grassHeight: 'very-tall' }).heightScale).toBe(2.4);
	});
});
