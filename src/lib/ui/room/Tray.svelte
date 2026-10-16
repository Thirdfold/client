<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * A tool tray: an iron-framed box in the GM's toolbox, named by a plate along its top edge.
	 * Trays group what belongs together; the panel's own banner names the whole toolbox.
	 */
	interface Props {
		title: string;
		icon?: IconName;
		/** The heading level, so a tray nests correctly under its panel's title. */
		level?: 2 | 3 | 4;
		/** Something at the plate's right end: a count, a state, a small control. */
		aside?: Snippet | string;
		class?: string;
		children: Snippet;
		[attr: string]: unknown;
	}
	let { title, icon, level = 3, aside, class: extra = '', children, ...rest }: Props = $props();
</script>

<section class="g-frame iron tray {extra}" {...rest}>
	<header class="plate">
		<svelte:element this={`h${level}`} class="name">
			{#if icon}<Icon name={icon} size="1.1em" />{/if}
			<span>{title}</span>
		</svelte:element>
		{#if aside}<span class="aside"
				>{#if typeof aside === 'string'}{aside}{:else}{@render aside()}{/if}</span
			>{/if}
	</header>
	<div class="body">{@render children()}</div>
</section>

<style>
	.tray {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5) var(--sp-5) var(--sp-5);
		/* Trays sit inside a panel: a contact shadow, not a table-sized fall. */
		box-shadow:
			inset 0 0 0 1px rgba(214, 200, 184, 0.28),
			inset 0 0 0 5px rgba(0, 0, 0, 0.3),
			0 2px 0 rgba(0, 0, 0, 0.45),
			0 6px 10px rgba(8, 4, 0, 0.3);
	}

	.plate {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		min-height: 1.5rem;
		padding: 0 var(--sp-3) var(--sp-3);
		border-bottom: 1px solid rgba(0, 0, 0, 0.6);
		box-shadow: 0 1px 0 rgba(214, 200, 184, 0.12);
	}

	.name {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.07em;
		line-height: 1.1;
		color: var(--gilt);
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
	}

	.aside {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-align: right;
	}

	.body {
		display: grid;
		gap: var(--sp-4);
		padding-inline: var(--sp-2);
		min-width: 0;
	}
</style>
