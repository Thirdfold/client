<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/** A drawer in the toolbox: a plate you press to slide open a long list. */
	interface Props {
		title: string;
		icon: IconName;
		open?: boolean;
		/** A count or a state at the plate's right end. */
		aside?: string;
		class?: string;
		children: Snippet;
	}
	let { title, icon, open = false, aside, class: extra = '', children }: Props = $props();
</script>

<details class="drawer {extra}" {open}>
	<summary>
		<Icon name={icon} size="1.1em" />
		<span class="title">{title}</span>
		{#if aside}<span class="aside">{aside}</span>{/if}
		<span class="chev" aria-hidden="true"><Icon name="chevron" size="1em" /></span>
	</summary>
	<div class="inner">{@render children()}</div>
</details>

<style>
	.drawer {
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 1px 0 rgba(240, 212, 158, 0.1);
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2.5rem;
		padding: var(--sp-3) var(--sp-5);
		border-radius: inherit;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--gilt);
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		background: var(--accent-wash);
		color: var(--gilt-hi);
	}

	.title {
		flex: 1;
		min-width: 0;
	}

	.aside {
		font-size: var(--fs-xs);
		font-weight: 400;
		letter-spacing: 0.03em;
		color: var(--muted);
	}

	.chev {
		display: inline-flex;
		transition: transform 180ms var(--ease-out);
	}

	.drawer[open] .chev {
		transform: rotate(90deg);
	}

	.drawer[open] summary {
		border-bottom: 1px solid rgba(0, 0, 0, 0.55);
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.inner {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
	}

	@media (max-width: 48rem) {
		summary {
			min-height: 2.75rem;
		}
	}
</style>
