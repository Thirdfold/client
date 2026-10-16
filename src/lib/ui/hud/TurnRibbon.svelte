<script lang="ts">
	import type { CharacterStatus, EncounterView } from '$lib/adventure/adventure';
	import { CHARACTERS } from '$lib/adventure/characters';
	import { Meter, Portrait } from '$lib/ui/game';

	/**
	 * The turn order as a ribbon of portraits while a fight is on: whose turn it is is lit and larger,
	 * foes wear red rings and a health bar, the fallen are greyed. Reads as one ordered list.
	 */
	interface Props {
		encounter: EncounterView;
		characters: readonly CharacterStatus[];
	}
	let { encounter, characters }: Props = $props();
	/** An elective fight trades turns by hand-off, so it counts exchanges and has no initiative. */
	const roundName = $derived(encounter.elective ? 'Exchange' : 'Round');
</script>

<div class="ribbon g-frame" role="group" aria-label="Fight">
	<div class="round">
		<span class="g-tag brass num">{roundName} {encounter.round}</span>
		{#if encounter.counter}
			<span class="counter g-tag">
				{encounter.counter.label}
				<span class="num">{encounter.counter.count}/{encounter.counter.of}</span>
			</span>
		{/if}
	</div>
	<ol aria-label={`${roundName} ${encounter.round}, turn order`}>
		{#each encounter.order as t, i (i)}
			{@const foe = t.tokenId ? encounter.enemies.find((e) => e.tokenId === t.tokenId) : undefined}
			{@const who = t.characterId ? characters.find((c) => c.id === t.characterId) : undefined}
			{@const current = i === encounter.current}
			{@const marks = foe?.conditions ?? who?.conditions ?? []}
			<li
				class="turn"
				class:enemy={t.kind === 'enemy'}
				class:current
				class:out={t.out}
				aria-current={current ? 'true' : undefined}
				title={encounter.elective ? t.name : `Initiative ${t.initiative}`}
				style:--i={i}
			>
				<span class="face">
					<Portrait
						name={t.name}
						size={current ? 54 : 42}
						foe={t.kind === 'enemy'}
						active={current}
						color={t.characterId ? CHARACTERS[t.characterId].color : '#7a3328'}
						ratio={foe
							? foe.hp / Math.max(1, foe.maxHp)
							: who
								? who.hp / Math.max(1, who.maxHp)
								: 1}
						label={t.name}
					/>
					{#if !encounter.elective}
						<span class="init num" aria-hidden="true">{t.initiative}</span>
					{/if}
				</span>
				<span class="name">{t.name}</span>
				{#if foe}
					<Meter value={foe.hp} max={foe.maxHp} tone="foe" label={`${t.name} hit points`} />
					<span class="hp num">{foe.hp}/{foe.maxHp}</span>
				{/if}
				{#each marks as m (m.effect + m.id)}
					<span class="mark g-tag" title={`${m.name}: ${m.until} (${m.from})`}>
						{m.name}{m.level ? ` ${m.level}` : ''}
					</span>
				{/each}
			</li>
		{/each}
	</ol>
</div>

<style>
	.ribbon {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		max-width: 100%;
		padding: var(--sp-3) var(--sp-6);
		border-radius: var(--radius-lg);
		/* A fight is on: the plate's edge turns oxblood-warm. */
		box-shadow:
			inset 0 0 0 1px rgba(226, 122, 107, 0.5),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-md);
		pointer-events: none;
		animation: g-pop 420ms var(--spring) both;
	}

	.round {
		display: grid;
		gap: var(--sp-2);
		justify-items: start;
		z-index: 1;
	}

	ol {
		display: flex;
		align-items: flex-end;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
		padding: var(--sp-3) var(--sp-2) 0;
		overflow-x: auto;
		scrollbar-width: none;
		z-index: 1;
	}

	.turn {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		min-width: 3.6rem;
		padding: var(--sp-2) var(--sp-2) var(--sp-2);
		border-radius: var(--radius-md);
		font-size: var(--fs-xs);
		line-height: 1.1;
		transition:
			transform 260ms var(--spring),
			opacity 200ms var(--ease-out),
			background 200ms var(--ease-out);
		animation: g-rise 420ms var(--ease-out) both;
		animation-delay: calc(var(--i, 0) * 50ms);
	}

	.turn.current {
		background: radial-gradient(90% 90% at 50% 40%, rgba(255, 190, 100, 0.22), transparent 75%);
		box-shadow: 0 0 0 1px var(--gilt-line-strong);
	}

	.face {
		position: relative;
		display: grid;
	}

	.name {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		max-width: 5.2rem;
		overflow: hidden;
		text-align: center;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.turn.enemy .name {
		color: #ffb4a6;
	}

	.turn.current .name {
		color: var(--gilt-hi);
	}

	.init {
		position: absolute;
		top: -0.15rem;
		left: -0.25rem;
		display: grid;
		place-items: center;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.2rem;
		border-radius: 0.4rem;
		background: var(--panel-raised);
		box-shadow:
			0 0 0 1px var(--ink-line),
			inset 0 0 0 1px var(--gilt-line-strong);
		font-family: var(--font-label);
		font-size: var(--fs-2xs);
		font-weight: 700;
		line-height: 1;
		color: var(--gilt-hi);
	}

	.turn :global(.wrap) {
		width: 3.4rem;
	}

	.turn :global(.g-meter) {
		height: 0.4rem;
	}

	.hp {
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	.mark {
		max-width: 5.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
	}

	.turn.out {
		opacity: 0.4;
		filter: grayscale(0.8);
	}

	.turn.out .name {
		text-decoration: line-through;
	}

	@media (max-width: 48rem) {
		.ribbon {
			padding: var(--sp-2) var(--sp-4);
			gap: var(--sp-4);
		}

		.round {
			grid-auto-flow: row;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ribbon,
		.turn {
			animation: none;
		}
	}
</style>
