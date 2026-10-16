<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { LibraryListing, StoryFacts } from '$lib/game/library';
	import { Frame, Icon } from './game';
	import { describePlays } from './rating';
	import { inSentence, lastPlayed } from './when';
	import StoryCover from './StoryCover.svelte';
	import Stars from './Stars.svelte';
	import type { Flag } from './library/flags';

	/**
	 * One adventure opened in the library, as a story ledger: the cover standing in the lamplight
	 * beside a parchment page with the title, who made it, how it is rated, what it holds counted out
	 * (chapters, places, players, endings), what it is about, how it opens, and a large gilt plaque to
	 * run it. `listing` is there for a published adventure, absent for a built-in one.
	 */
	interface Props {
		id: string;
		title: string;
		about: string;
		opening: string;
		facts: StoryFacts;
		listing: LibraryListing | null;
		flag?: Flag | null;
		actions: Snippet;
	}

	let { id, title, about, opening, facts, listing, flag = null, actions }: Props = $props();

	const stats = $derived([
		{ icon: 'book', n: facts.chapters, one: 'Chapter', many: 'Chapters', pre: '' },
		{ icon: 'map', n: facts.places, one: 'Place', many: 'Places', pre: '' },
		{ icon: 'users', n: facts.characters, one: 'Player', many: 'Players', pre: 'up to ' },
		{ icon: 'flag', n: facts.endings, one: 'Ending', many: 'Endings', pre: '' }
	] as const);
</script>

<article class="story">
	<div class="stand">
		<div class="cover g-pop">
			<StoryCover {id} {title} size="large" {flag} />
		</div>
		<span class="board" aria-hidden="true"></span>
	</div>

	<Frame variant="parchment" class="ledger g-rise">
		<p class="kicker"><Icon name="scroll" /> Story ledger</p>
		<h1>{title}</h1>
		{#if listing}
			<p class="byline">
				by <a href={resolve(`/library?creator=${listing.creator.id}`)}>{listing.creator.name}</a>
				{#if listing.version > 1}· version {listing.version}{/if}
				· updated {inSentence(lastPlayed(listing.publishedAt))}
			</p>
			<p class="rated">
				<Stars rating={listing.rating} /> <span>· {describePlays(listing.plays)}</span>
			</p>
		{:else}
			<p class="byline">Made with thirdfold · on every new table</p>
		{/if}

		<hr class="g-rule" />

		<dl class="stats">
			{#each stats as s (s.one)}
				<div class="stat">
					<dt><Icon name={s.icon} /> {s.n === 1 ? s.one : s.many}</dt>
					<dd>{s.pre}{s.n}</dd>
				</div>
			{/each}
		</dl>

		{#if about}<p class="about">{about}</p>{/if}
		{#if opening}
			<blockquote class="opening"><p>{opening}</p></blockquote>
		{/if}

		<div class="actions">{@render actions()}</div>
	</Frame>
</article>

<style>
	.story {
		display: grid;
		grid-template-columns: minmax(12rem, 19rem) minmax(0, 1fr);
		gap: var(--sp-8) clamp(var(--sp-7), 4vw, 3.5rem);
		align-items: center;
		max-width: 62rem;
		margin: 0 auto;
	}

	/* The book stands on a board in a pool of lamplight, leaning a little. */
	.stand {
		position: relative;
		padding: 0 8% 1.1rem;
	}

	.stand::before {
		content: '';
		position: absolute;
		inset: -12% -22% -6%;
		background: radial-gradient(closest-side, rgba(255, 190, 110, 0.22), transparent 75%);
		pointer-events: none;
	}

	.cover {
		position: relative;
		transform: rotate(-2.5deg);
		filter: drop-shadow(0 16px 16px rgba(0, 0, 0, 0.55));
	}

	.board {
		position: absolute;
		left: -4%;
		right: -4%;
		bottom: 0.1rem;
		height: 1.05rem;
		border-radius: 3px;
		background:
			linear-gradient(
				180deg,
				rgba(255, 228, 176, 0.6) 0 1px,
				rgba(255, 228, 176, 0.14) 1px 3px,
				transparent 3px
			),
			linear-gradient(180deg, #4d3827, #2a1e14);
		box-shadow:
			0 10px 14px rgba(0, 0, 0, 0.6),
			inset 0 -2px 0 rgba(0, 0, 0, 0.55);
		z-index: -1;
	}

	/* The ledger's own colours: ink on parchment, with the remapped tokens the page's links use. */
	.story :global(.ledger) {
		--muted: var(--ink-muted);
		--accent: var(--ink-accent);
		--text: var(--ink);
		--border: var(--vellum-edge);
		--star-on: #a35f10;
		--star-on-edge: #6d3f08;
		--star-off: rgba(94, 74, 53, 0.16);
		--star-edge: rgba(94, 74, 53, 0.55);
		--star-glow: transparent;
		display: grid;
		gap: var(--sp-5);
		padding: clamp(1.6rem, 4vw, 2.6rem) clamp(1.5rem, 4vw, 2.8rem) clamp(1.5rem, 3.5vw, 2.4rem);
	}

	.story :global(.ledger a) {
		color: var(--ink-accent);
		text-decoration-color: rgba(138, 59, 59, 0.5);
	}

	p {
		margin: 0;
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: 0.45em;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--ink-accent);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.9rem, 4.4vw, 2.7rem);
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.6);
	}

	.byline {
		color: var(--ink-muted);
		font-size: var(--fs-md);
	}

	.rated {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.4rem;
		color: var(--ink-muted);
	}

	hr.g-rule {
		margin: var(--sp-3) 0 0;
		opacity: 0.85;
	}

	/* What it holds, counted out: four stamps along the page. */
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin: 0;
		border-block: 1px solid var(--vellum-edge);
	}

	.stat {
		display: grid;
		gap: 0.1rem;
		justify-items: center;
		padding: var(--sp-5) var(--sp-3);
		text-align: center;
	}

	.stat + .stat {
		border-left: 1px solid var(--vellum-edge);
	}

	.stat dt {
		order: 2;
		display: flex;
		align-items: center;
		gap: 0.3em;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--ink-muted);
	}

	.stat dt :global(.icon) {
		color: var(--ink-accent);
	}

	.stat dd {
		order: 1;
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.1rem, 2.6vw, 1.55rem);
		font-weight: 700;
		line-height: 1.1;
		color: var(--ink);
	}

	.about {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.4;
		color: var(--ink);
	}

	/* The story's own first words, in its voice, under a gilt-ruled bracket. */
	.opening {
		margin: 0;
		padding: var(--sp-4) var(--sp-6) var(--sp-4) var(--sp-7);
		border-left: 3px double var(--ink-accent);
		background: linear-gradient(90deg, rgba(138, 59, 59, 0.07), transparent);
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--fs-lg);
		color: var(--ink);
	}

	.actions {
		display: grid;
		gap: var(--sp-4);
		justify-items: center;
		margin-top: var(--sp-4);
		text-align: center;
	}

	/* The plaque: the biggest key on the page, in brass, with a glint that sweeps it now and then. */
	.actions :global(.run) {
		min-width: min(100%, 18rem);
		min-height: 3.6rem;
		padding: 0.6rem 2.6rem;
		font-size: 1.55rem;
		letter-spacing: 0.06em;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
	}

	.actions :global(p) {
		font-size: var(--fs-sm);
		color: var(--ink-muted);
	}

	.actions :global(button.link) {
		color: var(--ink-accent);
	}

	@media (max-width: 48rem) {
		.story {
			grid-template-columns: 1fr;
			gap: var(--sp-7);
		}

		.stand {
			width: min(13rem, 62%);
			margin: 0 auto;
		}

		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.stat:nth-child(3) {
			border-left: 0;
		}

		.stat:nth-child(n + 3) {
			border-top: 1px solid var(--vellum-edge);
		}

		.opening {
			padding-inline: var(--sp-6) var(--sp-4);
		}

		.actions :global(.run) {
			width: 100%;
		}

		.actions :global(button.link),
		.byline a {
			min-height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cover {
			animation: none;
		}
	}
</style>
