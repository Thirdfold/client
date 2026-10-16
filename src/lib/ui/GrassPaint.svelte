<script lang="ts" module>
	import {
		type GrassDensity,
		type GrassHeight,
		GRASS_DENSITIES,
		GRASS_HEIGHTS
	} from '$lib/game/floor';

	/** The grass the floor tool paints instead of a floor (M74). */
	export interface GrassDraft {
		density: GrassDensity;
		height: GrassHeight;
	}
</script>

<script lang="ts">
	import Field from './room/Field.svelte';
	import ToolSlot from './room/ToolSlot.svelte';

	// The floor tool's two kinds of paint: floors (draft null), or grass.
	interface Props {
		draft: GrassDraft | null;
		onDraft(next: GrassDraft | null): void;
	}
	let { draft, onDraft }: Props = $props();
	/** The grass last chosen, for when the GM switches back from floors. */
	let last = $state<GrassDraft>({ density: 'normal', height: 'normal' });
	const choose = (next: GrassDraft) => onDraft((last = next));

	// Least to most, as the GM reads them.
	const bySize = <T extends { scale: number }>(list: readonly T[]) =>
		[...list].sort((a, b) => a.scale - b.scale);
	const DENSITIES = bySize(GRASS_DENSITIES);
	const HEIGHTS = bySize(GRASS_HEIGHTS);
</script>

<div class="kinds" role="group" aria-label="Paint">
	<ToolSlot wide icon="grid" label="Floor" pressed={!draft} onclick={() => onDraft(null)} />
	<ToolSlot
		wide
		icon="sparkle"
		label="Grass"
		pressed={!!draft}
		onclick={() => onDraft(draft ?? last)}
	/>
</div>
{#if draft}
	{@render grass(draft)}
{/if}

{#snippet grass(draft: GrassDraft)}
	<Field label="Density">
		<select
			value={draft.density}
			onchange={(e) => choose({ ...draft, density: e.currentTarget.value as GrassDensity })}
		>
			{#each DENSITIES as level (level.id)}
				<option value={level.id}>{level.name}</option>
			{/each}
		</select>
	</Field>
	<Field label="Height">
		<select
			value={draft.height}
			onchange={(e) => choose({ ...draft, height: e.currentTarget.value as GrassHeight })}
		>
			{#each HEIGHTS as level (level.id)}
				<option value={level.id}>{level.name}</option>
			{/each}
		</select>
	</Field>
	<p class="hint">
		Click two corners of an area. Grass grows on grass floors and grassy ground; None clears it.
		Only the look changes, never movement or sight.
	</p>
{/snippet}

<style>
	.kinds {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
	}

	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
