<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import Case from './Case.svelte';
	import Plank from './Plank.svelte';

	/**
	 * A bookcase: the items stand in rows, each row on its own shelf board with a lit lip and a shadow
	 * on the wall below. How many fit a row follows the width, so the boards always run the full
	 * width and the last row's board is whole too.
	 */
	interface Props {
		items: T[];
		/** Stands one item; it renders an `li` (a LibraryBook, a SkeletonBook). */
		book: Snippet<[T, number]>;
		/** Names the list for assistive tech. */
		label: string;
		/** A search in flight: the last results stay, dimmed. */
		stale?: boolean;
		/** Placeholders, not books: hidden from assistive tech. */
		decorative?: boolean;
	}

	let { items, book, label, stale = false, decorative = false }: Props = $props();

	let width = $state(typeof window === 'undefined' ? 1000 : Math.min(window.innerWidth, 1180) - 70);
	const cols = $derived(Math.max(1, Math.min(5, Math.floor(width / (width < 600 ? 138 : 196)))));
	const rows = $derived.by(() => {
		const out: { item: T; index: number }[][] = [];
		items.forEach((item, index) => {
			if (index % cols === 0) out.push([]);
			out[out.length - 1].push({ item, index });
		});
		return out;
	});
</script>

<Case {stale}>
	<div
		class="rows"
		role={decorative ? 'presentation' : 'list'}
		aria-label={decorative ? undefined : label}
		aria-hidden={decorative ? 'true' : undefined}
		bind:clientWidth={width}
	>
		{#each rows as row, r (r)}
			<div class="row" role="presentation" style:--cols={cols}>
				{#each row as { item, index } (index)}
					<div class="cell" style:--i={index % cols} role="presentation">
						{@render book(item, index)}
					</div>
				{/each}
				<Plank />
			</div>
		{/each}
	</div>
</Case>

<style>
	.rows {
		display: grid;
	}

	.row {
		position: relative;
		container-type: inline-size;
		/* Every board sits this far down its row: books are as wide as the track, a little taller. */
		--slot-h: calc(100cqi / var(--cols) * 1.3);
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		align-items: start;
	}

	.cell {
		display: contents;
	}
</style>
