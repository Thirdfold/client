<script lang="ts">
	// The Controls popover (#279): every binding from keys.ts. A button with
	// aria-expanded; Escape closes it and puts focus back on the button.
	import { controlGroups } from './keys';

	let { gm = false }: { gm?: boolean } = $props();

	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	const groups = $derived(controlGroups(gm));

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopPropagation();
			open = false;
			button?.focus();
		}
	}
</script>

<span class="controls" onkeydown={onKeydown} role="presentation">
	<button
		bind:this={button}
		type="button"
		aria-expanded={open}
		aria-controls="controls-help"
		onclick={() => (open = !open)}
	>
		Controls
	</button>
	{#if open}
		<div id="controls-help" class="popover panel" role="region" aria-label="Controls">
			{#each groups as group (group.title)}
				<h3>{group.title}</h3>
				<dl>
					{#each group.rows as row (row.label)}
						<dt>{row.label}</dt>
						<dd>
							{#each row.keys as key (key)}<kbd>{key}</kbd>{/each}
						</dd>
					{/each}
				</dl>
			{/each}
		</div>
	{/if}
</span>

<style>
	.controls {
		position: relative;
	}

	.popover {
		position: absolute;
		top: calc(100% + var(--sp-2));
		right: 0;
		z-index: 20;
		width: min(22rem, calc(100vw - 2rem));
		max-height: 70vh;
		overflow-y: auto;
		font-size: var(--fs-sm);
	}

	h3 {
		margin: var(--sp-3) 0 var(--sp-1);
		font-size: var(--fs-sm);
	}

	h3:first-child {
		margin-top: 0;
	}

	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-1) var(--sp-3);
		margin: 0;
	}

	dd {
		margin: 0;
		display: flex;
		gap: var(--sp-1);
		justify-content: flex-end;
		flex-wrap: wrap;
	}
</style>
