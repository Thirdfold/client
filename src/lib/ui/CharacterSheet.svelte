<script lang="ts">
	import { onMount } from 'svelte';
	import type { CharacterCard, CharacterStatus, SheetValue } from '$lib/adventure/adventure';
	import { BLEED_OUT_ROUNDS, STATUSES, type CharacterDef } from '$lib/adventure/characters';
	import { play } from '$lib/audio/engine';
	import type { RoomAction, SheetReply } from '$lib/net/room-connection.svelte';
	import type { DndSheetDetails } from '$lib/rules/dnd55e/sheet';
	import { Icon, Meter, Portrait, type IconName } from '$lib/ui/game';
	import { actionIcon, roleOf, STAT_ICON } from './room/character';
	import { withoutArticle } from './room/names';
	import { trapFocus } from './trap-focus';

	interface Props {
		character: CharacterDef;
		/** Its numbers as the story's rules work them out (from the server). */
		card: CharacterCard;
		status: CharacterStatus | null;
		/** Shown as an introduction (just picked) rather than as a sheet looked up mid-game. */
		intro?: boolean;
		/** For rules with a full sheet: asking for it, and changing it. */
		send?(action: RoomAction): boolean;
		sheetReply?: SheetReply | null;
		/** The others in play, to hand things to. */
		party?: { id: string; name: string }[];
		/** Whether the viewer is the GM (who may hand out gear). */
		gm?: boolean;
		onClose(): void;
	}

	let {
		character,
		card,
		status,
		intro = false,
		send,
		sheetReply = null,
		party = [],
		gm = false,
		onClose
	}: Props = $props();

	// The rules' full sheet: asked for once the sheet opens (it only changes with the character).
	const full = $derived(!intro && card.details === 'dnd-5.5e' && !!send && !!status);
	onMount(() => {
		play([{ kind: 'ui', sound: 'open' }]);
		if (full && status) send?.({ type: 'character_sheet', characterId: status.id });
	});
	// A rename, or a change of gear, changes the sheet: ask again.
	let askedFor = '';
	$effect(() => {
		if (!full || !status) return;
		const gear = (card.inventory ?? []).map((i) => `${i.id}:${i.quantity}:${i.equipped}`);
		const key = `${status.id}:${character.name}:${gear.join(',')}`;
		if (askedFor && askedFor !== key) send?.({ type: 'character_sheet', characterId: status.id });
		askedFor = key;
	});
	const details = $derived(
		full && sheetReply && sheetReply.characterId === status?.id && sheetReply.rules === 'dnd-5.5e'
			? (sheetReply.details as unknown as DndSheetDetails)
			: null
	);

	const roundsLeft = $derived(BLEED_OUT_ROUNDS - (status?.downedFor ?? 0));
	const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
	const partOf = (id: string) => card.actions.find((a) => a.id === id);
	const proficient = (list: SheetValue[]) => list.filter((v) => v.proficient);

	// Health as its rules count it (stress boxes clear), else hit points.
	const health = $derived(
		status?.health ?? {
			name: 'HP',
			value: status?.hp ?? character.hp,
			max: status?.maxHp ?? character.hp
		}
	);

	/** An ability's glyph: the classic four stats, then the six abilities the 5.5e rules use. */
	const ABILITY_ICON: Record<string, IconName> = {
		str: 'sword',
		dex: 'sparkle',
		con: 'heart',
		int: 'eye',
		wis: 'compass',
		cha: 'star'
	};
	const statIcon = (id: string): IconName =>
		(STAT_ICON as Record<string, IconName>)[id] ?? ABILITY_ICON[id.slice(0, 3)] ?? 'star';

	function close() {
		play([{ kind: 'ui', sound: 'close' }]);
		onClose();
	}
</script>

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && close()}
	onkeydown={(e) => e.key === 'Escape' && close()}
>
	<div
		class="g-frame sheet"
		class:wide={full}
		style:--char={character.color}
		role="dialog"
		aria-modal="true"
		aria-labelledby="sheet-title"
		use:trapFocus
	>
		<header>
			<Portrait
				name={withoutArticle(character.name)}
				label={character.name}
				color={character.color}
				size={84}
				ratio={health.max > 0 ? health.value / health.max : 1}
			/>
			<div class="id">
				<h2 id="sheet-title">
					{#if intro}<span class="lead">You are playing</span>{/if}
					{character.name}
				</h2>
				<p class="role">{card.title ?? roleOf(character)}</p>
			</div>
		</header>
		<p class="tagline">{intro ? character.intro : character.tagline}</p>

		<div class="hp">
			<Icon name="heart" size="1.3em" />
			<Meter value={health.value} max={health.max} label={health.name} showValue />
		</div>

		<dl class="plates vitals num">
			<div>
				<dt><Icon name="shield" size="1.1em" />{card.defense.name}</dt>
				<dd>{card.defense.value}</dd>
			</div>
			<div>
				<dt><Icon name="compass" size="1.1em" />Speed</dt>
				<dd>{details ? `${details.derived.speed} ft.` : character.speed}</dd>
			</div>
			{#if card.level !== null}
				<div>
					<dt><Icon name="star" size="1.1em" />Level</dt>
					<dd>{card.level}</dd>
				</div>
			{/if}
			{#if card.proficiency !== null}
				<div>
					<dt><Icon name="check" size="1.1em" />Proficiency</dt>
					<dd>{signed(card.proficiency)}</dd>
				</div>
			{/if}
		</dl>

		{#if details && status && send}
			{#await import('./dnd/DndSheet.svelte') then { default: DndSheet }}
				<DndSheet {status} {details} {send} {party} {gm} />
			{/await}
		{:else}
			<ul class="plates stats num" class:six={card.stats.length === 6} aria-label="Stats">
				{#each card.stats as stat (stat.id)}
					<li>
						<span class="what"><Icon name={statIcon(stat.id)} size="1.1em" />{stat.name}</span>
						<b>{signed(stat.bonus)}</b>
						{#if stat.score !== null}<small>{stat.score}</small>{/if}
					</li>
				{/each}
			</ul>

			{#if card.saves.length}
				<p class="proficiencies">
					<span class="rubric">Saving throws</span>
					{#each card.saves as save, i (save.id)}{i ? ' · ' : ''}<span
							class:proficient={save.proficient}
							>{save.name}
							<b class="num">{signed(save.bonus)}</b></span
						>{/each}
				</p>
			{/if}
			{#if card.skills.length}
				<p class="proficiencies">
					<span class="rubric">Skills</span>
					{#each proficient(card.skills) as skill, i (skill.id)}{i ? ' · ' : ''}<span
							class="proficient">{skill.name} <b class="num">{signed(skill.bonus)}</b></span
						>{:else}None{/each}
				</p>
			{/if}
		{/if}

		{#if card.traits?.length}
			<ul class="traits" aria-label="Traits">
				{#each card.traits as t, i (i)}
					<li>
						<span class="g-tag">{t.kind}</span>
						<strong>{t.name}</strong>
						{#if t.text}<span class="summary">{t.text}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if card.resources?.length && !details}
			<h3 class="rubric">Resources</h3>
			<ul class="traits">
				{#each card.resources as r (r.id)}
					{@const used = status?.resourcesSpent[r.id] ?? 0}
					<li class:spent={used >= r.max}>
						<strong>{r.name}</strong>
						<span class="g-tag" class:brass={used < r.max}>{used >= r.max ? 'Taken' : 'Open'}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<h3 class="rubric">Actions</h3>
		<ul class="actions">
			{#each character.actions as action (action.id)}
				{@const left = status?.usesLeft[action.id]}
				{@const part = partOf(action.id)}
				<li title={action.about}>
					<span class="slot">
						<Icon name={action.cast ? 'wand' : actionIcon(action)} size="1.7rem" />
						{#if action.uses !== null}
							<span class="uses num" title="Uses left this fight"
								>{left ?? action.uses}/{action.uses}</span
							>
						{/if}
					</span>
					<div class="text">
						<div class="line">
							<strong>{action.name}</strong>
							{#if part && part.part !== 'action'}
								<span class="left">{part.partName}</span>
							{/if}
							{#if action.uses !== null}
								<span class="left num">{left ?? action.uses}/{action.uses} left</span>
							{/if}
						</div>
						<p class="summary">{part?.summary ?? ''}</p>
						<p class="about">{action.about}</p>
					</div>
				</li>
			{/each}
		</ul>

		{#if status && (status.statuses.length || status.downed || status.dead)}
			<h3 class="rubric">Condition</h3>
			<ul class="conditions">
				{#if status.dead}
					<li>
						<Icon name="skull" size="1.3em" />
						<span><strong>Dead.</strong> Gone for the rest of this section.</span>
					</li>
				{:else if status.downed && status.downedText}
					<li>
						<Icon name="warn" size="1.3em" />
						<span><strong>Down.</strong> {status.downedText}</span>
					</li>
				{:else if status.downed}
					<li>
						<Icon name="warn" size="1.3em" />
						<span>
							<strong>Down.</strong> Can't move or act. Dies after {roundsLeft} more
							{roundsLeft === 1 ? 'round' : 'rounds'} unless healed.
						</span>
					</li>
				{/if}
				{#each status.statuses as s (s.id)}
					<li>
						<Icon name="info" size="1.3em" />
						<span><strong>{STATUSES[s.id].name}.</strong> {STATUSES[s.id].about}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<button class="primary" type="button" onclick={close}>
			{intro ? 'Into the story' : 'Close'}
		</button>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		padding: 5rem var(--sp-6) var(--sp-6);
		background: radial-gradient(90% 80% at 50% 45%, rgba(10, 8, 6, 0.5), rgba(10, 8, 6, 0.86));
		overflow-y: auto;
		z-index: var(--z-panel);
	}

	.sheet {
		width: min(31rem, 100%);
		margin: auto;
		display: grid;
		gap: var(--sp-5);
		padding: var(--sp-7) var(--sp-7) var(--sp-7);
		border-radius: var(--radius-lg);
		animation: g-pop 420ms var(--spring) backwards;
		/* A sash of the character's colour behind the portrait. */
		background-image:
			radial-gradient(
				90% 9rem at 50% 0%,
				color-mix(in srgb, var(--char) 38%, transparent),
				transparent
			),
			var(--grain), radial-gradient(120% 70% at 20% 0%, rgba(255, 220, 160, 0.07), transparent 60%);
		background-size: auto, 180px, auto;
		background-repeat: no-repeat, repeat, no-repeat;
		background-blend-mode: normal, soft-light, normal;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--sp-6);
	}

	.id {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}

	h2 {
		display: grid;
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		line-height: 1.05;
	}

	.lead {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 400;
		letter-spacing: 0.1em;
		color: var(--muted);
	}

	.role {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.12em;
		color: var(--gilt);
	}

	.tagline {
		margin: 0;
		max-width: 65ch;
		color: #d8c6a4;
		font-family: var(--font-display);
		font-style: italic;
		line-height: 1.4;
	}

	.hp {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		color: #e27a6b;
	}

	.hp :global(.wrap) {
		flex: 1;
	}

	.hp :global(.value) {
		font-size: var(--fs-sm);
		color: var(--text);
	}

	/* Engraved plates: sunk into the wood, a gilt hairline round each. */
	.plates {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.vitals {
		grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
	}

	.stats {
		grid-template-columns: repeat(4, 1fr);
	}

	.plates > * {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		padding: var(--sp-4) var(--sp-2);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 5px rgba(0, 0, 0, 0.65),
			inset 0 0 0 1px var(--gilt-line),
			0 1px 0 rgba(240, 212, 158, 0.12);
		cursor: default;
	}

	dt,
	.what {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	dd,
	.stats b {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1;
		color: var(--gilt-hi);
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
	}

	.rubric {
		margin: var(--sp-3) 0 calc(-1 * var(--sp-2));
		padding-bottom: var(--sp-3);
		border-bottom: 1px solid rgba(0, 0, 0, 0.6);
		box-shadow: 0 1px 0 rgba(240, 212, 158, 0.12);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.1em;
		color: var(--gilt);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.actions {
		display: grid;
		gap: var(--sp-4);
	}

	/* An ability: a square skill slot with its icon and uses, and what it does. */
	.actions li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-5);
		align-items: start;
		padding: var(--sp-4) var(--sp-5) var(--sp-4) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.slot {
		position: relative;
		display: grid;
		place-items: center;
		width: 3.4rem;
		height: 3.4rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: linear-gradient(180deg, #0b0705, #1b130e);
		box-shadow:
			inset 0 2px 5px rgba(0, 0, 0, 0.7),
			inset 0 0 0 1px var(--gilt-line-strong),
			0 0 14px color-mix(in srgb, var(--char) 35%, transparent);
		color: var(--gilt-hi);
	}

	.uses {
		position: absolute;
		right: -6px;
		bottom: -6px;
		padding: 0 5px;
		border: 1px solid var(--gilt-dark);
		border-radius: var(--radius-sm);
		background: var(--gilt-grad);
		font-family: var(--font-label);
		font-size: var(--fs-2xs);
		font-weight: 700;
		line-height: 1.4;
		color: var(--accent-text);
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-4);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
	}

	.left {
		font-size: var(--fs-xs);
		color: var(--gilt);
	}

	.text p {
		margin: var(--sp-1) 0 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.text .summary {
		color: var(--text);
	}

	.conditions {
		display: grid;
		gap: var(--sp-4);
	}

	.conditions li {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-4);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(67, 32, 26, 0.35);
		box-shadow: inset 0 0 0 1px rgba(255, 170, 150, 0.25);
		font-size: var(--fs-sm);
		color: #ffd7cf;
	}

	/* A long sheet scrolls under its button, which stays in reach (and in view when it opens). */
	.sheet > .primary {
		position: sticky;
		bottom: var(--sp-4);
		z-index: 2;
	}

	.sheet.wide {
		width: min(48rem, 100%);
	}

	.stats.six {
		grid-template-columns: repeat(3, 1fr);
	}

	.plates small {
		display: block;
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	.proficiencies {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.proficiencies .rubric {
		display: block;
		margin: 0 0 var(--sp-3);
	}

	.proficiencies .proficient {
		color: var(--gilt-hi);
	}

	.traits {
		display: grid;
		gap: var(--sp-3);
	}

	.traits li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.traits .summary {
		color: var(--muted);
	}

	.traits .spent {
		opacity: 0.7;
	}

	@media (max-width: 48rem) {
		/* Below the two rows of bars the table keeps along the top on a phone. */
		.backdrop {
			padding: 8.5rem var(--sp-3) var(--sp-3);
		}

		.sheet {
			padding-inline: var(--sp-6);
		}

		.stats,
		.stats.six {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
</style>
