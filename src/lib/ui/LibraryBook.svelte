<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { play } from '$lib/audio/engine';
	import StoryCover from './StoryCover.svelte';
	import type { Flag } from './library/flags';

	/**
	 * An adventure standing on a library shelf: its cover and title (both open it), a few lines about
	 * it (`children`) and the way to run it (`action`). The shelf board belongs to the row it stands
	 * in (see library/Shelf.svelte); the book lifts and tilts toward the pointer, or on focus.
	 */
	interface Props {
		id: string;
		title: string;
		/** What opens it on the library page: `story=<id>` or `built=<id>`. */
		opens: string;
		/** A corner flag on the cover: new, or the story this browser ran last. */
		flag?: Flag | null;
		children: Snippet;
		action: Snippet;
	}

	let { id, title, opens, flag = null, children, action }: Props = $props();

	const href = $derived(resolve(`/library?${opens}`));
	let cover = $state<HTMLElement | null>(null);

	/** The cover leans toward the pointer a few degrees and its sheen follows. */
	function lean(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || !cover) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const box = cover.getBoundingClientRect();
		const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
		const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
		cover.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(2)}deg`);
		cover.style.setProperty('--rx', `${((0.5 - y) * 11).toFixed(2)}deg`);
		cover.style.setProperty('--gx', `${(x * 100).toFixed(0)}%`);
		cover.style.setProperty('--gy', `${(y * 100).toFixed(0)}%`);
	}

	function settle() {
		for (const p of ['--rx', '--ry', '--gx', '--gy']) cover?.style.removeProperty(p);
	}

	const opened = () => play([{ kind: 'ui', sound: 'open' }]);
</script>

<li class="book">
	<div class="slot" onpointermove={lean} onpointerleave={settle} role="presentation">
		<a class="cover" {href} tabindex="-1" bind:this={cover} onclick={opened}>
			<StoryCover {id} {title} {flag} />
		</a>
	</div>
	<div class="caption">
		<h3>
			<a {href} onclick={opened}>{title}</a>
			{#if flag}<span class="visually-hidden"> ({flag === 'new' ? 'new' : 'your pick'})</span>{/if}
		</h3>
		{@render children()}
		{@render action()}
	</div>
</li>

<style>
	.book {
		position: relative;
		z-index: 1;
		display: block;
		min-width: 0;
		animation: g-rise 520ms var(--ease-out) both;
		animation-delay: calc(var(--i, 0) * 70ms);
	}

	/* The space a book stands in: as tall as the shelf says, books resting on the board. */
	.slot {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		height: var(--slot-h, 14rem);
		padding-inline: var(--book-pad, 11%);
		perspective: 760px;
	}

	.cover {
		position: relative;
		display: block;
		width: 100%;
		border-radius: 4px;
		text-decoration: none;
		transform-origin: 50% 100%;
		transform: translateY(var(--lift, 0)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
		transition: transform 240ms var(--spring);
	}

	/* Where the book stood, a shadow on the board that deepens as it lifts. */
	.cover::before {
		content: '';
		position: absolute;
		left: 4%;
		right: -2%;
		bottom: -0.5rem;
		height: 0.8rem;
		border-radius: 50%;
		background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7), transparent 70%);
		transform: translateY(var(--drop, 0));
		z-index: -1;
		transition:
			transform 240ms var(--spring),
			opacity 240ms var(--ease-out);
	}

	/* Taking a book off the shelf. */
	.book:hover .cover,
	.book:focus-within .cover {
		--lift: -12px;
		--drop: 8px;
		filter: drop-shadow(0 10px 12px rgba(0, 0, 0, 0.5))
			drop-shadow(0 0 22px rgba(224, 164, 88, 0.2));
	}

	.cover:focus-visible {
		outline: none;
	}

	/* Below the board, on the wall: what the book is, and the key that runs it. */
	.caption {
		position: relative;
		z-index: 1;
		display: grid;
		align-content: start;
		gap: var(--sp-3);
		padding: 1.65rem var(--book-pad, 11%) var(--sp-8);
	}

	h3 {
		margin: 0;
		font-size: var(--fs-lg);
		line-height: 1.15;
	}

	h3 a {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--text);
		text-decoration: none;
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
	}

	h3 a:hover {
		text-decoration: underline;
		text-decoration-color: var(--gilt);
		text-underline-offset: 0.2em;
	}

	h3 a:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
		border-radius: var(--radius-sm);
		box-shadow: var(--ring);
	}

	.caption :global(p) {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.caption :global(.about) {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--fs-md);
		color: var(--text);
	}

	.caption :global(.run) {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		justify-self: start;
		margin-top: var(--sp-3);
		padding-inline: 0.9rem;
	}

	/* Brass marks the one action in reach: a book's key lights up as you reach for it. */
	.book:hover .caption :global(.run:not(:disabled)),
	.book:focus-within .caption :global(.run:not(:disabled)) {
		border-color: var(--gilt-dark);
		background: var(--gilt-grad);
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
	}

	@media (max-width: 48rem) {
		.book {
			--book-pad: 7%;
		}

		h3 a {
			padding-block: var(--sp-2);
		}

		.caption {
			gap: var(--sp-2);
		}

		.caption :global(.run) {
			min-height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.book {
			animation: none;
		}

		.cover,
		.cover::before {
			transition: none;
		}

		.book:hover .cover,
		.book:focus-within .cover {
			--lift: 0px;
			--drop: 0px;
		}
	}
</style>
