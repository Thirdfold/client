// The Hollow Bell's four tables are dressed (M76, #335): painted floors, grass, roofs, more props,
// light looks. Dressing is presentation only, so every rule the tables set must stay exactly as
// it was before: this spec freezes those rules (`dressing.frozen.json`, made from the undressed
// builders with `FREEZE_DRESSING=1`) and compares the dressed tables to them.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOLID_FLOORS, decodeFloor } from '../../src/lib/game/floor';
import type { GridPos } from '../../src/lib/game/grid';
import { lavaSources, lightSources, litMask, type Light } from '../../src/lib/game/lights';
import { ASSETS, MAX_PROPS_PER_ROOM, footprintCells, obstaclesFor } from '../../src/lib/game/props';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { decodeLevels } from '../../src/lib/game/terrain';
import { cellIndex } from '../../src/lib/game/visibility';
import { bellweatherScene } from '../adventures/hollow-bell/bellweather';
import { heartScene } from '../adventures/hollow-bell/heart';
import { hollowScene } from '../adventures/hollow-bell/hollow';
import { monasteryScene } from '../adventures/hollow-bell/monastery';
import { NPCS } from '../adventures/hollow-bell/npcs';

const NOW = new Date('2026-01-01T00:00:00Z');
const FROZEN = new URL('./dressing.frozen.json', import.meta.url);

const TABLES: Record<string, () => SceneFile> = {
	bellweather: () => bellweatherScene(NOW),
	monastery: () => monasteryScene(NOW),
	hollow: () => hollowScene(NOW),
	heart: () => heartScene(NOW)
};

const b64 = (a: Uint8Array | null | undefined) => (a ? Buffer.from(a).toString('base64') : null);

/** Everything a table's rules read, as plain data: what dressing must never change. */
function rules(scene: SceneFile) {
	const { grid } = scene;
	const size = grid.width * grid.height;
	const levels = scene.terrain ? decodeLevels(scene.terrain, size) : null;
	const floor = scene.floor ? decodeFloor(scene.floor, size) : null;
	const ob = obstaclesFor(grid, scene.objects, scene.props, levels, floor);
	const lights = scene.lights.map(({ id, pos, radius, color, on }) => ({
		id,
		pos,
		radius,
		color,
		on
	}));
	const lava = lavaSources(grid, floor);
	const lit = (ls: Light[]) => b64(litMask(grid, ob, lightSources(ls, [], lava)));
	return {
		ambient: scene.ambient,
		sun: scene.world.sun,
		grid,
		objects: scene.objects,
		tokens: scene.tokens,
		terrain: scene.terrain,
		darkness: scene.darkness,
		revealed: scene.fog.revealed,
		solidFloor: [...(floor ?? [])].flatMap((v, i) => (SOLID_FLOORS.has(v) ? [i] : [])),
		edges: [...ob.edges].sort(),
		windows: [...(ob.windows ?? [])].sort(),
		solid: b64(ob.solid),
		opaque: b64(ob.opaque),
		levels: b64(ob.levels),
		lights,
		litOn: lit(scene.lights),
		litAll: lit(scene.lights.map((l) => ({ ...l, on: true })))
	};
}

/** Every prop's place, as the story knows it. */
const placed = (scene: SceneFile) =>
	scene.props.map(({ id, assetId, pos, rotation, scale }) => ({
		id,
		assetId,
		pos,
		rotation,
		scale
	}));

if (process.env.FREEZE_DRESSING) {
	const out: Record<string, unknown> = {};
	for (const [name, build] of Object.entries(TABLES))
		out[name] = { ...rules(build()), props: placed(build()) };
	writeFileSync(FROZEN, JSON.stringify(out) + '\n');
}

const frozen = JSON.parse(readFileSync(FROZEN, 'utf8')) as Record<
	string,
	ReturnType<typeof rules> & { props: ReturnType<typeof placed> }
>;

/** Cells the story stands people on, in any state or fight (the NPCs' places). */
function peopleCells(table: string): GridPos[] {
	return Object.values(NPCS)
		.filter((n) => n.location === table)
		.flatMap((n) => Object.values(n.places ?? {}) as GridPos[]);
}

for (const [name, build] of Object.entries(TABLES)) {
	describe(`${name} dressed`, () => {
		const scene = build();
		const now = rules(scene);
		const before = frozen[name];
		const grid = scene.grid;

		it('keeps every rule as it was: walls, doors, windows, levels, blocking, rule lights', () => {
			expect(now).toEqual({ ...before, props: undefined });
		});

		it('keeps every earlier prop where it was, as what it was (or a new look of the same footprint and blocking)', () => {
			const byId = new Map(placed(scene).map((p) => [p.id, p]));
			for (const p of before.props) {
				const now = byId.get(p.id);
				expect(now, p.id).toBeDefined();
				expect({ ...now, assetId: undefined }, p.id).toEqual({ ...p, assetId: undefined });
				// A look swap (M76: a realistic model of its own for this story) changes the id, never the rules.
				const [was, is] = [ASSETS[p.assetId], ASSETS[now!.assetId]];
				expect(
					{ w: is.w, h: is.h, blocks: is.blocks },
					`${p.id}: ${p.assetId} -> ${now!.assetId}`
				).toEqual({
					w: was.w,
					h: was.h,
					blocks: was.blocks
				});
			}
		});

		it('adds only props that block nothing, off every earlier prop, person and token', () => {
			const old = new Set(before.props.map((p) => p.id));
			const taken = new Set<number>();
			const take = (c: GridPos) => taken.add(cellIndex(grid, c));
			for (const p of scene.props) if (old.has(p.id)) footprintCells(p).forEach(take);
			for (const t of scene.tokens) take(t.pos);
			peopleCells(name).forEach(take);
			const added = scene.props.filter((p) => !old.has(p.id));
			expect(added.length).toBeGreaterThan(0);
			for (const p of added) {
				expect(ASSETS[p.assetId].blocks, p.id).toBe('none');
				for (const c of footprintCells(p)) {
					expect(c.x >= 0 && c.y >= 0 && c.x < grid.width && c.y < grid.height, p.id).toBe(true);
					expect(taken.has(cellIndex(grid, c)), `${p.id} at ${c.x},${c.y}`).toBe(false);
				}
			}
		});

		it('paints no floor nobody can stand on', () => {
			const floor = scene.floor ? decodeFloor(scene.floor, grid.width * grid.height) : null;
			expect(floor?.some((v) => SOLID_FLOORS.has(v)) ?? false).toBe(false);
		});

		it('leaves room for hazards and the GM under the prop cap', () => {
			// Up to five cracks per standing character (four of them), and some for the GM.
			expect(scene.props.length).toBeLessThanOrEqual(MAX_PROPS_PER_ROOM - 20 - 40);
		});
	});
}
