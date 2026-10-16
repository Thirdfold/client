<script lang="ts">
	import { asset } from '$app/paths';
	import { FLAG_LABEL, type Flag } from './library/flags';

	/**
	 * An adventure as a book on the library's shelf: a leather-bound front board (its colour from the
	 * adventure's id, so it is always the same book) with a hinge groove, gilt tooling, the title
	 * stamped in gilt and thirdfold's mark pressed below it; the page block peeking out of the right
	 * and the foot, and a silk ribbon hanging from the pages. `flag` pins a corner sash on it.
	 * Decorative: the title (and the flag) are repeated in text beside it.
	 *
	 * `--gx` and `--gy` (percent) place the sheen; the shelf moves them as the pointer moves.
	 */
	interface Props {
		id: string;
		title: string;
		size?: 'shelf' | 'large';
		flag?: Flag | null;
	}

	let { id, title, size = 'shelf', flag = null }: Props = $props();

	/** Leathers a bindery would stock: oxblood, forest, navy, tan, plum, teal. */
	const LEATHERS = ['#5b2a1f', '#2f3d2a', '#243449', '#51341c', '#3b2340', '#1f3a3a'];
	/** Silk for the marker ribbon, always a contrast to the leather. */
	const SILKS = ['#c9a24a', '#a3412f', '#3f6f78', '#b98a5e'];
	/** Books are not all the same height: width over height, three heights. */
	const HEIGHTS = ['3 / 4', '3 / 4.2', '3 / 3.85'];

	const hash = $derived.by(() => {
		let h = 0;
		for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return h;
	});
	const leather = $derived(LEATHERS[hash % LEATHERS.length]);
	const silk = $derived(SILKS[(hash >>> 3) % SILKS.length]);
	const ratio = $derived(size === 'large' ? '3 / 4.1' : HEIGHTS[(hash >>> 5) % HEIGHTS.length]);
</script>

<div
	class="book"
	class:large={size === 'large'}
	style:--leather={leather}
	style:--silk={silk}
	style:--ratio={ratio}
	style:--mark={`url(${asset('/brand/thirdfold-mark-mono.svg')})`}
	aria-hidden="true"
>
	<span class="pages"></span>
	<span class="ribbon"></span>
	<span class="board">
		<span class="frame"></span>
		<span class="title">{title}</span>
		<span class="rule"></span>
		<span class="mark"></span>
		<span class="sheen"></span>
		{#if flag}<span class="sash {flag}"><span>{FLAG_LABEL[flag]}</span></span>{/if}
	</span>
</div>

<style>
	.book {
		--gold-a: #fbe7bb;
		--gold-b: #d7a04e;
		position: relative;
		display: block;
		container-type: inline-size;
		aspect-ratio: var(--ratio);
		color: var(--gold-a);
	}

	/* The page block: cream leaves with fine lines, seen at the right and the foot. */
	.pages {
		position: absolute;
		inset: 1.5% 0 0 3%;
		border-radius: 2px 4px 4px 2px;
		background:
			repeating-linear-gradient(90deg, rgba(120, 90, 50, 0.4) 0 1px, transparent 1px 3px) right /
				3.4% 100% no-repeat,
			repeating-linear-gradient(180deg, rgba(120, 90, 50, 0.4) 0 1px, transparent 1px 3px) bottom /
				100% 2.8% no-repeat,
			#e8d9b6;
		box-shadow: inset 0 0 0 1px rgba(60, 40, 20, 0.45);
	}

	/* A silk marker: out from between the leaves and over the edge of the shelf. */
	.ribbon {
		position: absolute;
		left: 63%;
		bottom: -0.9rem;
		width: 6.2%;
		height: 12%;
		min-width: 7px;
		background:
			linear-gradient(90deg, rgba(0, 0, 0, 0.25), transparent 30%, rgba(0, 0, 0, 0.2)), var(--silk);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%);
		box-shadow: 0 2px 3px rgba(0, 0, 0, 0.5);
		z-index: 1;
	}

	.board {
		position: absolute;
		inset: 0 3.4% 2.8% 0;
		z-index: 2;
		overflow: hidden;
		display: grid;
		grid-template-rows: 1fr auto auto;
		justify-items: center;
		align-items: center;
		padding: 15% 15% 9% 21%;
		border-radius: 3px 7px 7px 3px;
		background:
			/* the hinge: a groove with a lit lip either side */
			linear-gradient(
				90deg,
				rgba(0, 0, 0, 0.6) 0,
				rgba(0, 0, 0, 0.1) 2.2%,
				rgba(255, 232, 190, 0.18) 4.6%,
				rgba(0, 0, 0, 0.55) 7%,
				rgba(255, 232, 190, 0.1) 9.2%,
				transparent 13%
			),
			radial-gradient(130% 110% at 45% 25%, transparent 50%, rgba(0, 0, 0, 0.5)),
			radial-gradient(120% 80% at 70% 12%, rgba(255, 240, 215, 0.16), transparent 60%),
			var(--leather);
		box-shadow:
			inset 0 0 0 1px rgba(255, 236, 210, 0.1),
			inset 0 -3px 5px rgba(0, 0, 0, 0.35),
			1px 0 0 rgba(0, 0, 0, 0.5),
			0 6px 10px -2px rgba(0, 0, 0, 0.6);
		text-align: center;
	}

	/* Leather grain over the whole board. */
	.board::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--grain) 0 0 / 110px;
		mix-blend-mode: soft-light;
		opacity: 0.85;
		pointer-events: none;
	}

	/* Gilt tooling: a double rule with a small lozenge at every corner. */
	.frame {
		position: absolute;
		inset: 6.5% 7% 6% 14.5%;
		border: 1px solid rgba(235, 190, 110, 0.7);
		border-radius: 2px;
		pointer-events: none;
	}

	.frame::before {
		content: '';
		position: absolute;
		inset: 3px;
		border: 1px solid rgba(235, 190, 110, 0.38);
	}

	.frame::after {
		content: '';
		position: absolute;
		inset: -3px;
		--lozenge: radial-gradient(circle at center, #e9b865 0 2px, transparent 2.6px);
		background:
			var(--lozenge) top left / 7px 7px no-repeat,
			var(--lozenge) top right / 7px 7px no-repeat,
			var(--lozenge) bottom left / 7px 7px no-repeat,
			var(--lozenge) bottom right / 7px 7px no-repeat;
	}

	.title {
		position: relative;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		overflow: hidden;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(0.85rem, 10.4cqi, 2.1rem);
		line-height: 1.14;
		letter-spacing: 0.01em;
		text-wrap: balance;
		background: linear-gradient(180deg, var(--gold-a), var(--gold-b));
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.7));
	}

	/* A flourish rule under the title, a lozenge in its middle. */
	.rule {
		position: relative;
		width: 56%;
		height: 9px;
		margin-top: 6%;
		background:
			radial-gradient(circle at center, var(--gold-b) 0 2.4px, transparent 3px) center / 9px 9px
				no-repeat,
			linear-gradient(
					90deg,
					transparent,
					rgba(235, 190, 110, 0.75) 25%,
					rgba(235, 190, 110, 0.75) 75%,
					transparent
				)
				center / 100% 1px no-repeat;
	}

	.mark {
		width: 26%;
		aspect-ratio: 5 / 4;
		margin-top: 7%;
		background: linear-gradient(180deg, var(--gold-a), var(--gold-b));
		opacity: 0.8;
		mask: var(--mark) center / contain no-repeat;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.6));
	}

	/* Light on the leather: a soft spot that follows the pointer, and a fixed diagonal gloss. */
	.sheen {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(
				circle at var(--gx, 32%) var(--gy, 16%),
				rgba(255, 244, 222, 0.24),
				transparent 55%
			),
			linear-gradient(115deg, transparent 38%, rgba(255, 244, 222, 0.07) 44%, transparent 52%);
		pointer-events: none;
	}

	/* The corner sash: a ribbon across the top right corner, stitched at both edges. */
	.sash {
		position: absolute;
		top: 12%;
		right: -33%;
		width: 88%;
		transform: rotate(45deg);
		padding: 0.16em 0 0.2em;
		font-family: var(--font-label);
		font-weight: 700;
		font-size: clamp(0.62rem, 6.6cqi, 1.15rem);
		letter-spacing: 0.1em;
		line-height: 1.15;
		text-align: center;
		white-space: nowrap;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px rgba(255, 244, 214, 0.45);
	}

	.sash::before,
	.sash::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px dashed currentColor;
		opacity: 0.45;
	}

	.sash::before {
		top: 2px;
	}

	.sash::after {
		bottom: 2px;
	}

	.sash.new {
		background: var(--gilt-grad, linear-gradient(180deg, #f7dca4, #c98b3f));
		color: #1a120a;
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
	}

	.sash.pick {
		background: linear-gradient(180deg, #f3e6c8, #dcc79c);
		color: #2a1d12;
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.6);
	}

	.large .title {
		font-size: clamp(1.2rem, 9.6cqi, 2.5rem);
	}
</style>
