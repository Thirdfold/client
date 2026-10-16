<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A labelled control: the caption above, the control in its groove below. */
	interface Props {
		label: string;
		/** Put the caption and control on one line (a short number box). */
		inline?: boolean;
		children: Snippet;
	}
	let { label, inline = false, children }: Props = $props();
</script>

<label class="field" class:inline>
	<span class="lab">{label}</span>
	{@render children()}
</label>

<style>
	.field {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
		font-size: var(--fs-xs);
	}

	.field.inline {
		grid-template-columns: 1fr minmax(0, 5rem);
		align-items: center;
		gap: var(--sp-4);
	}

	.lab {
		color: var(--muted);
	}

	.field :global(select),
	.field :global(input:not([type='checkbox'], [type='range'], [type='color'])) {
		width: 100%;
		min-width: 0;
		font-size: var(--fs-sm);
	}
</style>
