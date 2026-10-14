import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, withFloor } from '$lib/game/floor';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import { lavaSources, litMask, renderedReach, type LightSource } from '$lib/game/lights';
import { blockingEdges, type Obstacles, type SceneObject } from '$lib/game/objects';
import { emptyMask, SightCache } from '$lib/game/visibility';
import { bounceField, buildLists, isGlowId } from './grid-lights';
import { GLOW_BLOCK, GLOW_RADIUS, glowCut, glowLights, lavaGlows } from './lava-glow';

const K = 16;
const wall = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'wall',
	a,
	b,
	window: false
});
const obstacles = (grid: SquareGrid, objects: SceneObject[] = []): Obstacles => ({
	edges: blockingEdges(objects),
	windows: new Set(),
	width: grid.width,
	solid: null,
	opaque: null,
	levels: null
});
const lava = (grid: SquareGrid, cells: GridPos[]) => {
	let floor: Uint8Array | null = null;
	for (const c of cells) floor = withFloor(floor, grid, c, c, 'lava');
	return floor;
};

/** The glows' lights and lists over `real` lights (none), as `GridLighting` lists them. */
function glowLit(
	grid: SquareGrid,
	blocked: Obstacles,
	floor: Uint8Array | null,
	real: LightSource[] = []
) {
	const base = new SightCache().use(grid, blocked);
	const glow = glowLights(grid, blocked, base, floor!, { signature: '', masks: new Map() });
	const shown = [...real.map((source) => ({ source })), ...glow.lit];
	const lists = buildLists(grid, glow.cache, real, K);
	glow.fill(grid, lists, K, real.length, shown);
	const lit = emptyMask(grid);
	for (let c = 0; c < lit.length; c++) {
		for (let j = 0; j < K; j++) if (lists[c * K + j] > real.length) lit[c] = 1;
	}
	return { glow, lists, lit, sources: glow.lit.map((g) => g.source) };
}

describe('lavaGlows (#297)', () => {
	const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 10, height: 8 };

	it('makes one glow light per 3x3 block of lava, at the block centre, in block order', () => {
		const floor = lava(grid, [
			{ x: 0, y: 0 },
			{ x: 2, y: 2 },
			{ x: 4, y: 1 },
			{ x: 9, y: 7 }
		]);
		const glows = lavaGlows(grid, floor);
		expect(glows.map((g) => g.source.pos)).toEqual([
			{ x: 1, y: 1 },
			{ x: 4, y: 1 },
			{ x: 9, y: 7 } // a block the map's edge cuts short: its last cell
		]);
		expect(glows.map((g) => g.cells.length)).toEqual([2, 1, 1]);
		for (const { source } of glows) {
			expect(source).toMatchObject({ kind: 'glow', radius: GLOW_RADIUS, color: '#ff5a1f' });
			expect(isGlowId(source.id ?? '')).toBe(true);
		}
		expect(new Set(glows.map((g) => g.source.id)).size).toBe(3);
	});

	it('is nothing without lava, or with a floor the wrong size', () => {
		expect(lavaGlows(grid, null)).toEqual([]);
		expect(lavaGlows(grid, new Uint8Array(grid.width * grid.height))).toEqual([]);
		expect(lavaGlows(grid, new Uint8Array(3).fill(FLOOR_IDS.indexOf('lava')))).toEqual([]);
	});

	it("reaches every cell a block's lava lights (its lava is within √2 of the centre)", () => {
		expect(GLOW_BLOCK).toBe(3);
		expect(GLOW_RADIUS).toBeGreaterThanOrEqual(Math.ceil(Math.SQRT2 + Math.sqrt(6)));
	});
});

describe('the glows stay inside the rules (#297)', () => {
	const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 20, height: 16 };

	it('light exactly the cells the lava lights by the rules, in the open', () => {
		const blocked = obstacles(grid);
		const floor = lava(grid, [
			...[3, 4, 5, 6].flatMap((x) => [2, 3].map((y) => ({ x, y }))),
			{ x: 12, y: 9 },
			{ x: 19, y: 15 },
			{ x: 0, y: 8 }
		]);
		const { lit } = glowLit(grid, blocked, floor);
		const rules = litMask(grid, blocked, lavaSources(grid, floor));
		expect(lit).toEqual(rules);
		expect(rules.some((v) => v)).toBe(true);
	});

	it('never light through a wall, and never a cell the rules leave dark', () => {
		const blocked = obstacles(grid, [
			wall('v', { x: 6, y: 0 }, { x: 6, y: 16 }),
			wall('h', { x: 8, y: 8 }, { x: 20, y: 8 })
		]);
		// Lava either side of the wall x = 6 in one block, and either side of the wall y = 8.
		const floor = lava(grid, [
			{ x: 5, y: 4 },
			{ x: 6, y: 4 },
			{ x: 10, y: 7 },
			{ x: 10, y: 8 }
		]);
		const { lit } = glowLit(grid, blocked, floor);
		const rules = litMask(grid, blocked, lavaSources(grid, floor));
		expect(lit).toEqual(rules);
		// The block (6, 3 to 8, 5) holds (6, 4); (5, 4) is in the block before it. Neither glow
		// lights across the wall to the other lava's side.
		const at = (x: number, y: number) => y * grid.width + x;
		const [left, right] = lavaGlows(grid, floor).filter((g) => g.cells.some((c) => c.y === 4));
		expect(glowCut(grid, blocked, left)[at(7, 4)]).toBe(0);
		expect(glowCut(grid, blocked, right)[at(4, 4)]).toBe(0);
	});

	it('hold on random lava and walls, and the bounce stays on cells the rules light', () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const open = new Uint8Array(grid.width * grid.height).fill(15);
		const albedo = new Float32Array(grid.width * grid.height * 3).fill(0.5);
		for (let round = 0; round < 12; round++) {
			const cells = Array.from({ length: 4 + Math.floor(rand() * 30) }, () => ({
				x: Math.floor(rand() * grid.width),
				y: Math.floor(rand() * grid.height)
			}));
			const walls = Array.from({ length: 3 }, (_, i) => {
				const a = { x: Math.floor(rand() * grid.width), y: Math.floor(rand() * grid.height) };
				return wall(`w${i}`, a, { x: a.x + (i % 2 ? 0 : 4), y: a.y + (i % 2 ? 4 : 0) });
			});
			const blocked = obstacles(grid, walls);
			const floor = lava(grid, cells);
			const rules = litMask(grid, blocked, lavaSources(grid, floor));
			const { glow, lit, sources } = glowLit(grid, blocked, floor);
			expect(lit, `round ${round}`).toEqual(rules);
			const bounce = bounceField(grid, glow.cache, sources, albedo, open);
			for (let c = 0; c < rules.length; c++) {
				if (!rules[c])
					expect([...bounce.slice(c * 3, c * 3 + 3)], `bounce ${round}/${c}`).toEqual([0, 0, 0]);
			}
		}
	});

	it("keep every cell they light inside the light's window", () => {
		const blocked = obstacles(grid);
		const floor = lava(grid, [
			{ x: 3, y: 3 },
			{ x: 4, y: 4 },
			{ x: 5, y: 5 },
			{ x: 3, y: 5 },
			{ x: 5, y: 3 }
		]);
		const reach = renderedReach(GLOW_RADIUS);
		for (const glow of lavaGlows(grid, floor)) {
			const cut = glowCut(grid, blocked, glow);
			for (let c = 0; c < cut.length; c++) {
				if (!cut[c]) continue;
				const dx = (c % grid.width) - glow.source.pos.x;
				const dy = Math.floor(c / grid.width) - glow.source.pos.y;
				expect(Math.hypot(dx, dy)).toBeLessThan(reach);
			}
		}
	});

	it('rank below every other light on a cell, and displace none', () => {
		const blocked = obstacles(grid);
		const floor = lava(grid, [{ x: 4, y: 4 }]);
		const torch: LightSource = { pos: { x: 8, y: 4 }, radius: 5, color: '#ffa04d', intensity: 0.1 };
		const base = new SightCache().use(grid, blocked);
		const glow = glowLights(grid, blocked, base, floor!, { signature: '', masks: new Map() });
		const lists = buildLists(grid, glow.cache, [torch], 1);
		glow.fill(grid, lists, 1, 1, [{ source: torch }, ...glow.lit]);
		// On a cell both reach, the one slot stays the torch's, though the glow is far brighter there.
		expect(lists[4 * grid.width + 6]).toBe(1);
		// Where only lava reaches, the glow is listed (index 2).
		expect(lists[4 * grid.width + 2]).toBe(2);
		// With room (K slots), both are listed, the torch first.
		const roomy = buildLists(grid, glow.cache, [torch], 4);
		glow.fill(grid, roomy, 4, 1, [{ source: torch }, ...glow.lit]);
		const at = (4 * grid.width + 6) * 4;
		expect([...roomy.subarray(at, at + 3)]).toEqual([1, 2, 0]);
	});
});
