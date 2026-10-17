<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * A notice banner: a dark plate with swallow-tail ends and a gilt edge that slides in over the
	 * table, instead of a pill. `tone` picks the edge and the icon (a word always travels with it).
	 */
	interface Props {
		tone?: 'info' | 'warn' | 'bad';
		icon?: IconName;
		role?: 'status' | 'alert';
		/** Shows a slim clock draining over this many milliseconds. */
		clock?: number;
		class?: string;
		children: Snippet;
		action?: Snippet;
	}
	let {
		tone = 'info',
		icon,
		role = 'status',
		clock,
		class: extra = '',
		children,
		action
	}: Props = $props();

	const glyph = $derived<IconName>(icon ?? (tone === 'info' ? 'bell' : 'warn'));
</script>

<div class="notice {tone} {extra}" {role}>
	<div class="plate">
		<span class="edge" aria-hidden="true"></span>
		<span class="icon"><Icon name={glyph} size="1.35rem" /></span>
		<span class="text">{@render children()}</span>
		{#if action}<span class="act">{@render action()}</span>{/if}
		{#if clock}<span class="clock" style:--ms="{clock}ms" aria-hidden="true"></span>{/if}
	</div>
</div>

<style>
	.notice {
		--edge-a: #f0d49b;
		--edge-b: #a8722f;
		--tail: 0.9rem;
		max-width: 100%;
		pointer-events: auto;
		/* The shadow sits outside the clipped plate (a filter runs before a clip). */
		filter: drop-shadow(0 6px 10px rgba(8, 4, 0, 0.55));
		animation: notice-in 420ms var(--spring) both;
	}

	.plate {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-4) calc(var(--tail) + var(--sp-6));
		background: linear-gradient(180deg, #2f231a, #1f1610);
		color: var(--text);
		font-size: var(--fs-md);
		line-height: 1.3;
		/* Swallow-tailed ribbon ends. */
		clip-path: polygon(
			0 0,
			100% 0,
			calc(100% - var(--tail)) 50%,
			100% 100%,
			0 100%,
			var(--tail) 50%
		);
	}

	/* The gilt edge: the same ribbon, inset as a line on its top and bottom. */
	.edge {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			linear-gradient(180deg, var(--edge-a), var(--edge-b)) top / 100% 2px no-repeat,
			linear-gradient(180deg, var(--edge-a), var(--edge-b)) bottom / 100% 2px no-repeat;
	}

	.warn {
		--edge-a: #f4c06a;
		--edge-b: #b97f36;
	}

	.warn .plate {
		background: linear-gradient(180deg, #3a2a16, #281c0e);
	}

	.bad {
		--edge-a: #f09a8b;
		--edge-b: #a8392b;
	}

	.bad .plate {
		background: linear-gradient(180deg, #4a2219, #321610);
	}

	.icon {
		display: grid;
		flex: none;
		color: var(--edge-a);
	}

	.text {
		min-width: 0;
	}

	.act {
		display: inline-flex;
		flex: none;
	}

	.act :global(button) {
		min-height: 2.25rem;
		padding: var(--sp-2) var(--sp-5);
		font-size: var(--fs-sm);
	}

	.clock {
		position: absolute;
		left: var(--tail);
		right: var(--tail);
		bottom: 0;
		height: 3px;
		background: var(--edge-a);
		transform-origin: left;
		animation: drain var(--ms) linear both;
	}

	@keyframes notice-in {
		0% {
			opacity: 0;
			transform: translateY(-18px) scaleX(0.7);
		}
		60% {
			opacity: 1;
			transform: translateY(3px) scaleX(1.02);
		}
		100% {
			transform: none;
		}
	}

	@keyframes drain {
		to {
			transform: scaleX(0);
		}
	}

	@keyframes drain-fade {
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.notice {
			animation: none;
		}

		/* The time left still shows: as a fading bar instead of a moving one. */
		.clock {
			animation: drain-fade var(--ms) linear both !important;
		}
	}
</style>
