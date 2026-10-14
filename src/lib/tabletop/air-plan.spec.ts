import { describe, expect, it } from 'vitest';
import { gridToWorld, worldToGrid, type SquareGrid } from '../game/grid';
import { RECIPE_IDS } from './vfx-recipes';
import { FX_RECIPES, MOTES } from '../assets/fx';
import { groundFor } from './ground';
import {
	BOLT_HEIGHT,
	FX_LOOP,
	MOTE_COUNTS,
	MOTE_RECIPE,
	STRIKE_GAP_MS,
	STRIKE_SLOT_MS,
	boltPoints,
	fireflyLoops,
	hueStep,
	moteAnchors,
	socketPoint,
	strikeDue,
	strikeTime,
	tintSeed
} from './air-plan';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 36, height: 28 };
const ground = groundFor(grid, null);

describe('the recipes the data names', () => {
	it('exist: every mote kind, and every socket and effect prop recipe', () => {
		for (const m of MOTES) expect(RECIPE_IDS).toContain(MOTE_RECIPE[m]);
		for (const f of FX_RECIPES) expect(RECIPE_IDS).toContain(FX_LOOP[f]);
	});
});

describe('moteAnchors', () => {
	const at = { x: 1.2, z: -2.1 };
	it('are the tier’s count of loops, nearest the target first, on the world’s lattice', () => {
		for (const tier of ['low', 'medium', 'high'] as const) {
			const anchors = moteAnchors('cavern-motes', tier, at, grid, ground);
			expect(anchors.length).toBeGreaterThan(0);
			expect(anchors.length).toBeLessThanOrEqual(Math.floor(MOTE_COUNTS[tier] / 40));
			const d = anchors.map((a) => Math.hypot(a.x - at.x, a.z - at.z));
			expect(d).toEqual([...d].sort((a, b) => a - b));
		}
		const [a] = moteAnchors('spores', 'low', at, grid, ground);
		expect((a.x / 8) % 1).toBeCloseTo(0.5);
	});

	it('stay put as the target moves within a lattice cell, and keep to the grid', () => {
		const a = moteAnchors('spores', 'medium', { x: 1.2, z: -2.1 }, grid, ground);
		const b = moteAnchors('spores', 'medium', { x: 1.9, z: -1.6 }, grid, ground);
		const key = (l: { x: number; z: number }[]) => l.map((p) => `${p.x},${p.z}`).sort();
		expect(key(b)).toEqual(key(a));
		for (const p of moteAnchors('spores', 'high', { x: -17, z: -13 }, grid, ground)) {
			expect(worldToGrid(grid, p)).not.toBeNull();
		}
	});
});

describe('fireflyLoops', () => {
	const grass = Uint16Array.from(
		{ length: 300 },
		(_, i) => 10 * 36 + 5 + (i % 25) + 36 * Math.floor(i / 25)
	);
	it('light a share of the known grass near the target, the same every time, over the grass only', () => {
		const a = fireflyLoops(grass, 'high', { x: -1, z: 0 }, grid, ground);
		expect(a.length).toBeGreaterThan(5);
		expect(a).toEqual(fireflyLoops(grass, 'high', { x: -1, z: 0 }, grid, ground));
		const cells = new Set(grass);
		for (const l of a) {
			const c = worldToGrid(grid, l.origin)!;
			expect(cells.has(c.y * 36 + c.x)).toBe(true);
		}
		expect(fireflyLoops(new Uint16Array(), 'high', { x: -1, z: 0 }, grid, ground)).toEqual([]);
	});

	it('hold to the tier’s count', () => {
		const lots = Uint16Array.from({ length: 36 * 28 }, (_, i) => i);
		expect(fireflyLoops(lots, 'low', { x: 0, z: 0 }, grid, ground).length).toBeLessThanOrEqual(50);
	});
});

describe('sockets', () => {
	it('turn with the prop’s quarter turns and scale with it', () => {
		const prop = { assetId: 'stove' as const, pos: { x: 4, y: 6 }, rotation: 0 as const, scale: 1 };
		const c = gridToWorld(grid, prop.pos);
		expect(socketPoint(prop, [0, 1.45, 0], grid, ground)).toEqual({ x: c.x, y: 1.45, z: c.z });
		const east = socketPoint({ ...prop, rotation: 1 }, [0.3, 1, 0], grid, ground);
		expect(east.x).toBeCloseTo(c.x);
		expect(Math.abs(east.z - c.z)).toBeCloseTo(0.3);
		expect(socketPoint({ ...prop, scale: 2 }, [0, 1, 0], grid, ground).y).toBe(2);
	});
});

describe('tints', () => {
	it('step the aura’s hue: its own colour is step 0, a grey none, another hue another step', () => {
		expect(hueStep(undefined)).toBe(0);
		expect(hueStep('#808080')).toBe(0);
		expect(hueStep('#8a5cf0')).toBe(0);
		expect(hueStep('#e03030')).not.toBe(0);
		expect(hueStep('#e03030')).not.toBe(hueStep('#30c040'));
		const seed = tintSeed('p1', '#e03030');
		expect(seed).toBeLessThan(4096);
		expect(Math.floor(seed / 256)).toBe(hueStep('#e03030'));
	});
});

describe('lightning', () => {
	it('strikes once a slot, 4 s apart at the least, at the same moments every time', () => {
		for (const seed of [1, 99, 123456]) {
			const times = Array.from({ length: 200 }, (_, s) => strikeTime(seed, s));
			for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(4000);
			for (const t of times.slice(0, 20)) {
				expect(strikeDue(seed, t + 10)).toBe(Math.floor(t / STRIKE_SLOT_MS));
				expect(strikeDue(seed, t - 10)).toBeNull();
				expect(strikeDue(seed, t + 400)).toBeNull(); // late: skipped
			}
		}
	});

	it('leaves more than a third of a second between flashes whatever the props (the gap rule)', () => {
		expect(STRIKE_GAP_MS).toBeGreaterThan(1000 / 3);
	});

	it('draws a bolt from high above its base down to it, the same on every client', () => {
		const base = { x: 10, y: 0.2, z: 10 };
		const pts = boltPoints(7, 3, base, 1);
		expect(pts).toEqual(boltPoints(7, 3, base, 1));
		expect(pts).not.toEqual(boltPoints(7, 4, base, 1));
		expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(base.y + BOLT_HEIGHT);
		expect(pts[pts.length - 1].y).toBeLessThan(base.y + BOLT_HEIGHT);
		expect(pts.length).toBeGreaterThan(40);
	});
});
