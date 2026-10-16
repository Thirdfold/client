<script lang="ts">
	/**
	 * The front of a shelf board: a lit top lip, grained walnut, and the shadow it throws on the wall
	 * below. The parent is `position: relative` and sets `--slot-h`, how far down the board sits.
	 */
</script>

<div class="plank" aria-hidden="true"></div>

<style>
	.plank {
		position: absolute;
		left: 0;
		right: 0;
		top: var(--slot-h, 12rem);
		z-index: 0;
		height: 1.05rem;
		background:
			linear-gradient(
				180deg,
				rgba(255, 228, 176, 0.62) 0 1px,
				rgba(255, 228, 176, 0.16) 1px 3px,
				transparent 3px
			),
			var(--grain) 0 0 / 140px,
			linear-gradient(180deg, #4d3827 0%, #3a2a1d 52%, #2a1e14 100%);
		background-blend-mode: normal, soft-light, normal;
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.55);
	}

	/* The shadow on the wall under the board. */
	.plank::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 100%;
		height: 1.1rem;
		background: linear-gradient(180deg, rgba(0, 0, 0, 0.6), transparent);
		pointer-events: none;
	}
</style>
