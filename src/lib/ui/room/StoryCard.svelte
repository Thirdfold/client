<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { play } from '$lib/audio/engine';

	/**
	 * A cinematic story moment: a parchment card that unrolls over the table, a gilt chapter banner
	 * hung across its top edge, and a sound as it arrives. Welcome, a choice and an ending are all
	 * this card; they differ in what is written on it.
	 */
	interface Props {
		/** The banner's words: short ("A choice", "Chapter 2"). */
		banner: string;
		/** Give the banner an id to make it the card's heading (it is decoration otherwise). */
		bannerId?: string;
		/** Played once as the card arrives. */
		sound?: 'open' | 'fanfare' | 'chapter' | null;
		class?: string;
		children: Snippet;
		[attr: string]: unknown;
	}
	let { banner, bannerId, sound = 'open', class: extra = '', children, ...rest }: Props = $props();

	onMount(() => {
		if (sound) play([{ kind: 'ui', sound }]);
	});
</script>

<section class="g-frame parchment vellum story-card {extra}" {...rest}>
	{#if bannerId}
		<h2 class="g-banner ribbon" id={bannerId}>{banner}</h2>
	{:else}
		<p class="g-banner ribbon" aria-hidden="true">{banner}</p>
	{/if}
	{@render children()}
</section>

<style>
	.story-card {
		display: grid;
		gap: var(--sp-6);
		--card-pad: var(--sp-8);
		padding: 2.6rem var(--card-pad) var(--card-pad);
		border-radius: var(--radius-lg);
		/* Let down from the top edge; once it has landed nothing clips the banner or the shadow. */
		animation: unroll 620ms var(--ease-out) backwards;
	}

	.ribbon {
		position: absolute;
		top: -1.15rem;
		left: 50%;
		translate: -50% 0;
		z-index: 1;
		margin: 0;
		min-width: 11rem;
		max-width: calc(100% - 1.5rem);
		font-size: var(--fs-lg);
		white-space: nowrap;
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
		color: var(--accent-text);
		animation: g-pop 460ms var(--spring) 420ms backwards;
	}

	@keyframes unroll {
		from {
			clip-path: inset(0 -2rem 100% -2rem round var(--radius-lg));
			filter: brightness(1.25);
		}
		to {
			clip-path: inset(-3rem -2rem -3rem -2rem);
		}
	}

	/* Story text is ink on parchment; buttons on it are plates of leather and gilt. */
	.story-card.story-card :global(button.gilt:not(:disabled)),
	.story-card.story-card :global(button.gilt:not(:disabled):hover) {
		border-color: var(--gilt-dark);
		background: var(--gilt-grad);
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			inset 0 -3px 5px rgba(120, 70, 20, 0.35),
			0 3px 0 var(--gilt-dark),
			0 8px 16px rgba(8, 4, 0, 0.35),
			0 0 26px rgba(224, 164, 88, 0.3);
	}

	.story-card.story-card :global(button.gilt:not(:disabled):hover) {
		filter: brightness(1.08);
	}

	/* A flourish: a ruled line with a lozenge at its heart, in ink. */
	.story-card :global(.flourish) {
		height: 14px;
		margin: 0;
		border: 0;
		background:
			url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='14'><path d='M14 1 L21 7 L14 13 L7 7 Z' fill='%238a3b3b'/><path d='M1 7 H5 M23 7 H27' stroke='%238a3b3b' stroke-width='1.5'/></svg>")
				center / 28px 14px no-repeat,
			linear-gradient(
					90deg,
					transparent,
					rgba(94, 74, 53, 0.55) 18%,
					transparent 41%,
					transparent 59%,
					rgba(94, 74, 53, 0.55) 82%,
					transparent
				)
				center / 100% 1px no-repeat;
	}

	@media (max-width: 48rem) {
		.story-card {
			--card-pad: var(--sp-6);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.story-card,
		.ribbon {
			animation: none;
		}
	}
</style>
