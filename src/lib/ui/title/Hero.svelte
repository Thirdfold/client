<script lang="ts">
	import { asset } from '$app/paths';

	/** The title: the colour mark opening its book, the wordmark gilt and lit, the tagline. */
</script>

<header class="hero">
	<div class="lockup">
		<span class="halo" aria-hidden="true"></span>
		<h1 aria-label="thirdfold">
			<!-- The book opens and its map unfolds; the still mark for anyone who prefers less motion. -->
			<picture>
				<source
					srcset={asset('/brand/thirdfold-mark.svg')}
					media="(prefers-reduced-motion: reduce)"
				/>
				<img class="mark" src={asset('/brand/thirdfold-mark-animated.svg')} alt="" />
			</picture>
			<span class="word" aria-hidden="true">thirdfold</span>
		</h1>
	</div>
	<p class="tagline">A shared 3D tabletop for your game night.</p>
</header>

<style>
	.hero {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		text-align: center;
	}

	.lockup {
		position: relative;
		display: grid;
		justify-items: center;
	}

	/* The lamp over the title: a slow pool of warm light behind the letters. */
	.halo {
		position: absolute;
		inset: -40% -25%;
		background: radial-gradient(closest-side, rgba(255, 180, 90, 0.34), transparent 72%);
		opacity: 0;
		animation:
			halo-in 1600ms var(--ease-out) 300ms forwards,
			halo-breathe 6s ease-in-out 2s infinite;
		pointer-events: none;
	}

	h1 {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		margin: 0;
	}

	.mark {
		display: block;
		height: clamp(5rem, 11vw, 7.2rem);
		width: auto;
		filter: drop-shadow(0 0 18px rgba(255, 170, 80, 0.38)) drop-shadow(0 6px 0 rgba(0, 0, 0, 0.35));
		animation: mark-in 900ms var(--spring) both;
	}

	/*
	 * The wordmark: Alegreya Bold in brass, lower case always. The gradient is the metal; the
	 * second layer is the glint, which crosses the letters once the title has settled and again
	 * every few seconds.
	 */
	.word {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(3.6rem, 10vw, 6.2rem);
		line-height: 1.05;
		letter-spacing: 0.02em;
		padding: 0 0.04em 0.12em;
		color: var(--gilt);
		background:
			linear-gradient(105deg, transparent 42%, rgba(255, 252, 238, 0.95) 50%, transparent 58%) 160%
				0 / 260% 100% no-repeat,
			linear-gradient(180deg, #fbe6b6 0%, #f0c274 30%, #d9993f 62%, #a8722f 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		filter: drop-shadow(0 4px 0 #4d3010) drop-shadow(0 0 26px rgba(255, 160, 70, 0.35));
		animation:
			word-in 1300ms var(--ease-out) 350ms both,
			glint 7s ease-in-out 2.4s infinite;
	}

	.tagline {
		margin: 0;
		max-width: 36rem;
		font-family: var(--font-display);
		font-size: clamp(1.05rem, 2.4vw, 1.35rem);
		font-style: italic;
		font-weight: 500;
		color: var(--text);
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
		animation: tag-in 900ms var(--ease-out) 1100ms both;
	}

	@keyframes mark-in {
		from {
			opacity: 0;
			transform: translateY(-26px) scale(0.78) rotate(-4deg);
		}
	}

	@keyframes word-in {
		from {
			opacity: 0;
			letter-spacing: 0.3em;
			transform: translateY(14px);
			filter: blur(10px) drop-shadow(0 4px 0 #4d3010);
		}
	}

	@keyframes tag-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	@keyframes glint {
		0%,
		55% {
			background-position:
				160% 0,
				0 0;
		}
		85%,
		100% {
			background-position:
				-60% 0,
				0 0;
		}
	}

	@keyframes halo-in {
		to {
			opacity: 1;
		}
	}

	@keyframes halo-breathe {
		50% {
			transform: scale(1.06);
			opacity: 0.8;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.halo {
			animation: none;
			opacity: 1;
		}

		.mark,
		.word,
		.tagline {
			animation: none;
		}
	}

	@media (max-width: 47.99rem) {
		h1 {
			flex-direction: column;
			gap: 0;
		}

		.mark {
			height: 6.2rem;
		}

		.word {
			font-size: clamp(3.4rem, 17vw, 4.6rem);
		}
	}
</style>
