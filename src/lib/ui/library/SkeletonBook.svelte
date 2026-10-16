<script lang="ts">
	/** A book still being fetched: a leather-coloured blank on the shelf and a few lines under it. */
	let { index = 0 }: { index?: number } = $props();
	const HEIGHTS = ['3 / 4', '3 / 4.2', '3 / 3.85'];
</script>

<li class="skeleton" style:--ratio={HEIGHTS[index % 3]}>
	<div class="slot">
		<span class="blank"></span>
	</div>
	<div class="caption">
		<span class="line wide"></span>
		<span class="line"></span>
		<span class="line short"></span>
	</div>
</li>

<style>
	.skeleton {
		position: relative;
		z-index: 1;
		display: block;
		list-style: none;
	}

	.slot {
		display: flex;
		align-items: flex-end;
		height: var(--slot-h, 14rem);
		padding-inline: var(--book-pad, 11%);
	}

	.blank {
		display: block;
		width: 100%;
		aspect-ratio: var(--ratio);
		border-radius: 3px 7px 7px 3px;
		background: linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0, transparent 12%), #2a1d14;
		box-shadow: inset 0 0 0 1px rgba(255, 236, 210, 0.08);
	}

	.caption {
		display: grid;
		gap: 0.6rem;
		padding: 1.65rem var(--book-pad, 11%) var(--sp-8);
	}

	.line {
		display: block;
		height: 0.8rem;
		border-radius: 3px;
		background: rgba(255, 238, 214, 0.08);
	}

	.line.wide {
		height: 1.1rem;
		width: 85%;
	}

	.line.short {
		width: 50%;
	}

	/* A lamp-light sweep across the blanks, so the shelf reads as filling, not frozen. */
	.blank,
	.line {
		position: relative;
		overflow: hidden;
	}

	.blank::after,
	.line::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(255, 220, 160, 0.12), transparent);
		transform: translateX(-100%);
		animation: sweep 1.6s ease-in-out infinite;
		animation-delay: calc(var(--i, 0) * 120ms);
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}

	@media (max-width: 48rem) {
		.skeleton {
			--book-pad: 7%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.blank::after,
		.line::after {
			animation: none;
		}
	}
</style>
