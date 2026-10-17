<script lang="ts">
	import {
		canReach,
		inActionRange,
		INVESTIGATION_ACTIONS,
		PHYSICAL_ACTIONS,
		type AdventureView,
		type CharacterStatus,
		type CheckView,
		type ConditionMark,
		type Sense
	} from '$lib/adventure/adventure';
	import { BLEED_OUT_ROUNDS, type Action } from '$lib/adventure/characters';
	import { gridDistance } from '$lib/game/grid';
	import type { Blockers } from '$lib/game/objects';
	import type { Token } from '$lib/game/token';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon, type IconName } from '$lib/ui/game';
	import DiceSlot from './hud/DiceSlot.svelte';

	interface Props {
		adventure: AdventureView;
		character: CharacterStatus;
		/** The character's token (always visible to its own player). */
		token: Token;
		tokens: readonly Token[];
		blocked: Blockers;
		/** The action waiting for a target, if one was picked. */
		targeting: string | null;
		onTargeting(actionId: string | null): void;
		onSheet(): void;
		send(action: RoomAction): boolean;
		/** The slot level a spell being aimed is cast with; null for the lowest it can. */
		slot?: number | null;
	}

	let {
		adventure,
		character,
		token,
		tokens,
		blocked,
		targeting,
		onTargeting,
		onSheet,
		send,
		slot = $bindable(null)
	}: Props = $props();

	const def = $derived(character.def);
	const encounter = $derived(adventure.encounter);
	/** The turn's action is spent (other parts of a turn, a bonus action, may be left). */
	const acted = $derived(character.spent.includes('action'));
	/** An action as the rules show it: its summary and the part of a turn it takes. */
	const cardOf = (action: Action) =>
		character.card.actions.find((a) => a.id === action.id) ?? {
			id: action.id,
			summary: action.about,
			part: 'action',
			partName: 'Action'
		};
	const able = $derived(!character.downed && !character.dead);
	/** Whose turn it is, in a fight. */
	const up = $derived(encounter ? encounter.order[encounter.current] : undefined);
	const isMine = $derived(!!encounter && up?.characterId === character.id);
	const movesLeft = $derived(
		encounter
			? isMine
				? Math.max(0, encounter.speed - (encounter.moved[character.id] ?? 0))
				: 0
			: null
	);
	/** The character can use an action now: its turn, and it hasn't yet. */
	const myTurn = $derived(isMine && !acted && able);
	/** What is in reach to use; in a fight only what can be done in one (a torch, the Bell's rope), on this character's turn, as its action. */
	const nearby = $derived(
		!able || adventure.stage !== 'playing' || (encounter && !myTurn)
			? []
			: adventure.interactables.filter(
					(i) =>
						(!encounter || i.verbs.some((v) => v.inFight)) &&
						(i.carried || canReach(blocked, token.pos, i.cells))
				)
	);
	/** Things put down beside the character, to pick up (on its turn, in a fight). */
	const piles = $derived(
		!able || adventure.stage === 'choosing' || (encounter && !isMine)
			? []
			: adventure.piles.filter((p) => gridDistance(token.pos, p.cell) <= 1)
	);
	/** Actions that make sense now: everything in a fight, only healing outside one. */
	const actions = $derived(
		!able || adventure.stage !== 'playing'
			? []
			: def.actions.filter((a) => (encounter ? true : a.kind === 'heal'))
	);
	/** The character's own actions, and what the rules let every character do (Dash, Dodge, …). */
	const own = $derived(actions.filter((a) => a.kind !== 'maneuver'));
	const common = $derived(actions.filter((a) => a.kind === 'maneuver'));
	const chosen = $derived(actions.find((a) => a.id === targeting) ?? null);
	/** A spell's aim, if the chosen action is a spell. */
	const aim = $derived(chosen?.cast ?? null);
	/** Targets picked so far, for a spell that takes several. */
	let picked = $state<string[]>([]);
	$effect(() => {
		// A new action to aim starts afresh.
		void targeting;
		picked = [];
		slot = null;
	});
	/** Slot levels a levelled spell may be cast at, with how many of each are left. */
	const slotLevels = $derived(
		aim && aim.level > 0
			? Array.from({ length: aim.upTo - aim.level + 1 }, (_, i) => {
					const level = aim.level + i;
					const left = (character.card.resources ?? [])
						.filter(
							(r) =>
								r.id === `spell-slots-${level}` ||
								(r.id === 'pact-slots' && r.name.includes(`level ${level}`))
						)
						.reduce((n, r) => n + r.max - (character.resourcesSpent[r.id] ?? 0), 0);
					return { level, left };
				})
			: []
	);
	/** How many targets the spell takes at the chosen slot. */
	const maxTargets = $derived(
		aim ? aim.targets + aim.perLevel * Math.max(0, (slot ?? aim.level) - aim.level) : 1
	);
	const castOf = (targets: string[]) => (aim ? { cast: { slot, targets, at: null } } : {});
	/** Listening and looking around work anywhere, outside a fight. */
	const canSense = $derived(able && !encounter && adventure.stage === 'playing');
	const SENSES: Sense[] = ['listen', 'observe'];

	/** "Wits check (d20+2 vs 8)": the test and difficulty, with the character's bonus (by the rules, from the server). */
	function checkText(check: CheckView): string {
		const bonus = check.bonus ? `${check.bonus > 0 ? '+' : ''}${check.bonus}` : '';
		return `${check.label}${check.save ? '' : ' check'} (d20${bonus} vs ${check.dc})`;
	}

	interface Target {
		tokenId: string;
		name: string;
		detail: string;
		inReach: boolean;
	}

	function targetsFor(action: Action): Target[] {
		const at = (id: string | null) => (id ? tokens.find((t) => t.id === id) : undefined);
		if (action.target === 'enemy') {
			return (encounter?.enemies ?? []).flatMap((e) => {
				const t = at(e.tokenId);
				if (!t) return [];
				const inReach = inActionRange(blocked, token.pos, t.pos, action);
				return [{ tokenId: t.id, name: e.name, detail: `${e.hp}/${e.maxHp}`, inReach }];
			});
		}
		return adventure.characters.flatMap((c) => {
			const t = at(c.tokenId);
			if (!t || c.dead) return [];
			const inReach = inActionRange(blocked, token.pos, t.pos, action);
			const detail = c.downed ? 'down' : `${c.hp}/${c.maxHp}`;
			return [{ tokenId: t.id, name: c.def.name, detail, inReach }];
		});
	}

	const canUse = (action: Action) =>
		(encounter ? isMine && able && !character.spent.includes(cardOf(action).part) : true) &&
		character.usesLeft[action.id] !== 0;
	/** Why an action can't be taken now, in words, or '' when it can. */
	function whyNot(action: Action): string {
		if (canUse(action)) return '';
		if (character.usesLeft[action.id] === 0) return `${action.name} is spent until the next fight.`;
		if (!isMine) return `Not ${def.name}'s turn.`;
		return `${def.name} has used this turn's ${cardOf(action).partName.toLowerCase()}.`;
	}
	/** A reaction's state, as its button says it. */
	const REACTION = {
		ready: 'Strikes at foes leaving its reach (an Opportunity Attack). Click to hold it.',
		used: 'Used: back at the start of its turn.',
		held: 'Held: no Opportunity Attacks. Click to let the table take them.'
	} as const;
	/** The parts of this turn still to take ("action", "bonus action"), for the status line. */
	const partsLeft = $derived([
		...new Set([
			...(acted ? [] : ['action']),
			...actions.filter(canUse).map((a) => cardOf(a).partName.toLowerCase())
		])
	]);

	function pick(action: Action) {
		if (action.target === 'self' && !action.cast) {
			send({ type: 'adventure_act', actionId: action.id, targetId: null });
			return onTargeting(null);
		}
		onTargeting(targeting === action.id ? null : action.id);
	}

	function use(action: Action, target: Target) {
		// A spell that takes several targets gathers them first (darts may go to one more than once).
		if (aim && !aim.area && maxTargets > 1) {
			if (!aim.repeat && picked.includes(target.tokenId))
				picked = picked.filter((id) => id !== target.tokenId);
			else if (picked.length < maxTargets) picked = [...picked, target.tokenId];
			return;
		}
		send({
			type: 'adventure_act',
			actionId: action.id,
			targetId: target.tokenId,
			...castOf([])
		});
		onTargeting(null);
	}

	function castPicked(action: Action) {
		send({ type: 'adventure_act', actionId: action.id, targetId: null, ...castOf(picked) });
		onTargeting(null);
	}

	const status = $derived.by(() => {
		if (character.dead) return `${def.name} is dead. The GM can bring them back.`;
		if (character.downed && character.deathSaves) {
			const d = character.deathSaves;
			if (d.stable) return `${def.name} is down but stable: heal them to bring them back.`;
			return `${def.name} is dying: a death save each turn (${d.successes} of 3 successes, ${d.failures} of 3 failures). Heal them, or steady them with first aid.`;
		}
		if (character.downed) {
			const left = BLEED_OUT_ROUNDS - character.downedFor;
			return `${def.name} is down: heal them within ${left} ${left === 1 ? 'round' : 'rounds'}.`;
		}
		if (adventure.stage === 'choosing') return 'Waiting for the GM to begin.';
		if (adventure.stage !== 'playing') return 'The story is over.';
		if (chosen?.cast?.area)
			return `${chosen.name}: click a cell on the map to aim it (${
				chosen.cast.area.shape === 'sphere'
					? `a ${chosen.cast.area.size * 5}-foot-radius sphere there`
					: `a ${chosen.cast.area.size * 5}-foot ${chosen.cast.area.shape} from you`
			}).`;
		if (chosen && maxTargets > 1)
			return chosen.cast?.repeat
				? `${chosen.name}: choose where its ${maxTargets} strikes go (one foe may take several), then cast.`
				: `${chosen.name}: choose up to ${maxTargets} targets, then cast.`;
		if (chosen) return `${chosen.name}: choose a target, here or on the map.`;
		if (!encounter) {
			return nearby.length
				? 'Something here you can use.'
				: 'Click a cell to walk there. Go up to people and things.';
		}
		if (!isMine) return `${up?.name ?? 'Someone else'}'s turn…`;
		const cells = `${movesLeft} ${movesLeft === 1 ? 'cell' : 'cells'} of movement`;
		if (partsLeft.length === 0) return `Your turn: ${cells} left, then end your turn.`;
		const parts = partsLeft.map((p, i) => (i === 0 && p === 'action' ? 'one action' : `a ${p}`));
		return `Your turn: ${cells}${acted ? ' left' : ''}, ${parts.join(' and ')}.`;
	});
	/** What a verb is: how it investigates, or what it physically does. */
	function kindOf(v: AdventureView['interactables'][number]['verbs'][number]): string {
		return v.physical ? PHYSICAL_ACTIONS[v.physical] : INVESTIGATION_ACTIONS[v.action];
	}
	/** A condition's marker, explained: how long, where from, and the rules' words. */
	const conditionTitle = (c: ConditionMark) =>
		`${c.name}: ${c.until} (${c.from}).\n\n${c.text}${c.notPlayed.length ? `\n\nNot played yet: ${c.notPlayed.join('; ')}.` : ''}`;

	/** What the character carries on it that the plate in the corner has no room for: conditions, effects, saves. */
	interface Mark {
		id: string;
		text: string;
		title: string;
		tone: 'ember' | 'brass';
	}
	const marks = $derived.by((): Mark[] => {
		const out: Mark[] = [];
		// Health as its rules count it (stress boxes clear): the plate in the corner shows hit points.
		const h = character.health;
		if (h) {
			out.push({
				id: 'health',
				text: `${h.name} ${h.value}/${h.max}`,
				title: `${h.name}: ${h.value} of ${h.max}`,
				tone: 'brass'
			});
		}
		for (const c of character.conditions) {
			out.push({
				id: `c-${c.effect}-${c.id}`,
				text: `${c.name}${c.level ? ` ${c.level}` : ''}`,
				title: conditionTitle(c),
				tone: 'ember'
			});
		}
		for (const line of character.effects) {
			out.push({ id: `e-${line}`, text: line.split(':')[0], title: line, tone: 'brass' });
		}
		const d = character.deathSaves;
		if (d && !d.stable) {
			out.push({
				id: 'death-saves',
				text: `Death saves ${d.successes} saved, ${d.failures} failed`,
				title: 'Death saves: three successes and it is stable, three failures and it dies',
				tone: 'ember'
			});
		}
		if (character.concentrating) {
			out.push({
				id: 'concentrating',
				text: `Concentrating: ${character.concentrating}`,
				title: 'Concentrating: taking damage may end it',
				tone: 'brass'
			});
		}
		return out;
	});

	/** One slot of the hotbar: an icon, a name, and (for the first nine) the number key that uses it. */
	interface Slot {
		id: string;
		icon: IconName;
		label: string;
		/** A line above the name: the part of a turn it takes, when not the action. */
		part?: string;
		/** A small badge: uses left, or the difficulty of a check. */
		badge?: string;
		badgeTitle?: string;
		title: string;
		disabled: boolean;
		primary?: boolean;
		/** A switch: lit while on. */
		pressed?: boolean;
		/** A smaller slot, for what every character can do. */
		compact?: boolean;
		/** No number key (the sheet, cancel). */
		unkeyed?: boolean;
		run(): void;
	}

	const VERB_ICON: Record<string, IconName> = {
		examine: 'eye',
		inspect: 'eye',
		search: 'eye',
		listen: 'sound',
		observe: 'eye',
		interact: 'sparkle',
		push: 'chevron',
		pull: 'back',
		open: 'door',
		close: 'door',
		pick_up: 'plus',
		drop: 'trash',
		rotate: 'refresh',
		activate: 'flame',
		destroy: 'skull',
		move: 'chevron',
		trigger: 'flame'
	};
	const ACTION_ICON: Record<Action['kind'], IconName> = {
		attack: 'sword',
		heal: 'heart',
		guard: 'shield',
		boon: 'sparkle',
		maneuver: 'chevron'
	};
	const iconOf = (action: Action): IconName =>
		action.cast ? 'wand' : (ACTION_ICON[action.kind] ?? 'sparkle');

	const slots = $derived.by((): Slot[] => {
		const out: Slot[] = [];
		if (chosen) {
			for (const t of targetsFor(chosen)) {
				const times = picked.filter((id) => id === t.tokenId).length;
				const several = maxTargets > 1 && !aim?.area;
				out.push({
					id: `t-${t.tokenId}`,
					icon: chosen.target === 'enemy' ? 'skull' : 'heart',
					label: t.name,
					badge: times > 0 ? `${t.detail} ×${times}` : t.detail,
					title: t.inReach
						? `${chosen.name} on ${t.name}`
						: aim?.area
							? 'Aim at it'
							: 'Out of reach',
					disabled: !t.inReach && !aim?.area,
					primary: true,
					pressed: several ? times > 0 : undefined,
					run: () => use(chosen, t)
				});
			}
			if (aim && !aim.area && maxTargets > 1) {
				out.push({
					id: 'cast',
					icon: 'wand',
					label: `Cast ${chosen.name}`,
					badge: `${picked.length}/${maxTargets}`,
					title: `Cast ${chosen.name} on the ${picked.length} chosen`,
					disabled: picked.length === 0,
					unkeyed: true,
					run: () => castPicked(chosen)
				});
			}
			out.push({
				id: 'cancel',
				icon: 'close',
				label: 'Cancel',
				title: 'Cancel (Esc)',
				disabled: false,
				unkeyed: true,
				run: () => onTargeting(null)
			});
			return out;
		}
		out.push({
			id: 'sheet',
			icon: 'book',
			label: 'Sheet',
			title: 'Character sheet',
			disabled: false,
			unkeyed: true,
			run: onSheet
		});
		if (adventure.stage === 'choosing') {
			out.push({
				id: 'release',
				icon: 'users',
				label: 'Choose another',
				title: 'Give this character back and pick another',
				disabled: false,
				run: () => send({ type: 'adventure_release' })
			});
		}
		if (character.reaction) {
			const state = character.reaction;
			out.push({
				id: 'reaction',
				icon: 'shield',
				label: 'Reaction',
				badge: state,
				title: REACTION[state],
				disabled: state === 'used',
				pressed: state !== 'held',
				unkeyed: true,
				run: () =>
					send({
						type: 'adventure_sheet',
						characterId: character.id,
						edit: { kind: 'reaction', ready: state === 'held' }
					})
			});
		}
		for (const i of nearby) {
			for (const v of i.verbs.filter((v) => !encounter || v.inFight)) {
				out.push({
					id: `v-${i.id}-${v.id}`,
					icon: VERB_ICON[v.physical ?? v.action] ?? 'sparkle',
					label: v.label,
					badge: v.check && !v.tried ? String(v.check.dc) : undefined,
					badgeTitle: v.check ? checkText(v.check) : undefined,
					title: v.tried
						? `${def.name} has tried this. Someone else might see more.`
						: v.check
							? `${kindOf(v)}: ${checkText(v.check)}`
							: kindOf(v),
					disabled: v.tried,
					primary: true,
					run: () => send({ type: 'adventure_interact', targetId: i.id, verb: v.id })
				});
			}
		}
		for (const p of piles) {
			for (const it of p.items) {
				out.push({
					id: `p-${p.id}-${it.index}`,
					icon: 'plus',
					label: it.name,
					part: 'Pick up',
					title: 'Pick up what lies here',
					disabled: false,
					primary: true,
					run: () =>
						send({
							type: 'adventure_gear',
							characterId: character.id,
							change: { kind: 'take', pile: p.id, index: it.index }
						})
				});
			}
		}
		if (canSense) {
			for (const sense of SENSES) {
				out.push({
					id: `s-${sense}`,
					icon: VERB_ICON[sense],
					label: INVESTIGATION_ACTIONS[sense],
					title:
						sense === 'listen'
							? 'Listen closely where you stand'
							: 'Take a careful look around you',
					disabled: false,
					run: () => send({ type: 'adventure_sense', sense })
				});
			}
		}
		for (const action of own) {
			const left = character.usesLeft[action.id];
			const card = cardOf(action);
			out.push({
				id: `a-${action.id}`,
				icon: iconOf(action),
				label: action.name,
				part: card.part !== 'action' ? card.partName : undefined,
				badge: left !== null && left !== undefined ? `${left} left` : undefined,
				title: whyNot(action) || `${card.summary}. ${action.about}`,
				disabled: !canUse(action),
				run: () => pick(action)
			});
		}
		for (const action of common) {
			out.push({
				id: `a-${action.id}`,
				icon: iconOf(action),
				label: action.name,
				title: whyNot(action) || action.about,
				disabled: !canUse(action),
				compact: true,
				unkeyed: true,
				run: () => pick(action)
			});
		}
		if (encounter && able) {
			out.push({
				id: 'end',
				icon: 'hourglass',
				label: 'End turn',
				title: 'Pass the turn on',
				disabled: !isMine,
				primary: isMine && partsLeft.length === 0,
				run: () => send({ type: 'adventure_end_turn' })
			});
		}
		return out;
	});

	/** A long hotbar scrolls sideways: the ends fade where more is waiting. */
	let strip = $state<HTMLElement>();
	let more = $state({ left: false, right: false });
	function measure() {
		if (!strip) return;
		more = {
			left: strip.scrollLeft > 2,
			right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2
		};
	}
	$effect(() => {
		void slots;
		if (!strip) return;
		measure();
		const watch = new ResizeObserver(measure);
		watch.observe(strip);
		return () => watch.disconnect();
	});

	/** The number keys 1 to 9 use the first nine slots. */
	const keyed = $derived(slots.filter((s) => !s.unkeyed).slice(0, 9));

	function onKeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
		if (!/^[1-9]$/.test(event.key)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const hit = keyed[Number(event.key) - 1];
		if (!hit || hit.disabled) return;
		event.preventDefault();
		hit.run();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<section class="hotbar" class:down={!able} aria-label="Your character" style:--char={def.color}>
	{#if marks.length}
		<ul class="marks" aria-label="Conditions and effects">
			{#each marks as m (m.id)}
				<li class="g-tag {m.tone}" title={m.title}>{m.text}</li>
			{/each}
		</ul>
	{/if}
	<p class="status" aria-live="polite">{status}</p>
	{#if chosen && slotLevels.length > 1}
		<div class="levels" role="group" aria-label="Spell slot">
			{#each slotLevels as s (s.level)}
				{@const on = (slot ?? aim!.level) === s.level}
				<button
					type="button"
					class="level"
					class:primary={on}
					aria-pressed={on}
					disabled={s.left === 0}
					onclick={() => (slot = s.level === aim!.level ? null : s.level)}
				>
					<Icon name="sparkle" size="1rem" />
					Level {s.level}
					<small class="num">{s.left} left</small>
				</button>
			{/each}
		</div>
	{/if}
	<div
		class="tray g-frame"
		role="group"
		aria-label={chosen ? `Targets for ${chosen.name}` : 'Actions'}
	>
		<div
			class="slots"
			class:more-left={more.left}
			class:more-right={more.right}
			bind:this={strip}
			onscroll={measure}
		>
			{#each slots as s (s.id)}
				{@const n = keyed.indexOf(s) + 1}
				<button
					type="button"
					class="slot"
					class:primary={s.primary}
					class:compact={s.compact}
					class:lit={s.pressed}
					disabled={s.disabled}
					aria-pressed={s.pressed}
					title={s.title}
					onclick={s.run}
				>
					{#if n > 0}<span class="key" aria-hidden="true">{n}</span>{/if}
					<span class="glyph"><Icon name={s.icon} size={s.compact ? '1.3rem' : '1.7rem'} /></span>
					<span class="name">
						{#if s.part}<span class="part">{s.part}</span>{/if}
						<span class="label">{s.label}</span>
					</span>
					{#if s.badge}
						<small class="badge num" title={s.badgeTitle}>{s.badge}</small>
					{/if}
				</button>
			{/each}
		</div>
		<span class="sep" aria-hidden="true"></span>
		<DiceSlot onRoll={() => send({ type: 'dice_roll', expression: '1d20' })} />
	</div>
</section>

<style>
	.hotbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: center;
		gap: var(--sp-3);
		max-width: 100%;
		pointer-events: none;
	}

	.marks {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		list-style: none;
		pointer-events: auto;
	}

	.marks li {
		cursor: help;
		animation: g-pop 360ms var(--spring) both;
	}

	.status {
		margin: 0;
		padding: var(--sp-2) var(--sp-6);
		max-width: 100%;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: rgba(20, 14, 10, 0.88);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
		color: var(--text);
		text-align: center;
		pointer-events: none;
		animation: g-rise 360ms var(--ease-out) both;
	}

	.down .status {
		border-color: #6b2f26;
		color: #ffd7cf;
	}

	/* The slot a levelled spell is cast at: a row of small plates over the hotbar. */
	.levels {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
		pointer-events: auto;
		animation: g-rise 360ms var(--ease-out) both;
	}

	.level {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		min-height: 2.75rem;
		font-family: var(--font-label);
	}

	.level small {
		margin: 0;
		opacity: 0.85;
		font-size: var(--fs-xs);
	}

	.tray {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		width: fit-content;
		max-width: 100%;
		padding: var(--sp-4) var(--sp-6);
		border-radius: var(--radius-lg);
		pointer-events: auto;
		animation: g-pop 460ms var(--spring) both;
	}

	.slots {
		display: flex;
		align-items: stretch;
		gap: var(--sp-4);
		min-width: 0;
		padding: var(--sp-2) var(--sp-1) var(--sp-3);
		overflow-x: auto;
		scrollbar-width: thin;
		z-index: 1;
	}

	.slots.more-right {
		mask-image: linear-gradient(90deg, #000 calc(100% - 2rem), transparent);
	}

	.slots.more-left {
		mask-image: linear-gradient(90deg, transparent, #000 2rem);
	}

	.slots.more-left.more-right {
		mask-image: linear-gradient(90deg, transparent, #000 2rem, #000 calc(100% - 2rem), transparent);
	}

	.slots:empty {
		display: none;
	}

	.sep {
		align-self: stretch;
		width: 1px;
		margin: var(--sp-2) 0;
		background: linear-gradient(180deg, transparent, var(--gilt-line-strong), transparent);
		z-index: 1;
	}

	.tray :global(.d20) {
		z-index: 1;
	}

	.slot {
		position: relative;
		display: grid;
		grid-template-rows: 1fr auto;
		justify-items: center;
		align-items: center;
		flex: none;
		width: 4.9rem;
		min-height: 5.8rem;
		padding: var(--sp-3) var(--sp-2) var(--sp-3);
		border: 1px solid var(--ink-line);
		border-radius: 0.9rem;
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(255, 220, 160, 0.12), transparent 60%),
			linear-gradient(180deg, #3b2c20, #231911);
		color: var(--text);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 4px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line),
			0 8px 12px rgba(8, 4, 0, 0.4);
	}

	/* What every character can do: a smaller plate, set after the character's own. */
	.slot.compact {
		width: 3.8rem;
		min-height: 4.4rem;
		align-self: center;
	}

	.slot:not(:disabled):hover {
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(255, 220, 160, 0.22), transparent 60%),
			linear-gradient(180deg, #483625, #2b2018);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 0 0 4px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line),
			0 8px 14px rgba(8, 4, 0, 0.45),
			0 0 22px rgba(224, 164, 88, 0.3);
	}

	.slot:disabled {
		opacity: 0.5;
		filter: saturate(0.45);
		box-shadow:
			inset 0 0 0 1px rgba(240, 212, 158, 0.12),
			inset 0 0 0 4px rgba(0, 0, 0, 0.3),
			0 2px 0 var(--ink-line);
	}

	/* The thing to do now: a gilt frame that breathes. */
	.slot.primary:not(:disabled) {
		box-shadow:
			inset 0 0 0 2px var(--gilt),
			inset 0 0 0 5px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line),
			0 8px 12px rgba(8, 4, 0, 0.4),
			0 0 18px rgba(224, 164, 88, 0.35);
		animation: ready 2.2s ease-in-out infinite;
	}

	/* A switch that is on, or a target already chosen: pressed in and lit, still. */
	.slot.lit:not(:disabled) {
		transform: translateY(2px);
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(255, 220, 160, 0.3), transparent 62%),
			linear-gradient(180deg, #54402b, #2f2218);
		box-shadow:
			inset 0 0 0 2px var(--gilt-hi),
			inset 0 0 0 5px rgba(0, 0, 0, 0.3),
			0 1px 0 var(--ink-line),
			0 0 24px rgba(255, 190, 100, 0.5);
		animation: none;
	}

	.glyph {
		display: grid;
		color: var(--gilt-hi);
	}

	.slot:disabled .glyph {
		color: var(--muted);
	}

	.name {
		display: grid;
		justify-items: center;
		gap: 0.1rem;
		max-width: 100%;
	}

	.label {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		max-width: 100%;
		font-family: var(--font-label);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1.05;
		text-align: center;
		overflow-wrap: anywhere;
	}

	.part {
		font-family: var(--font-label);
		font-size: 0.64rem;
		letter-spacing: 0.06em;
		line-height: 1;
		color: var(--gilt);
	}

	.slot:disabled .part {
		color: inherit;
	}

	.key {
		position: absolute;
		top: 0.28rem;
		left: 0.36rem;
		display: grid;
		place-items: center;
		min-width: 1.05rem;
		height: 1.05rem;
		border-radius: 0.3rem;
		background: var(--gilt-grad);
		color: var(--accent-text);
		font-family: var(--font-label);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
		text-shadow: none;
	}

	.badge {
		position: absolute;
		top: 0.2rem;
		right: 0.25rem;
		margin: 0;
		padding: 0 0.32rem;
		border-radius: 0.5rem;
		background: #120c08;
		box-shadow: inset 0 0 0 1px var(--gilt-line-strong);
		font-family: var(--font-label);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.15rem;
		color: var(--gilt-hi);
		opacity: 1;
	}

	@keyframes ready {
		50% {
			box-shadow:
				inset 0 0 0 2px var(--gilt-hi),
				inset 0 0 0 5px rgba(0, 0, 0, 0.3),
				0 3px 0 var(--ink-line),
				0 8px 12px rgba(8, 4, 0, 0.4),
				0 0 28px rgba(255, 190, 100, 0.55);
		}
	}

	@media (max-width: 48rem) {
		.tray {
			gap: var(--sp-4);
			padding: var(--sp-3) var(--sp-4);
		}

		.slot {
			width: 4.2rem;
			min-height: 5.2rem;
		}

		.slot.compact {
			width: 3.6rem;
			min-height: 4.4rem;
		}

		.key {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tray,
		.status,
		.levels,
		.marks li,
		.slot.primary:not(:disabled) {
			animation: none;
		}

		.slot.lit:not(:disabled) {
			transform: none;
		}
	}
</style>
