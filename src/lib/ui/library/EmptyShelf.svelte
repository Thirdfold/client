<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '../game';
	import Case from './Case.svelte';
	import Plank from './Plank.svelte';

	/**
	 * A shelf with nothing on it: two brass bookends, the pale outline of a book that is not there,
	 * and a few plain words (`children`) on what to do about it. A scene, not a blank.
	 */
	let {
		children,
		ghost,
		trouble = false
	}: { children: Snippet; ghost?: Snippet; trouble?: boolean } = $props();
</script>

<Case>
	<div class="row">
		<div class="stand">
			<span class="bookend left"></span>
			<span class="gap" class:trouble aria-hidden="true">
				<span class="outline"></span>
				{#if trouble}
					<span class="sign"><Icon name="warn" size="2.2rem" /></span>
				{:else}
					<span class="dust"></span>
				{/if}
			</span>
			<span class="bookend right"></span>
		</div>
		<Plank />
		<div class="words">
			{@render children()}
			{#if ghost}<div class="ghost-action">{@render ghost()}</div>{/if}
		</div>
	</div>
</Case>

<style>
	.row {
		--slot-h: clamp(10rem, 22vw, 14rem);
		position: relative;
		padding-bottom: var(--sp-7);
	}

	.stand {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: clamp(1.2rem, 5vw, 3.2rem);
		height: var(--slot-h);
	}

	/* A brass bookend: an L-shaped plate, light on the upright. */
	.bookend {
		position: relative;
		width: 2.7rem;
		height: 62%;
		border-radius: 3px 3px 0 0;
		background: linear-gradient(90deg, #8f5f27, #e5ac5f 38%, #c98b3f 70%, #8f5f27);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.35),
			0 4px 8px rgba(0, 0, 0, 0.55);
	}

	.bookend::after {
		content: '';
		position: absolute;
		left: -0.6rem;
		right: -0.6rem;
		bottom: 0;
		height: 0.55rem;
		border-radius: 2px;
		background: linear-gradient(180deg, #e5ac5f, #8f5f27);
		box-shadow: inset 0 0 0 1px rgba(255, 244, 214, 0.3);
	}

	.bookend.left {
		transform: rotate(-3deg);
		transform-origin: bottom center;
	}

	/* The shape a book would make, drawn in gilt dashes, with dust drifting in its place. */
	.gap {
		position: relative;
		width: min(9rem, 26vw);
		height: 82%;
	}

	.outline {
		position: absolute;
		inset: 0;
		border: 2px dashed rgba(240, 212, 158, 0.42);
		border-radius: 3px 7px 7px 3px;
		background: linear-gradient(90deg, rgba(240, 212, 158, 0.1) 0 12%, transparent 12%);
	}

	.gap.trouble .outline {
		border-color: rgba(226, 122, 107, 0.6);
		background: linear-gradient(90deg, rgba(226, 122, 107, 0.12) 0 12%, transparent 12%);
	}

	.sign {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--danger);
	}

	.dust {
		position: absolute;
		left: 50%;
		bottom: 18%;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #ffd9a0;
		box-shadow:
			-22px -34px 0 -0.4px rgba(255, 217, 160, 0.7),
			18px -62px 0 0 rgba(255, 217, 160, 0.5),
			-6px -92px 0 -0.5px rgba(255, 217, 160, 0.6),
			26px -20px 0 -0.5px rgba(255, 217, 160, 0.5);
		animation: drift 7s ease-in-out infinite;
	}

	@keyframes drift {
		0%,
		100% {
			transform: translate(0, 0);
			opacity: 0.9;
		}
		50% {
			transform: translate(8px, -14px);
			opacity: 0.45;
		}
	}

	.words {
		position: relative;
		z-index: 1;
		display: grid;
		justify-items: center;
		gap: var(--sp-5);
		max-width: 34rem;
		margin: 0 auto;
		padding: 2rem var(--sp-6) var(--sp-4);
		text-align: center;
	}

	.words :global(p) {
		margin: 0;
	}

	.words :global(.lead) {
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.15;
		text-wrap: balance;
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
	}

	.words :global(button) {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
	}

	.words :global(.muted) {
		color: var(--muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.dust {
			animation: none;
		}
	}
</style>
