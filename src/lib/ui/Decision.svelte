<script lang="ts">
	import type { DecisionView } from '$lib/adventure/adventure';
	import { play } from '$lib/audio/engine';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';
	import StoryCard from './room/StoryCard.svelte';

	interface Props {
		decision: DecisionView;
		/** Whether this viewer may answer: the GM, or a player whose character is standing. */
		canAnswer: boolean;
		send(action: RoomAction): boolean;
	}

	let { decision, canAnswer, send }: Props = $props();

	/** The answer picked but not yet given: the first answer stands, so it takes a second step. */
	let picked = $state<string | null>(null);
	const pickedOption = $derived(decision.options.find((o) => o.id === picked) ?? null);

	const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

	function pick(id: string) {
		play([{ kind: 'ui', sound: 'select' }]);
		picked = id;
	}

	function answer() {
		if (!pickedOption) return;
		play([{ kind: 'ui', sound: 'decision' }]);
		send({ type: 'adventure_decide', decisionId: decision.id, optionId: pickedOption.id });
		picked = null;
	}

	function back() {
		play([{ kind: 'ui', sound: 'back' }]);
		picked = null;
	}
</script>

<div class="place">
	<StoryCard
		banner="A choice"
		bannerId="decision-title"
		aria-labelledby="decision-title"
		class="decision"
	>
		<!-- Announced as it appears: a choice everyone at the table should hear about. -->
		<p class="prompt" role="alert">{decision.prompt}</p>
		<hr class="flourish" />
		{#if pickedOption}
			<div class="confirm">
				<p class="chosen">
					<span class="seal" aria-hidden="true"><Icon name="check" size="1.2em" /></span>
					<span class="text">{pickedOption.label}</span>
				</p>
				<p class="stamp">
					<Icon name="lock" size="1.1em" /> This is final for the whole party. Is everyone agreed?
				</p>
				<div class="actions">
					<button type="button" class="primary" onclick={answer}>Choose this</button>
					<button type="button" class="ghost" onclick={back}>Go back</button>
				</div>
			</div>
		{:else}
			<ul class="options">
				{#each decision.options as option, i (option.id)}
					<li style:--i={i}>
						<button
							type="button"
							class="plaque"
							disabled={!canAnswer}
							onclick={() => pick(option.id)}
						>
							<span class="numeral" aria-hidden="true">{ROMAN[i] ?? i + 1}</span>
							<span class="text">{option.label}</span>
							<span class="quill" aria-hidden="true"><Icon name="pencil" size="1.3em" /></span>
						</button>
					</li>
				{/each}
			</ul>
			<p class="stamp" class:waiting={!canAnswer}>
				<Icon name={canAnswer ? 'lock' : 'hourglass'} size="1.1em" />
				{canAnswer
					? 'Talk it over. The first answer stands.'
					: 'The party is deciding. Anyone playing a character can answer.'}
			</p>
		{/if}
	</StoryCard>
</div>

<style>
	.place {
		position: absolute;
		/* Centred in the table's free space, below the header (RoomView sets these). */
		top: calc(var(--below-bar, 1rem) + 1.3rem);
		left: calc((100% - var(--free-right, 0px)) / 2);
		transform: translateX(-50%);
		width: min(34rem, calc(100% - var(--free-right, 0px) - 2rem));
		z-index: var(--z-overlay);
	}

	.place :global(.decision) {
		gap: var(--sp-5);
		padding-top: 2.4rem;
		padding-bottom: var(--sp-7);
	}

	.prompt {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.4;
		color: var(--ink);
		text-wrap: pretty;
	}

	.prompt::first-letter {
		float: left;
		margin: 0.04em 0.1em 0 0;
		font-size: 3.1em;
		line-height: 0.78;
		font-weight: 700;
		color: var(--ink-accent);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
	}

	.options {
		display: grid;
		gap: var(--sp-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.options li {
		animation: g-rise 420ms var(--ease-out) calc(520ms + var(--i) * 90ms) backwards;
	}

	/* A plaque: a slab of parchment you press, with a wax numeral and a quill that wakes on hover. */
	.plaque {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--sp-5);
		width: 100%;
		min-height: 3.4rem;
		padding: var(--sp-4) var(--sp-5) var(--sp-4) var(--sp-4);
		border: 1px solid #6d4f28;
		border-radius: var(--radius-md);
		background:
			var(--grain) 0 0 / 180px,
			linear-gradient(180deg, #f6ebd2, #e6d4ae);
		background-blend-mode: multiply, normal;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 600;
		letter-spacing: 0;
		line-height: 1.2;
		text-align: left;
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.6);
		box-shadow:
			inset 0 0 0 1px rgba(255, 250, 235, 0.7),
			inset 0 0 0 4px rgba(122, 91, 48, 0.1),
			0 3px 0 #6d4f28,
			0 8px 12px rgba(60, 40, 20, 0.28);
	}

	.plaque:not(:disabled):hover,
	.plaque:focus-visible {
		border-color: var(--ink-accent);
		background:
			var(--grain) 0 0 / 180px,
			linear-gradient(180deg, #fbf2dc, #ecdcb8);
		background-blend-mode: multiply, normal;
		box-shadow:
			inset 0 0 0 1px rgba(255, 250, 235, 0.9),
			inset 0 0 0 4px rgba(138, 59, 59, 0.14),
			0 3px 0 #6d4f28,
			0 10px 16px rgba(60, 40, 20, 0.32),
			0 0 22px rgba(138, 59, 59, 0.28);
		transform: translateY(-2px);
	}

	.plaque:not(:disabled):active {
		background:
			var(--grain) 0 0 / 180px,
			linear-gradient(180deg, #e9d8b2, #f2e5c8);
		background-blend-mode: multiply, normal;
		transform: translateY(2px);
		box-shadow:
			inset 0 3px 6px rgba(60, 40, 20, 0.35),
			0 1px 0 #6d4f28;
	}

	.plaque:focus-visible {
		outline: 2px solid var(--ink-accent);
		outline-offset: 3px;
	}

	.plaque:disabled {
		border-color: #a58b62;
		background: rgba(255, 250, 235, 0.35);
		color: var(--ink-muted);
		box-shadow: inset 0 0 0 1px rgba(255, 250, 235, 0.5);
		filter: none;
		opacity: 0.8;
		cursor: not-allowed;
	}

	.numeral,
	.seal {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #b65b50 0, #8a3b3b 45%, #5c2323 100%);
		box-shadow:
			inset 0 0 0 2px rgba(255, 220, 200, 0.22),
			0 2px 3px rgba(60, 20, 10, 0.5);
		color: #ffe9dc;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.02em;
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
		transition: transform 180ms var(--spring);
	}

	.plaque:disabled .numeral {
		background: #9d8a6c;
		box-shadow: none;
	}

	.plaque:not(:disabled):hover .numeral {
		transform: rotate(-8deg) scale(1.08);
	}

	.quill {
		color: var(--ink-accent);
		opacity: 0;
		transform: translate(-8px, 4px) rotate(-12deg);
		transition:
			opacity 160ms var(--ease-out),
			transform 220ms var(--spring);
	}

	.plaque:not(:disabled):hover .quill,
	.plaque:focus-visible .quill {
		opacity: 1;
		transform: none;
	}

	/* The sealed line: wax, small caps, a stamped rule above and below. */
	.stamp {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-4);
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border-block: 1px dashed rgba(138, 59, 59, 0.55);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 500;
		letter-spacing: 0.05em;
		line-height: 1.25;
		text-align: center;
		color: var(--ink-accent);
	}

	.stamp.waiting {
		border-color: rgba(94, 74, 53, 0.5);
		color: var(--ink-muted);
	}

	.confirm {
		display: grid;
		gap: var(--sp-5);
		animation: g-pop 380ms var(--spring) backwards;
	}

	.chosen {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: var(--sp-5);
		margin: 0;
		padding: var(--sp-5);
		border: 1px solid #6d4f28;
		border-radius: var(--radius-md);
		background: rgba(255, 250, 235, 0.55);
		box-shadow:
			inset 0 2px 5px rgba(90, 60, 30, 0.3),
			0 1px 0 rgba(255, 250, 235, 0.7);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.25;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-5);
	}

	@media (max-width: 48rem) {
		.plaque {
			min-height: 2.75rem;
			font-size: var(--fs-md);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.options li,
		.confirm {
			animation: none;
		}

		.plaque:not(:disabled):hover,
		.plaque:not(:disabled):hover .numeral,
		.quill {
			transform: none;
		}
	}
</style>
