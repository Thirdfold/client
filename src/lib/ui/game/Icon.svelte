<script lang="ts">
	import { ICONS, type IconName } from './icons';

	interface Props {
		name: IconName;
		/** Edge length; default 1.25em so an icon sits beside its label's text. */
		size?: string;
		/** A meaningful icon needs a label; a decorative one (beside text) stays hidden. */
		label?: string;
	}
	let { name, size = '1.25em', label }: Props = $props();
</script>

<svg
	class="icon"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from icons.ts, never user input -->
	{@html ICONS[name]}
</svg>

<style>
	.icon {
		flex: none;
		vertical-align: -0.2em;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.45));
	}
</style>
