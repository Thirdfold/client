<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { AdventureView } from '$lib/adventure/adventure';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon, Portrait, type IconName } from '$lib/ui/game';
	import { withoutArticle } from './room/names';
	import StoryCard from './room/StoryCard.svelte';
	import { namesList, survivalLine, timePlayed } from './session-end';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		/** The viewer's player id. */
		me: string;
		isGm: boolean;
		send(action: RoomAction): boolean;
		/** Close the screen and go on looking around the table. */
		onClose(): void;
	}

	let { adventure, players, me, isGm, send, onClose }: Props = $props();

	const won = $derived(adventure.stage === 'complete');
	const party = $derived(adventure.characters.filter((c) => c.inPlay));
	const nameOf = (id: string | null) => (id && players.find((p) => p.id === id)?.name) || 'GM';
	const played = $derived(timePlayed(adventure.begunAt, adventure.completedAt));
	const summary = $derived(adventure.summary);
	const asked = $derived(summary?.again.includes(me) ?? false);
	const askers = $derived(
		(summary?.again ?? []).flatMap((id) => players.find((p) => p.id === id)?.name ?? [])
	);
	const isPlayer = $derived(players.find((p) => p.id === me)?.role === 'player');

	const tally = $derived<{ icon: IconName; n: number; what: string }[]>(
		summary
			? [
					{ icon: 'book', n: summary.chapters, what: 'chapters' },
					{ icon: 'sword', n: summary.fightsWon, what: 'fights won' },
					{ icon: 'skull', n: summary.foesDefeated, what: 'foes defeated' },
					{ icon: 'scroll', n: summary.evidence, what: 'evidence found' }
				]
			: []
	);
</script>

<div class="backdrop">
	<StoryCard
		banner={won ? 'Adventure complete' : 'Adventure failed'}
		sound={won ? 'fanfare' : 'chapter'}
		class="end"
		aria-labelledby="end-title"
	>
		<header>
			<p class="kicker">{adventure.title}</p>
			<h2 id="end-title">{won ? (adventure.ending?.headline ?? 'The end') : 'The lamps go out'}</h2>
			<p class="survival">{survivalLine(adventure.characters, won)}</p>
		</header>
		<hr class="flourish" />

		{#if won && adventure.ending}
			<p class="lead" class:short={adventure.ending.text.length < 90}>{adventure.ending.text}</p>
			{#if adventure.ending.scene}
				<p class="scene">
					<span class="label">The final scene</span>{adventure.ending.scene}
				</p>
			{/if}
		{:else if !won}
			<p class="lead short">The dark has won this night. The story can begin again.</p>
		{/if}

		{#if party.length}
			<ul class="party" aria-label="Players">
				{#each party as c, i (c.id)}
					<li class:dead={c.dead} style:--i={i}>
						<Portrait
							name={withoutArticle(c.def.name)}
							label={c.def.name}
							color={c.def.color}
							size={56}
							badge={c.dead ? 'skull' : null}
						/>
						<span class="who">{c.def.name}</span>
						<small>{nameOf(c.playerId)}{c.dead ? ' · fell' : ''}</small>
					</li>
				{/each}
			</ul>
		{/if}

		<dl class="ledger">
			{#if played}
				<div class="line">
					<dt>Time played</dt>
					<dd class="num">{played}</dd>
				</div>
			{/if}
			<div class="line">
				<dt>{won ? 'Ending' : 'Fell in'}</dt>
				<dd>
					{#if won && adventure.ending}
						<strong>{adventure.ending.title}</strong>
						<small>{adventure.ending.subtitle}</small>
					{:else}
						Chapter {adventure.chapter.number}: {adventure.chapter.title}
					{/if}
				</dd>
			</div>
			{#if won}
				{#each adventure.ending?.result ?? [] as r (r.label)}
					<div class="line">
						<dt>{r.label}</dt>
						<dd>{r.value}</dd>
					</div>
				{/each}
			{/if}
			{#each adventure.decisions as d (d.id)}
				<div class="line">
					<dt class="question">{d.prompt}</dt>
					<dd>{d.choice} <small>{d.by}</small></dd>
				</div>
			{/each}
			{#if adventure.rewards.length}
				<div class="line">
					<dt>Earned</dt>
					<dd>{adventure.rewards.join(', ')}</dd>
				</div>
			{/if}
		</dl>

		{#if summary}
			<ul class="tally" aria-label="What the party did">
				{#each tally as t, i (t.what)}
					<li style:--i={i}>
						<Icon name={t.icon} size="1.4rem" />
						<strong class="num">{t.n}</strong>
						<span>{t.what}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if adventure.library?.canRate}
			<div class="rate" role="group" aria-label="Rate this adventure">
				<span class="ask"
					>{adventure.library.rated
						? `You gave it ${adventure.library.rated} of 5. Change it?`
						: `How was it? Rate ${adventure.library.creator.name}’s adventure:`}</span
				>
				<span class="stars">
					{#each [1, 2, 3, 4, 5] as stars (stars)}
						<button
							type="button"
							class="star ghost"
							class:lit={(adventure.library.rated ?? 0) >= stars}
							aria-label={`${stars} of 5`}
							aria-pressed={adventure.library.rated === stars}
							onclick={() => send({ type: 'adventure_rate', stars })}
						>
							<Icon name="star" size="1.6rem" />
						</button>
					{/each}
				</span>
			</div>
		{/if}

		{#if askers.length}
			<p class="again">{namesList(askers)} would like to play again.</p>
		{/if}

		<div class="row">
			<button class={isGm ? '' : 'gilt'} type="button" onclick={onClose}>
				<Icon name="map" /> Return to table
			</button>
			{#if isGm}
				<button
					class="gilt"
					type="button"
					onclick={() => send({ type: 'adventure_control', op: 'restart' })}
				>
					<Icon name="refresh" /> Play again
				</button>
			{:else if isPlayer}
				<button type="button" disabled={asked} onclick={() => send({ type: 'adventure_again' })}>
					<Icon name="refresh" />
					{asked ? 'Asked to play again' : 'Play again'}
				</button>
			{/if}
			<button type="button" onclick={() => goto(resolve('/'))}>
				<Icon name="home" /> Back to title
			</button>
		</div>
		<p class="hint">
			{#if isGm}
				Play again starts the story over from the beginning with the same party.
				<button
					class="link ghost"
					type="button"
					onclick={() => send({ type: 'adventure_control', op: 'end' })}
				>
					Or end it and keep a free table.
				</button>
			{:else if isPlayer}
				Return to the table to keep exploring; playing again asks the GM to start it over.
			{:else}
				Return to the table to keep watching.
			{/if}
		</p>
		{#if adventure.rules.attribution}
			<p class="credit">{adventure.rules.attribution}</p>
		{/if}
	</StoryCard>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		padding: 3.2rem var(--sp-6) var(--sp-7);
		background: radial-gradient(90% 80% at 50% 40%, rgba(10, 8, 6, 0.5), rgba(10, 8, 6, 0.86));
		overflow-y: auto;
		z-index: var(--z-modal);
	}

	.backdrop :global(.end) {
		width: min(40rem, 100%);
		margin: auto;
		text-align: center;
		gap: var(--sp-5);
	}

	header {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
	}

	.kicker {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.1em;
		color: var(--ink-muted);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-2xl);
		font-weight: 700;
		line-height: 1.05;
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
		text-wrap: balance;
	}

	.survival {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-style: italic;
		color: var(--ink-accent);
	}

	.lead {
		max-width: 60ch;
		margin: 0 auto;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.5;
		text-align: left;
		color: var(--ink);
		text-wrap: pretty;
	}

	.lead::first-letter {
		float: left;
		margin: 0.04em 0.1em 0 0;
		font-size: 3.2em;
		line-height: 0.78;
		font-weight: 700;
		color: var(--ink-accent);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
	}

	.lead.short {
		text-align: center;
	}

	.lead.short::first-letter {
		float: none;
		margin: 0;
		font-size: inherit;
		line-height: inherit;
		font-weight: inherit;
		color: inherit;
		text-shadow: none;
	}

	.scene {
		display: grid;
		gap: var(--sp-2);
		margin: 0;
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid rgba(109, 79, 40, 0.6);
		border-radius: var(--radius-md);
		background: rgba(255, 250, 235, 0.5);
		box-shadow:
			inset 0 2px 5px rgba(90, 60, 30, 0.25),
			0 1px 0 rgba(255, 250, 235, 0.7);
		text-align: left;
		font-family: var(--font-display);
		font-style: italic;
		line-height: 1.4;
		color: var(--ink);
	}

	.label {
		font-family: var(--font-label);
		font-style: normal;
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ink-accent);
	}

	/* The party: a row of medallions, those who fell greyed with a skull. */
	.party {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-6) var(--sp-8);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.party li {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		animation: g-pop 460ms var(--spring) calc(700ms + var(--i) * 110ms) backwards;
	}

	.party .who {
		margin-top: var(--sp-3);
		font-family: var(--font-label);
		font-weight: 700;
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
		color: var(--ink);
	}

	.party small {
		font-size: var(--fs-xs);
		color: var(--ink-muted);
	}

	.party .dead :global(.portrait) {
		filter: grayscale(0.85) brightness(0.8);
	}

	.party .dead .who {
		color: var(--ink-muted);
	}

	/* The ledger: ruled lines, a label, a run of dots, the entry. */
	.ledger {
		display: grid;
		margin: 0;
		padding: var(--sp-3) 0;
		border-block: 2px double rgba(94, 74, 53, 0.55);
		text-align: left;
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: var(--sp-5);
		padding: var(--sp-3) 0;
	}

	.line + .line {
		border-top: 1px dotted rgba(94, 74, 53, 0.4);
	}

	dt {
		flex: 0 1 55%;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.04em;
		color: var(--ink-muted);
	}

	dt.question {
		flex-basis: 50%;
		font-family: var(--font-display);
		font-size: var(--fs-sm);
		font-style: italic;
		letter-spacing: 0;
	}

	dd {
		flex: 1;
		margin: 0;
		text-align: right;
		font-family: var(--font-display);
		color: var(--ink);
	}

	dd small {
		display: block;
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--ink-muted);
	}

	/* The tally: four dark engraved plates, gilt figures. */
	.tally {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: var(--sp-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tally li {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		padding: var(--sp-5) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 3px 8px rgba(0, 0, 0, 0.5),
			0 3px 0 var(--ink-line);
		color: var(--gilt);
		animation: g-rise 480ms var(--ease-out) calc(900ms + var(--i) * 80ms) backwards;
	}

	.tally strong {
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		line-height: 1;
		color: var(--gilt-hi);
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
	}

	.tally span {
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.06em;
		color: #d8c6a4;
	}

	.rate {
		display: grid;
		justify-items: center;
		gap: var(--sp-2);
		color: var(--ink-muted);
	}

	.stars {
		display: inline-flex;
		white-space: nowrap;
	}

	/* Bare stars, not keys: beat the parchment's plate look. */
	.backdrop .star.star:not(:disabled),
	.backdrop .star.star:not(:disabled):hover {
		min-height: 2.75rem;
		padding: 0 var(--sp-2);
		border: 0;
		background: none;
		box-shadow: none;
		color: var(--ink-muted);
		transform: none;
	}

	.backdrop .star.star:not(:disabled):hover {
		color: var(--ink-accent);
		transform: scale(1.15);
	}

	.backdrop .star.star.lit:not(:disabled) {
		color: var(--ink-accent);
	}

	.star.lit :global(svg) {
		fill: currentColor;
	}

	.again {
		margin: 0;
		font-family: var(--font-label);
		letter-spacing: 0.05em;
		color: var(--ink-accent);
	}

	/* The ways on stay in reach however long the ledger is. */
	.row {
		position: sticky;
		bottom: -1.2rem;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: var(--sp-5);
		margin: 0 calc(7px - var(--card-pad, 2rem));
		padding: var(--sp-5) var(--sp-6) var(--sp-3);
		background: linear-gradient(180deg, transparent, rgba(232, 217, 186, 0.97) 40%);
	}

	.row button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2.9rem;
	}

	.row :global(.gilt) {
		font-size: var(--fs-lg);
		padding-inline: var(--sp-7);
	}

	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--ink-muted);
	}

	.credit {
		margin: 0;
		font-size: var(--fs-2xs);
		color: var(--ink-muted);
	}

	.backdrop .link.link:not(:disabled),
	.backdrop .link.link:not(:disabled):hover {
		min-height: 0;
		padding: 0;
		border: 0;
		background: none;
		box-shadow: none;
		color: var(--ink-muted);
		text-decoration: underline;
		font-family: var(--font-ui);
		font-size: inherit;
		font-weight: 400;
		letter-spacing: 0;
		text-shadow: none;
		transform: none;
	}

	@media (max-width: 48rem) {
		.row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--sp-4);
		}

		.row button {
			justify-content: center;
			padding-inline: var(--sp-3);
		}

		.row button:first-child {
			grid-column: 1 / -1;
		}

		.tally {
			grid-template-columns: repeat(2, 1fr);
		}

		dt {
			flex-basis: 45%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.party li,
		.tally li {
			animation: none;
		}
	}
</style>
