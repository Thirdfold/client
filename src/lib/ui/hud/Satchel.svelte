<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * The satchel: the table's panels as bookmarks on the side of one leather case. Icon tabs run
	 * down its edge (along the top on a phone, where it is a bottom sheet); the chosen one opens its
	 * panel beside them, and choosing it again folds the case away so the table has the room.
	 */
	export interface SatchelTab {
		id: string;
		label: string;
		icon: IconName;
		/** What the tab holds, said on hover. */
		hint?: string;
		/** Something here wants a look (lit as a small ember). */
		dot?: boolean;
	}

	interface Props {
		tabs: readonly SatchelTab[];
		active: string;
		/** Whether the panel is unfolded (on a phone the sheet is always open when shown). */
		open: boolean;
		onSelect(id: string): void;
		onToggle(): void;
		children: Snippet<[string]>;
	}
	let { tabs, active, open, onSelect, onToggle, children }: Props = $props();

	const current = $derived(tabs.find((t) => t.id === active) ?? tabs[0]);

	let rail: HTMLElement | undefined = $state();

	/** Arrow keys walk the tabs (a tablist is one stop in the tab order). */
	function onKeydown(event: KeyboardEvent) {
		const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		const i = tabs.findIndex((t) => t.id === current?.id);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: (i + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) %
						tabs.length;
		event.preventDefault();
		onSelect(tabs[next].id);
		queueMicrotask(() => rail?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
	}
</script>

{#if current}
	<div class="satchel" data-open={open}>
		<div
			class="rail"
			role="tablist"
			aria-orientation="vertical"
			aria-label="Table panels"
			tabindex="-1"
			bind:this={rail}
			onkeydown={onKeydown}
		>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					role="tab"
					class="tab"
					id={`satchel-tab-${tab.id}`}
					aria-selected={tab.id === current.id}
					aria-controls="satchel-pane"
					tabindex={tab.id === current.id ? 0 : -1}
					title={tab.hint ? `${tab.label}: ${tab.hint}` : tab.label}
					onclick={() => onSelect(tab.id)}
				>
					<Icon name={tab.icon} size="1.35rem" />
					<span class="word">{tab.label}</span>
					{#if tab.dot}<span class="ember" aria-hidden="true"></span>{/if}
				</button>
			{/each}
		</div>
		<div
			class="pane g-frame"
			id="satchel-pane"
			role="tabpanel"
			aria-labelledby={`satchel-tab-${current.id}`}
		>
			<header class="head">
				<Icon name={current.icon} size="1.1rem" />
				<h2 class="title">{current.label}</h2>
				<button
					type="button"
					class="ghost fold"
					aria-label="Fold the satchel away"
					title="Fold away: give the table the room"
					onclick={onToggle}
				>
					<Icon name="chevron" size="1.1rem" />
				</button>
			</header>
			<div class="body">
				{@render children(current.id)}
			</div>
		</div>
	</div>
{/if}

<style>
	.satchel {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-3);
		max-height: 100%;
		min-height: 0;
		pointer-events: none;
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
		order: 2;
		pointer-events: auto;
	}

	.tab {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.9rem;
		height: 2.9rem;
		min-height: 0;
		padding: 0;
		border-radius: var(--radius-control);
	}

	/* The word is the tab's name, shown on hover and to assistive tech. */
	.tab .word {
		position: absolute;
		right: calc(100% + 0.55rem);
		top: 50%;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-solid);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			var(--shadow-sm);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.05em;
		white-space: nowrap;
		color: var(--gilt-hi);
		opacity: 0;
		pointer-events: none;
		transform: translate(6px, -50%);
		transition:
			opacity 120ms var(--ease-out),
			transform 120ms var(--ease-out);
	}

	.tab:hover .word,
	.tab:focus-visible .word {
		opacity: 1;
		transform: translate(0, -50%);
	}

	/* A chosen tab sits in the case's edge, lit; it does not sink like a pressed button. */
	.tab[aria-selected='true'] {
		transform: translateX(-3px);
		background: linear-gradient(180deg, #4a3520 0%, #34240f 100%);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 2px 6px rgba(0, 0, 0, 0.5),
			0 0 18px rgba(224, 164, 88, 0.4);
	}

	.ember {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--ember);
		box-shadow: 0 0 8px var(--ember-glow);
		animation: ember-pulse 1.6s ease-in-out infinite;
	}

	@keyframes ember-pulse {
		50% {
			opacity: 0.45;
			transform: scale(0.8);
		}
	}

	.pane {
		display: flex;
		flex-direction: column;
		width: var(--side-w, 19rem);
		max-width: calc(100vw - 6rem);
		max-height: 100%;
		min-height: 0;
		pointer-events: auto;
		animation: g-slide-right 320ms var(--spring) both;
	}

	.satchel[data-open='false'] .pane {
		display: none;
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: var(--sp-4) var(--sp-4) var(--sp-3) var(--sp-6);
		border-bottom: 1px solid var(--gilt-line);
		color: var(--gilt);
	}

	.title {
		flex: 1;
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
	}

	.fold {
		min-height: 2.25rem;
		min-width: 2.25rem;
		padding: 0;
		z-index: 1;
	}

	.body {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
		min-height: 0;
		padding: var(--sp-5) var(--sp-6) var(--sp-6);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.body > :global(.panel),
	.body :global(.section) {
		min-width: 0;
	}

	.body :global(.section-title) {
		margin-top: 0;
	}

	/* Phones: the bottom sheet. Tabs along its top edge, the panel filling the rest. */
	@media (max-width: 48rem) {
		.satchel {
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			height: 100%;
			max-height: 100%;
			border-radius: var(--radius-lg);
			background: var(--panel-solid);
			box-shadow:
				0 0 0 1px var(--ink-line),
				var(--shadow-lg);
			overflow: hidden;
			pointer-events: auto;
		}

		.rail {
			order: 0;
			flex-direction: row;
			justify-content: space-around;
			gap: var(--sp-3);
			padding: var(--sp-3) var(--sp-4);
			border-bottom: 1px solid var(--gilt-line);
			background: linear-gradient(180deg, #33261b, #281d14);
			overflow-x: auto;
		}

		.tab {
			flex: 1 0 2.75rem;
			max-width: 4.5rem;
			width: auto;
			height: 2.75rem;
		}

		.tab .word,
		.tab:hover .word,
		.tab:focus-visible .word {
			opacity: 0;
		}

		.tab[aria-selected='true'] {
			transform: none;
		}

		.satchel[data-open='false'] .pane {
			display: flex;
		}

		.pane {
			width: auto;
			max-width: none;
			flex: 1;
			border: 0;
			border-radius: 0;
			box-shadow: none;
			animation: none;
		}

		.pane::before,
		.pane::after {
			display: none;
		}

		.fold {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pane,
		.ember {
			animation: none;
		}
	}
</style>
