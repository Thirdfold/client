<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** wood: the table's own furniture; iron: tool trays; parchment: the story's voice. */
		variant?: 'wood' | 'iron' | 'parchment';
		/** The element to render: a section, an aside, a div… */
		as?: 'div' | 'section' | 'aside' | 'article' | 'nav' | 'header' | 'footer';
		class?: string;
		children: Snippet;
		[attr: string]: unknown;
	}
	let { variant = 'wood', as = 'div', class: extra = '', children, ...rest }: Props = $props();
</script>

<svelte:element this={as} class="g-frame {variant} {extra}" {...rest}>
	{@render children()}
</svelte:element>
