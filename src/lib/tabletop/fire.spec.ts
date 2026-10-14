import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { lightLook, type Light } from '$lib/game/lights';
import type { Token } from '$lib/game/token';
import { FireLayer, fireLoops, fireSources, type Fire } from './fire';
import { litSources } from './grid-light-layer';
import type { LightEntry } from './grid-lights';
import { flickerPhase, flickerProfile } from './light-model';
import { RECIPES, flameSeed, PHASES } from './vfx-recipes';
import { SEEDS, VfxState, type LoopSpec } from './vfx-state';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 8, height: 8 };
const light = (id: string, x: number, y: number, over: Partial<Light> = {}): Light => ({
	id,
	pos: { x, y },
	radius: 3,
	color: '#ffa04d',
	on: true,
	...over
});
const carrier = {
	id: 'k',
	pos: { x: 6, y: 6 },
	light: 2,
	lightColor: '#6fe08a'
} as unknown as Token;

/** The GridLight entries for `litSources`, one each, at the cell's middle a metre up. */
function entries(lit: ReturnType<typeof litSources>): LightEntry[] {
	return lit.map(({ id, source }) => ({
		id,
		ruleOrigin: source.pos,
		visual: { x: source.pos.x - 4 + 0.5, y: 1, z: source.pos.y - 4 + 0.5 },
		reach: 3,
		colour: [1, 1, 1],
		intensity: 1,
		profile: flickerProfile(lightLook(source).flicker),
		phase: flickerPhase(id),
		flags: 0
	}));
}

function sources(lights: Light[], tokens: Token[] = [], seats = new Map<number, number>()) {
	const lit = litSources(lights, tokens);
	return fireSources(
		grid,
		lit,
		entries(lit),
		lit.map((_, i) => i),
		seats
	);
}

describe('fireSources', () => {
	it('is exactly the lights that are on and burn, and the tokens carrying light', () => {
		const fires = sources(
			[
				light('torch', 1, 1),
				light('candle', 2, 1, { kind: 'candle' }),
				light('brazier', 3, 1, { kind: 'brazier' }),
				light('lantern', 4, 1, { kind: 'lantern' }),
				light('floor-fire', 5, 1, { kind: 'fire' }),
				light('off', 1, 2, { on: false }),
				light('glow', 2, 2, { kind: 'glow' }),
				light('magic', 3, 2, { kind: 'magic' }),
				light('neon', 4, 2, { kind: 'neon' }),
				light('panel', 5, 2, { kind: 'panel' })
			],
			[carrier]
		);
		expect(fires.map((f) => f.id)).toEqual([
			'torch',
			'candle',
			'brazier',
			'lantern',
			'floor-fire',
			'k'
		]);
		expect(fires.find((f) => f.id === 'k')).toMatchObject({ carried: true, kind: 'torch' });
	});

	it('gives a light with no fixture a flame only as a floor fire or on a prop that holds it', () => {
		const bare = light('bare', 1, 1, { fixture: false });
		expect(sources([bare])).toEqual([]);
		expect(sources([light('pit', 1, 1, { kind: 'fire' })]).map((f) => f.id)).toEqual(['pit']);
		const seated = new Map([[1 * grid.width + 1, 0.5]]);
		expect(sources([bare], [], seated).map((f) => f.id)).toEqual(['bare']);
		// The seat is its cell's, not another's.
		expect(sources([light('far', 5, 5, { fixture: false })], [], seated)).toEqual([]);
	});

	it('stands each flame where its light is drawn, with its flicker', () => {
		const [fire] = sources([light('t', 2, 3)]);
		const [entry] = entries(litSources([light('t', 2, 3)], []));
		expect([fire.x, fire.y, fire.z]).toEqual([entry.visual.x, entry.visual.y, entry.visual.z]);
		expect([fire.profile, fire.phase]).toEqual([entry.profile, entry.phase]);
	});

	it('leaves out lava glows and one light drawn twice', () => {
		const lit = litSources([light('lava:0,0', 1, 1), light('t', 2, 2)], []);
		const [a, b] = entries(lit);
		expect(fireSources(grid, lit, [a, b, b], [0, 1, 1], new Map()).map((f) => f.id)).toEqual(['t']);
	});
});

describe('fireLoops', () => {
	const fire = (kind: Fire['kind'], carried = false): Fire => ({
		id: 'f',
		kind,
		x: 0,
		y: 1,
		z: 0,
		profile: 3,
		phase: 0.25,
		carried
	});
	const names = (f: Fire, tier: 'low' | 'medium' | 'high', still = false) =>
		[...fireLoops(f, tier, still).entries()].map(([id, l]) => `${id.split(':')[2]}=${l.recipe}`);

	it('burns a flame breathing with its light, embers by tier, smoke on medium and up', () => {
		expect(names(fire('brazier'), 'low')).toEqual(['flame=flame', 'embers=embersLow']);
		expect(names(fire('brazier'), 'medium')).toEqual([
			'flame=flame',
			'embers=embers',
			'smoke=fireSmoke'
		]);
		expect(names(fire('fire'), 'high')).toContain('embers=embersHigh');
		const [flame] = [...fireLoops(fire('torch'), 'low', false).values()];
		expect(flame.seed).toBe(flameSeed(3, 0.25));
		expect(RECIPES.flame.breathe).toBe(1);
	});

	it('gives lanterns and candles a small flame and no embers, and a torch no smoke', () => {
		expect(names(fire('lantern'), 'high')).toEqual(['flame=flameSmall']);
		expect(names(fire('candle'), 'high')).toEqual(['flame=flameSmall']);
		expect(names(fire('torch'), 'high')).toEqual(['flame=flame', 'embers=embersHigh']);
		expect(names(fire('torch', true), 'high')[0]).toBe('flame=flameSmall');
	});

	it('under reduced motion keeps the flame alone', () => {
		expect(names(fire('brazier'), 'high', true)).toEqual(['flame=flame']);
	});

	it('packs a profile and phase into a seed that stays under SEEDS and unpacks to them', () => {
		for (const profile of [0, 3, 5])
			for (const phase of [0, 0.5, 0.999]) {
				const seed = flameSeed(profile, phase);
				expect(seed).toBeLessThan(SEEDS);
				expect(Math.floor(seed / PHASES)).toBe(profile);
				expect((seed - profile * PHASES) / PHASES).toBeCloseTo(phase, 2);
			}
	});
});

describe('FireLayer', () => {
	it('lays out one set of loops per update and follows a carrier without rebuilding the rest', () => {
		const state = new VfxState();
		const sink = {
			tier: 'medium' as const,
			heat: { setFires: () => {} },
			syncLoops: (prefix: string, wanted: ReadonlyMap<string, LoopSpec>) =>
				state.syncLoops(prefix, wanted)
		};
		const layer = new FireLayer(sink);
		const lit = litSources([light('t', 1, 1), light('b', 3, 3, { kind: 'brazier' })], [carrier]);
		const list = entries(lit);
		const order = lit.map((_, i) => i);
		layer.update(grid, lit, list, order, new Map(), false);
		// t: flame + embers; b: flame + embers + smoke; k: small flame + embers.
		expect(state.stats(0).loops).toBe(7);
		// The mini glides: only its flame is laid out again.
		list[2].visual = { x: 2, y: 1, z: 2 };
		layer.follow();
		expect(state.stats(0).loops).toBe(7);
		// The light goes out: its loops stop.
		const rest = litSources([light('t', 1, 1)], []);
		layer.update(grid, rest, entries(rest), [0], new Map(), false);
		expect(state.stats(0).loops).toBe(2);
		layer.dispose();
		expect(state.stats(0).loops).toBe(0);
	});
});
