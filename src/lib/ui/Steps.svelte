<script lang="ts" module>
	/** One stop on the quest track. */
	export interface TrackStep {
		id: string;
		label: string;
		/** Done stops are filled brass with a tick; sealed ones are not open to you yet. */
		state?: 'todo' | 'done' | 'sealed';
		/** Spoken after the label (why a stop is sealed, what is waiting in it). */
		hint?: string;
		/** A small plaque on the disc: a count of things to fix. */
		flag?: number;
	}
</script>

<script lang="ts">
	import { Icon } from '$lib/ui/game';
	import { FIRST_SESSION } from './tutorial';

	/**
	 * A numbered quest track: discs joined by a gilt line, each done, active, waiting or sealed.
	 *
	 * Two ways to use it. `current` alone is the first-session track (an index into FIRST_SESSION,
	 * read only). With `steps` and `active` it is a row of buttons that picks one (the builder's
	 * rail), and `onselect` hears which.
	 */
	let {
		current,
		steps,
		active,
		onselect,
		label = steps ? 'Parts of the adventure' : 'Getting started'
	}: {
		current?: number;
		steps?: readonly TrackStep[];
		active?: string;
		onselect?: (id: string) => void;
		label?: string;
	} = $props();

	const stops = $derived<TrackStep[]>(
		steps
			? [...steps]
			: FIRST_SESSION.map((l, i) => ({
					id: l,
					label: l,
					state: i < (current ?? 0) ? ('done' as const) : ('todo' as const)
				}))
	);
	const activeIndex = $derived(steps ? stops.findIndex((s) => s.id === active) : (current ?? 0));

	let list = $state<HTMLOListElement>();
	$effect(() => {
		if (!steps) return;
		void active;
		list?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({
			inline: 'center',
			block: 'nearest'
		});
	});
</script>

{#snippet disc(s: TrackStep, i: number)}
	<span class="disc" aria-hidden="true">
		{#if s.state === 'done' && i !== activeIndex}
			<Icon name="check" size="1em" />
		{:else if s.state === 'sealed' && i !== activeIndex}
			<Icon name="lock" size="0.95em" />
		{:else}
			<span class="num">{i + 1}</span>
		{/if}
		{#if s.flag}<span class="flag">{s.flag}</span>{/if}
	</span>
	<span class="label">{s.label}</span>
{/snippet}

{#if steps}
	<nav class="track" aria-label={label}>
		<ol bind:this={list}>
			{#each stops as s, i (s.id)}
				<li
					class:done={s.state === 'done'}
					class:sealed={s.state === 'sealed'}
					class:now={i === activeIndex}
					class:lit={i > 0 && stops[i - 1].state === 'done'}
				>
					<button
						type="button"
						class="stop"
						aria-current={i === activeIndex ? 'page' : undefined}
						aria-label={s.hint ? `${s.label}, ${s.hint}` : undefined}
						onclick={() => onselect?.(s.id)}
					>
						{@render disc(s, i)}
					</button>
				</li>
			{/each}
		</ol>
	</nav>
{:else}
	<ol class="steps" aria-label={label}>
		{#each stops as s, i (s.id)}
			<li
				class:done={s.state === 'done'}
				class:now={i === activeIndex}
				class:lit={i > 0 && stops[i - 1].state === 'done'}
				aria-current={i === activeIndex ? 'step' : undefined}
			>
				<span class="stop">{@render disc(s, i)}</span>
			</li>
		{/each}
	</ol>
{/if}

<style>
	ol {
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.track ol {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		padding: var(--sp-4) var(--sp-5) var(--sp-3);
		scrollbar-width: thin;
	}

	.steps {
		flex-wrap: nowrap;
		overflow-x: auto;
		padding: var(--sp-2) 0;
		scrollbar-width: none;
	}

	li {
		position: relative;
		flex: 1 0 5.4rem;
		display: grid;
		justify-items: center;
		scroll-snap-align: center;
	}

	.steps li {
		flex-basis: 4.6rem;
	}

	/* The line between two discs: iron until the stop before it is done, then gilt. */
	li + li::before {
		content: '';
		position: absolute;
		top: 1.05rem;
		left: -50%;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(180deg, #060403, #1c1511);
		box-shadow: 0 1px 0 rgba(240, 212, 158, 0.12);
	}

	li.lit::before {
		background: var(--gilt-grad);
		box-shadow:
			0 0 8px rgba(224, 164, 88, 0.4),
			0 1px 0 var(--gilt-dark);
	}

	.stop {
		position: relative;
		z-index: 1;
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		min-width: 4.6rem;
		min-height: 0;
		padding: var(--sp-2) var(--sp-3) var(--sp-3);
		border: 0;
		border-radius: var(--radius-md);
		background: none;
		box-shadow: none;
		color: var(--muted);
		text-shadow: none;
		transform: none;
	}

	button.stop {
		cursor: pointer;
	}

	button.stop:not(:disabled):hover,
	button.stop:not(:disabled):active,
	button.stop:focus-visible {
		border: 0;
		background: none;
		box-shadow: none;
		outline: none;
		transform: none;
	}

	button.stop:not(:disabled):hover {
		color: var(--text);
	}

	button.stop:not(:disabled):hover .disc {
		transform: translateY(-2px);
	}

	button.stop:not(:disabled):active .disc {
		transform: translateY(1px);
	}

	button.stop:focus-visible .disc {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.disc {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.15rem;
		height: 2.15rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: linear-gradient(180deg, #2a2420, #181311);
		box-shadow:
			inset 0 0 0 1px rgba(214, 200, 184, 0.28),
			0 3px 0 var(--ink-line),
			0 6px 10px rgba(8, 4, 0, 0.45);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		color: var(--muted);
		transition:
			transform 140ms var(--spring),
			box-shadow 140ms var(--ease-out);
	}

	.num {
		font-variant-numeric: lining-nums;
		line-height: 1;
	}

	.label {
		max-width: 6.4rem;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
		line-height: 1.15;
		text-align: center;
		text-wrap: balance;
	}

	.done .disc {
		border-color: var(--gilt-dark);
		background: var(--gilt-grad);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			0 3px 0 var(--gilt-dark),
			0 6px 10px rgba(8, 4, 0, 0.45);
		color: var(--accent-text);
	}

	.done .label {
		color: var(--gilt-hi);
	}

	.sealed .disc {
		opacity: 0.8;
	}

	.now .disc {
		border-color: var(--gilt-dark);
		background: linear-gradient(180deg, #34250f, #1c1409);
		box-shadow:
			inset 0 0 0 2px var(--gilt),
			0 0 0 4px rgba(224, 164, 88, 0.2),
			0 0 22px rgba(224, 164, 88, 0.55),
			0 3px 0 var(--ink-line);
		color: var(--gilt-hi);
	}

	.now .label {
		color: var(--text);
		text-shadow: 0 0 12px rgba(224, 164, 88, 0.5);
	}

	/* A count of things to fix, pinned to the disc. */
	.flag {
		position: absolute;
		top: -0.45rem;
		right: -0.55rem;
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: #7a2e22;
		box-shadow: inset 0 0 0 1px rgba(255, 170, 150, 0.45);
		font-size: var(--fs-2xs);
		line-height: 1.25;
		color: #ffe6df;
	}

	/* The first-session track sits inside small panels: no hover lift, a lighter disc. */
	.steps .stop {
		padding-block: 0;
	}

	.steps .disc {
		width: 1.7rem;
		height: 1.7rem;
		font-size: var(--fs-sm);
	}

	.steps li + li::before {
		top: 0.78rem;
	}

	.steps .label {
		font-size: var(--fs-xs);
	}

	@media (prefers-reduced-motion: reduce) {
		.disc {
			transition: none;
		}

		button.stop:not(:disabled):hover .disc,
		button.stop:not(:disabled):active .disc {
			transform: none;
		}
	}
</style>
