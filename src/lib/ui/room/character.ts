import type { Action, CharacterDef, StatId } from '$lib/adventure/characters';
import type { IconName } from '$lib/ui/game';

/** What each stat looks like on its engraved plate. */
export const STAT_ICON: Record<StatId, IconName> = {
	might: 'sword',
	agility: 'sparkle',
	wits: 'eye',
	spirit: 'star'
};

/** The glyph on an ability's slot: what it does, then what it leaves behind. */
export function actionIcon(action: Action): IconName {
	if (action.applies?.status === 'burning') return 'flame';
	if (action.applies?.status === 'slowed') return 'hourglass';
	if (action.kind === 'heal') return 'heart';
	if (action.kind === 'guard') return 'shield';
	return action.range > 1 ? 'wand' : 'sword';
}

/** A trait a character is known for, with its icon (derived from what their actions do). */
export interface Trait {
	icon: IconName;
	label: string;
}

export function traitsOf(character: CharacterDef): Trait[] {
	const found = new Map<string, Trait>();
	const add = (t: Trait) => found.set(t.label, t);
	for (const a of character.actions) {
		if (a.kind === 'guard') add({ icon: 'shield', label: 'Guards allies' });
		else if (a.kind === 'heal') add({ icon: 'heart', label: 'Heals' });
		else add(a.range > 1 ? { icon: 'wand', label: 'Ranged' } : { icon: 'sword', label: 'Melee' });
		if (a.applies?.status === 'burning') add({ icon: 'flame', label: 'Burns' });
		if (a.applies?.status === 'slowed') add({ icon: 'hourglass', label: 'Slows' });
	}
	if (character.light > 0) add({ icon: 'flame', label: 'Carries a light' });
	return [...found.values()];
}

/** A plain word for the part a character plays at the table. */
export function roleOf(character: CharacterDef): string {
	if (character.actions.some((a) => a.kind === 'guard')) return 'Defender';
	if (character.actions.some((a) => a.kind === 'heal')) return 'Healer';
	if (character.actions.some((a) => a.kind === 'attack' && a.range > 1)) return 'Caster';
	return 'Striker';
}
