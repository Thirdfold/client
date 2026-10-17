<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The bookcase itself: a walnut frame with brass studs round a panelled back wall lit from above,
	 * a gilt moulding along its top. Shelves (Shelf, EmptyShelf) stand inside it.
	 */
	let { children, stale = false }: { children: Snippet; stale?: boolean } = $props();
</script>

<div class="case g-frame wood" class:stale>
	<div class="back">
		{@render children()}
	</div>
</div>

<style>
	.case {
		padding: 10px;
		border-radius: 16px 16px 8px 8px;
		transition: opacity var(--dur) var(--ease-out);
	}

	/* A search in flight: the last results stay, dimmed, until the new ones arrive. */
	.case.stale {
		opacity: 0.6;
	}

	.back {
		position: relative;
		overflow: clip;
		border-radius: 8px 8px 3px 3px;
		padding: 1.7rem 0.4rem 0.4rem;
		background:
			radial-gradient(70% 38% at 50% 0%, rgba(255, 190, 110, 0.14), transparent 80%),
			repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0 2px, transparent 2px 72px),
			var(--grain) 0 0 / 160px,
			linear-gradient(180deg, #170f0a, #0f0a07);
		background-blend-mode: normal, normal, soft-light, normal;
		box-shadow:
			inset 0 14px 22px -8px rgba(0, 0, 0, 0.95),
			inset 12px 0 18px -10px rgba(0, 0, 0, 0.85),
			inset -12px 0 18px -10px rgba(0, 0, 0, 0.85),
			inset 0 0 0 1px var(--ink-line);
	}

	/* The crown of the case: a gilt moulding along the top. */
	.back::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 0.55rem;
		background:
			linear-gradient(180deg, rgba(255, 228, 176, 0.5) 0 1px, transparent 1px),
			linear-gradient(180deg, #4d3827, #2a1e14);
		box-shadow:
			0 3px 8px rgba(0, 0, 0, 0.7),
			inset 0 -1px 0 rgba(0, 0, 0, 0.6);
		z-index: 2;
	}

	@media (prefers-reduced-motion: reduce) {
		.case {
			transition: none;
		}
	}
</style>
