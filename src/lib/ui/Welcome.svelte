<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CHARACTERS } from '$lib/adventure/characters';
	import { Icon, Portrait } from '$lib/ui/game';
	import { withoutArticle } from './room/names';
	import StoryCard from './room/StoryCard.svelte';
	import Steps from './Steps.svelte';
	import { trapFocus } from './trap-focus';

	/**
	 * A new player's arrival: where they are (the server's words), what to do
	 * first, and whether to learn how to play or go straight in.
	 */
	interface Props {
		adventure: AdventureView;
		characterName: string;
		onLearn(): void;
		onSkip(): void;
	}

	let { adventure, characterName, onLearn, onSkip }: Props = $props();

	const goal = $derived(adventure.objectives.find((o) => !o.done && !o.optional));
	const color = $derived(
		Object.values(CHARACTERS).find((c) => c.name === characterName)?.color ?? undefined
	);
</script>

<div class="backdrop">
	<div
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="welcome-title"
		tabindex="-1"
		use:trapFocus
		onkeydown={(e) => e.key === 'Escape' && onSkip()}
	>
		<div class="track"><Steps current={3} /></div>
		<StoryCard banner="Chapter {adventure.chapter.number}" class="welcome">
			<header>
				<h2 id="welcome-title">{adventure.welcome.title}</h2>
				<p class="who">
					<Portrait name={withoutArticle(characterName)} label={characterName} {color} size={34} />
					<span>{adventure.title} · {characterName}</span>
				</p>
			</header>
			<hr class="flourish" />
			<p class="text">{adventure.welcome.text}</p>
			{#if goal}
				<p class="goal">
					<span class="mark" aria-hidden="true"><Icon name="flag" size="1.3em" /></span>
					<span class="body">
						<span class="label">Your first goal</span>
						<span class="what">{goal.text}</span>
					</span>
				</p>
			{/if}
			<div class="actions">
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="primary big" onclick={onLearn} autofocus>
					<Icon name="play" /> Show me how to play
				</button>
				<button type="button" onclick={onSkip}>I know how to play</button>
			</div>
		</StoryCard>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 5rem var(--sp-6) var(--sp-6);
		background: radial-gradient(90% 80% at 50% 45%, rgba(10, 8, 6, 0.45), rgba(10, 8, 6, 0.82));
		overflow-y: auto;
		z-index: var(--z-panel);
	}

	.dialog {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-8);
		width: min(36rem, 100%);
		margin-block: auto;
	}

	/* The quest track sits on the table, above the card. */
	.track {
		justify-self: center;
		width: 100%;
		overflow-x: auto;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--radius-md);
		background: rgba(16, 11, 8, 0.7);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	header {
		display: grid;
		justify-items: center;
		gap: var(--sp-4);
		text-align: center;
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

	.who {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.06em;
		color: var(--ink-muted);
	}

	.text {
		margin: 0;
		max-width: 60ch;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.5;
		color: var(--ink);
		text-wrap: pretty;
	}

	.text::first-letter {
		float: left;
		margin: 0.04em 0.1em 0 0;
		font-size: 3.2em;
		line-height: 0.78;
		font-weight: 700;
		color: var(--ink-accent);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
	}

	/* The first goal is a note pinned to the card. */
	.goal {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: var(--sp-5);
		margin: 0;
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid rgba(109, 79, 40, 0.6);
		border-radius: var(--radius-md);
		background: rgba(255, 250, 235, 0.5);
		box-shadow:
			inset 0 2px 5px rgba(90, 60, 30, 0.25),
			0 1px 0 rgba(255, 250, 235, 0.7);
	}

	.mark {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #b65b50 0, #8a3b3b 45%, #5c2323 100%);
		color: #ffe9dc;
		box-shadow: 0 2px 3px rgba(60, 20, 10, 0.5);
	}

	.body {
		display: grid;
		gap: var(--sp-1);
	}

	.label {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--ink-accent);
	}

	.what {
		font-family: var(--font-display);
		font-size: var(--fs-md);
		line-height: 1.35;
		color: var(--ink);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-5);
	}

	.actions button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
	}

	.big {
		min-height: 3rem;
		padding-inline: var(--sp-8);
		font-size: var(--fs-lg);
	}
</style>
