// The built-in adventures' tables, frozen as fixtures (milestone 61): the
// village, monastery and Hollow played to with the engine (server/perf/
// scenes.ts), the Heart, the night train and Blackwater. They are written
// once and only rewritten with `build.ts --refreeze`, so story changes never
// move the golden images drawn from them.

import type { GridPos } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import {
	BLACKWATER_SPAWN,
	blackwaterScene,
	TRAIN_SPAWN,
	trainScene
} from '../adventures/blackwater/tables';
import { HEART_SPAWN, heartScene } from '../adventures/hollow-bell/heart';
import { perfScenes } from '../perf/scenes';
import {
	FIXTURE_DATE,
	mini,
	sidecar,
	WIDE,
	type Fixture,
	type FixtureSidecar,
	type PoseOverrides
} from './compositions';
import { FIXTURE_PLAYER } from './views';

const OWNER = { id: 'fixture-p1', name: FIXTURE_PLAYER };

/** A story table: the token Ana plays is the fogged player's. */
function played(name: string, scene: SceneFile): Fixture {
	const hero = scene.tokens.find((t) => t.owner?.name === FIXTURE_PLAYER);
	if (!hero) throw new Error(`${scene.name}: nobody plays as ${FIXTURE_PLAYER}`);
	return {
		scene: { ...scene, savedAt: FIXTURE_DATE.toISOString() },
		sidecar: frozenSidecar(name, scene, hero.id)
	};
}

/** A table without its party: two minis at the spawn, the first Ana's. */
function party(scene: SceneFile, prefix: string, spawn: readonly GridPos[]): Fixture {
	const heroes = [
		{ ...mini(`${prefix}-mini-hero`, 'Warden', spawn[0].x, spawn[0].y, 'warden', 1), owner: OWNER },
		mini(`${prefix}-mini-b`, 'Saint', spawn[1].x, spawn[1].y, 'saint', 2)
	];
	return {
		scene: { ...scene, savedAt: FIXTURE_DATE.toISOString(), tokens: [...scene.tokens, ...heroes] },
		sidecar: frozenSidecar(prefix, { ...scene, tokens: heroes }, heroes[0].id)
	};
}

/** What the frozen tables frame differently: the monastery's overview is reference 2's wide shot. */
const OVERRIDES: Record<string, PoseOverrides> = { monastery: { overview: WIDE } };

/**
 * A frozen table's sidecar: the poses (#280) on its fogged player's token. Unlike the table it is
 * made again by every build, so the poses follow their form without refreezing the table.
 */
export function frozenSidecar(name: string, scene: SceneFile, tokenId: string): FixtureSidecar {
	const hero = scene.tokens.find((t) => t.id === tokenId);
	if (!hero) throw new Error(`${name}: no token ${tokenId}`);
	return sidecar(scene.grid, scene.ambient, tokenId, hero.pos, undefined, OVERRIDES[name]);
}

export function frozenFixtures(): Record<string, Fixture> {
	const { village, monastery, hollow } = perfScenes();
	return {
		village: played('village', village),
		monastery: played('monastery', monastery),
		hollow: played('hollow', hollow),
		heart: party(heartScene(FIXTURE_DATE), 'heart', HEART_SPAWN),
		railcar: party(trainScene(), 'railcar', TRAIN_SPAWN),
		'ghost-town': party(blackwaterScene(), 'ghost-town', BLACKWATER_SPAWN)
	};
}
