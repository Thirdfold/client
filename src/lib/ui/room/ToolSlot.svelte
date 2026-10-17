<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * A tool as a square slot: its icon over its name, the key it answers to in the corner.
	 * Pressed (selected) is the skin's lit, pressed-in plate.
	 */
	interface Props {
		icon: IconName;
		label: string;
		/** A toggle's state (aria-pressed). */
		pressed?: boolean;
		/** A radio-style choice instead of a toggle (aria-checked). */
		checked?: boolean;
		kbd?: string;
		title?: string;
		disabled?: boolean;
		danger?: boolean;
		/** A slot that spans a whole row, icon beside label. */
		wide?: boolean;
		expanded?: boolean;
		onclick(): void;
		/** Extra content after the label (a count, a swatch). */
		children?: Snippet;
	}
	let {
		icon,
		label,
		pressed,
		checked,
		kbd,
		title,
		disabled = false,
		danger = false,
		wide = false,
		expanded,
		onclick,
		children
	}: Props = $props();
</script>

<button
	type="button"
	class="slot"
	class:wide
	class:danger
	role={checked === undefined ? undefined : 'radio'}
	aria-pressed={checked === undefined ? pressed : undefined}
	aria-checked={checked}
	aria-expanded={expanded}
	{title}
	{disabled}
	{onclick}
>
	<Icon name={icon} size={wide ? '1.25em' : '1.6rem'} />
	<span class="label">{label}</span>
	{#if kbd}<kbd>{kbd}</kbd>{/if}
	{@render children?.()}
</button>

<style>
	.slot {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: var(--sp-2);
		min-width: 0;
		min-height: 3.6rem;
		padding: var(--sp-3) var(--sp-2) var(--sp-3);
		font-size: var(--fs-xs);
		line-height: 1.05;
		text-align: center;
	}

	.slot.wide {
		grid-auto-flow: column;
		justify-content: start;
		justify-items: start;
		gap: var(--sp-4);
		min-height: 2.5rem;
		padding: var(--sp-3) var(--sp-5);
		font-size: var(--fs-sm);
		text-align: left;
	}

	.label {
		min-width: 0;
		overflow-wrap: break-word;
	}

	kbd {
		position: absolute;
		top: 3px;
		right: 4px;
		padding: 0 4px;
		font-family: var(--font-label);
		font-size: 0.62rem;
		line-height: 1.3;
		border-bottom-width: 1px;
		opacity: 0.75;
	}

	.slot[aria-pressed='true'] kbd,
	.slot[aria-checked='true'] kbd {
		opacity: 1;
	}

	@media (max-width: 48rem) {
		.slot {
			min-height: 2.75rem;
		}
		kbd {
			display: none;
		}
	}
</style>
