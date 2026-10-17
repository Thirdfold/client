<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A gilt ribbon naming a screen or a panel; the text is a real heading for assistive tech. */
	interface Props {
		level?: 1 | 2 | 3;
		class?: string;
		children: Snippet;
	}
	let { level = 2, class: extra = '', children }: Props = $props();
</script>

<svelte:element this={`h${level}`} class="g-banner {extra}">
	{@render children()}
</svelte:element>

<style>
	:global(.g-banner) {
		margin: 0;
	}
</style>
