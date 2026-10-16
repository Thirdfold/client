<script lang="ts">
	import { Icon } from '$lib/ui/game';
	import Steps from './Steps.svelte';
	import { isTouchDevice } from './keys';
	import { currentStep, TUTORIAL, type TutorialProgress, type TutorialStepId } from './tutorial';

	/** Onboarding: one thing to try at a time, done when the player does it. */
	interface Props {
		progress: TutorialProgress;
		/** Whether there is a first find here to walk up to and inspect. */
		hasFind: boolean;
		/** What the player found, for the "you've discovered something" step. */
		found: { title: string; text: string } | null;
		/** The first goal, to point the player at when they are ready. */
		goal: string | null;
		/** A step done by pressing its button. */
		onDone(step: TutorialStepId): void;
		onStart(): void;
		onSkip(): void;
	}

	let { progress, hasFind, found, goal, onDone, onStart, onSkip }: Props = $props();

	const touch = isTouchDevice();
	const steps = $derived(TUTORIAL.filter((s) => hasFind || !s.needsFind));
	const step = $derived(currentStep(progress, hasFind));
	const number = $derived(step ? steps.indexOf(step) + 1 : steps.length);
</script>

<section class="coach g-frame" aria-live="polite" aria-label="How to play">
	<header class="top">
		<span class="seal" aria-hidden="true"><Icon name="scroll" size="1.3rem" /></span>
		<span class="g-tag brass">How to play</span>
	</header>
	<Steps current={step ? 4 : 5} />
	{#if step}
		<h3>{step.title}</h3>
		<p class="count num">Try this · {number} of {steps.length}</p>
		{#if step.id === 'discovered' && found}
			<div class="found">
				<strong>{found.title}</strong>
				<span>{found.text}</span>
			</div>
		{/if}
		<p class="text">{touch ? (step.touchText ?? step.text) : step.text}</p>
		{#if step.button}
			<button type="button" class="primary" onclick={() => onDone(step.id)}>{step.button}</button>
		{/if}
		<ul class="dots" aria-hidden="true">
			{#each steps as s (s.id)}
				<li class:done={progress.done.includes(s.id)} class:now={s.id === step.id}></li>
			{/each}
		</ul>
		<button type="button" class="skip ghost" onclick={onSkip}>Skip the tutorial</button>
	{:else}
		<h3>You’re ready</h3>
		<p class="count">All done</p>
		<p class="text">
			Your goals are in the story panel on the right, and they change as the story moves on.
			{#if goal}Start here: <strong>{goal}</strong>{/if}
		</p>
		<button type="button" class="primary" onclick={onStart}>Start</button>
	{/if}
</section>

<style>
	/* A quest scroll pinned under the room plate, lit with the table's rune light. */
	.coach {
		position: absolute;
		top: var(--below-bar, 5rem);
		left: var(--edge, 0.75rem);
		width: min(20rem, calc(100% - 1.5rem));
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5) var(--sp-6) var(--sp-6);
		border-radius: var(--radius-lg);
		box-shadow:
			inset 0 0 0 1px rgba(159, 215, 255, 0.55),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-md),
			0 0 30px var(--rune-glow);
		z-index: var(--z-hud);
		animation: g-slide-left 420ms var(--spring) both;
	}

	.coach > :global(*) {
		position: relative;
		z-index: 1;
	}

	.top {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		color: var(--rune);
	}

	.count {
		margin: calc(-1 * var(--sp-3)) 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	h3 {
		margin: var(--sp-2) 0 0;
		font-size: var(--fs-xl);
		color: var(--rune);
	}

	.text {
		margin: 0;
		line-height: 1.45;
		font-size: var(--fs-sm);
	}

	.found {
		display: grid;
		gap: var(--sp-2);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--glow);
		border-radius: var(--radius-md);
		background: var(--glow-wash);
		font-family: var(--font-display);
		font-size: var(--fs-sm);
		line-height: 1.4;
	}

	.found strong {
		font-family: inherit;
		color: var(--glow);
	}

	.dots {
		display: flex;
		gap: var(--sp-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dots li {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		border: 1px solid var(--gilt-line-strong);
		background: var(--panel-sunk);
	}

	.dots .done {
		background: var(--rune);
		border-color: var(--rune);
		box-shadow: 0 0 8px var(--rune-glow);
	}

	.dots .now {
		border-color: var(--rune);
		box-shadow: 0 0 0 2px var(--rune-glow);
	}

	.skip {
		justify-self: start;
		min-height: 2rem;
		padding: var(--sp-2) var(--sp-3);
		text-decoration: underline;
		font-size: var(--fs-sm);
	}

	.primary {
		justify-self: start;
	}

	@media (max-width: 48rem) {
		.coach {
			left: var(--sp-4);
			right: var(--sp-4);
			width: auto;
			top: var(--below-bar, 5rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.coach {
			animation: none;
		}
	}
</style>
