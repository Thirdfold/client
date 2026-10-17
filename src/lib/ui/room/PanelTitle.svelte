<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/** A panel's name: a small gilt ribbon with its icon, the heading assistive tech hears. */
	interface Props {
		icon: IconName;
		level?: 2 | 3;
		children: Snippet;
	}
	let { icon, level = 2, children }: Props = $props();
</script>

<svelte:element this={`h${level}`} class="g-banner ribbon">
	<Icon name={icon} size="1.05em" />
	<span>{@render children()}</span>
</svelte:element>

<style>
	.ribbon {
		justify-self: start;
		grid-auto-flow: column;
		gap: var(--sp-4);
		min-width: 0;
		padding: 0.3rem 2.2rem 0.35rem 2rem;
		font-size: var(--fs-md);
		margin: 0;
	}
</style>
