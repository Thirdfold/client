<script lang="ts">
	/**
	 * Two marks the shared icon set does not have yet (a magnifier and a pause bar), drawn to match
	 * its weight. Decorative: a label always sits beside them.
	 */
	let { name, size = '1.25em' }: { name: 'search' | 'pause'; size?: string } = $props();
</script>

<svg
	class="glyph"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'search'}
		<circle cx="10.5" cy="10.5" r="6.5" />
		<path d="M15.4 15.4 21 21" />
	{:else}
		<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.6" />
	{/if}
</svg>

<style>
	.glyph {
		flex: none;
		vertical-align: -0.2em;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.45));
	}
</style>
