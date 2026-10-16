<script lang="ts">
	import type { Rating } from '$lib/game/library';
	import { plural } from './rating';

	/**
	 * A rating as the library shows it: five gilt stars filled to the average, then the number and the
	 * count in words. The stars are decoration, read out as "out of 5". `--star-on` and `--star-off`
	 * recolour them (on parchment, for one).
	 */
	let { rating }: { rating: Rating | null } = $props();

	const fill = $derived(rating ? Math.max(0, Math.min(5, rating.average)) / 5 : 0);
	// A five-pointed star in a 20-unit box; five of them make a 100 x 20 strip.
	const STAR = 'M10 1.6l2.5 5.5 6 .7-4.4 4.1 1.2 5.9L10 14.8l-5.3 2.9 1.2-5.9L1.5 7.8l6-.7z';
</script>

<span class="rating">
	<span class="stars" aria-hidden="true">
		<svg viewBox="0 0 100 20" class="off">
			{#each [0, 1, 2, 3, 4] as i (i)}<path d={STAR} transform="translate({i * 20} 0)" />{/each}
		</svg>
		{#if rating}
			<svg viewBox="0 0 100 20" class="on" style:clip-path="inset(0 {(1 - fill) * 100}% 0 0)">
				{#each [0, 1, 2, 3, 4] as i (i)}<path d={STAR} transform="translate({i * 20} 0)" />{/each}
			</svg>
		{/if}
	</span>
	<span class="words">
		{#if rating}
			{rating.average.toFixed(1)}<span class="visually-hidden"> out of 5</span>
			· {plural(rating.count, 'rating')}
		{:else}
			Not rated yet
		{/if}
	</span>
</span>

<style>
	.rating {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.1rem 0.5rem;
		vertical-align: middle;
	}

	.stars {
		position: relative;
		display: inline-block;
		width: 5.2em;
		height: 1.04em;
		flex: none;
	}

	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.off {
		fill: var(--star-off, rgba(240, 212, 158, 0.16));
		stroke: var(--star-edge, rgba(240, 212, 158, 0.5));
		stroke-width: 0.9;
		stroke-linejoin: round;
	}

	.on {
		fill: var(--star-on, var(--gilt, #e0a458));
		stroke: var(--star-on-edge, var(--gilt-lo, #8f5f27));
		stroke-width: 0.9;
		stroke-linejoin: round;
		filter: drop-shadow(0 0 3px var(--star-glow, rgba(224, 164, 88, 0.45)));
	}
</style>
