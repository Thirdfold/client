<script lang="ts" module>
	import type { IconName } from '$lib/ui/game';

	export interface Drawer {
		id: string;
		label: string;
		icon: IconName;
		/** How many things are in it. */
		count?: number;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '$lib/ui/game';
	import { play } from '$lib/audio/engine';

	/**
	 * A row of drawer tabs with icons, and the open drawer under it. Left and right move between
	 * them, Home and End jump to the ends.
	 */
	let {
		drawers,
		active = $bindable(),
		label,
		children
	}: {
		drawers: readonly Drawer[];
		active: string;
		label: string;
		children: Snippet<[string]>;
	} = $props();

	const uid = $props.id();
	const current = $derived(drawers.some((d) => d.id === active) ? active : drawers[0]?.id);

	function open(id: string, focus = false) {
		if (id !== current) play([{ kind: 'ui', sound: 'select' }]);
		active = id;
		if (focus) document.getElementById(`${uid}-tab-${id}`)?.focus();
	}

	function onkey(e: KeyboardEvent) {
		const i = drawers.findIndex((d) => d.id === current);
		let next = -1;
		if (e.key === 'ArrowRight') next = (i + 1) % drawers.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + drawers.length) % drawers.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = drawers.length - 1;
		if (next < 0) return;
		e.preventDefault();
		open(drawers[next].id, true);
	}
</script>

<div class="drawers">
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="tabs" role="tablist" aria-label={label} onkeydown={onkey}>
		{#each drawers as d (d.id)}
			<button
				type="button"
				role="tab"
				class="tab"
				id="{uid}-tab-{d.id}"
				aria-selected={current === d.id}
				aria-controls="{uid}-panel"
				tabindex={current === d.id ? 0 : -1}
				onclick={() => open(d.id)}
			>
				<Icon name={d.icon} size="1.2em" />
				<span>{d.label}</span>
				{#if d.count !== undefined}<span class="count">{d.count}</span>{/if}
			</button>
		{/each}
	</div>
	<div class="open" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{current}">
		{#if current}{@render children(current)}{/if}
	</div>
</div>

<style>
	.drawers {
		display: grid;
		gap: 0;
		min-width: 0;
	}

	.tabs {
		display: flex;
		gap: var(--sp-3);
		padding: 0 var(--sp-4);
		overflow-x: auto;
		scrollbar-width: none;
		position: relative;
		z-index: 1;
	}

	.tab {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2.75rem;
		margin-bottom: -2px;
		padding: var(--sp-4) var(--sp-6) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-bottom: 0;
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		background: linear-gradient(180deg, #2a2420, #181311);
		box-shadow:
			inset 0 0 0 1px rgba(214, 200, 184, 0.2),
			inset 0 -6px 8px rgba(0, 0, 0, 0.35);
		color: var(--muted);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		text-shadow: none;
		transform: none;
	}

	.tab:not(:disabled):hover {
		border-color: var(--ink-line);
		background: linear-gradient(180deg, #342c27, #1d1714);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 -6px 8px rgba(0, 0, 0, 0.3);
		color: var(--text);
		transform: none;
	}

	.tab:not(:disabled):active {
		transform: none;
	}

	.tab[aria-selected='true'],
	.tab[aria-selected='true']:not(:disabled):hover {
		padding-top: var(--sp-5);
		border-color: var(--ink-line);
		background: linear-gradient(180deg, #4a3722, #2d2117 70%);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 3px 0 var(--gilt-hi),
			0 -4px 14px rgba(224, 164, 88, 0.22);
		color: var(--gilt-hi);
		transform: none;
	}

	.tab:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: -3px;
	}

	.count {
		min-width: 1.35rem;
		padding: 0 0.35rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.4);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-xs);
		line-height: 1.35;
		text-align: center;
		color: var(--gilt-hi);
	}

	.open {
		position: relative;
		display: grid;
		gap: var(--sp-6);
		padding: var(--sp-6) 0 0;
		border-top: 2px solid var(--gilt-line-strong);
		min-width: 0;
	}

	@media (max-width: 40rem) {
		.tab {
			padding-inline: var(--sp-5);
		}
	}
</style>
