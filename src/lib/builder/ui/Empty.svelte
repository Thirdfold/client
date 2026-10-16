<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui/game';

	/** A drawer with nothing in it yet: what goes here, and the one thing to do about it. */
	let {
		icon,
		title,
		children,
		action
	}: { icon: IconName; title: string; children?: Snippet; action?: Snippet } = $props();
</script>

<div class="empty g-pop">
	<span class="seal" aria-hidden="true"><Icon name={icon} size="2rem" /></span>
	<p class="title">{title}</p>
	{#if children}<p class="text">{@render children()}</p>{/if}
	{#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--sp-4);
		padding: var(--sp-8) var(--sp-6);
		border: 2px dashed var(--gilt-line);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(70% 90% at 50% 0%, rgba(224, 164, 88, 0.1), transparent 70%),
			rgba(0, 0, 0, 0.22);
		text-align: center;
	}

	.seal {
		display: grid;
		place-items: center;
		width: 4.2rem;
		height: 4.2rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: linear-gradient(180deg, #3b2c20, #1f1611);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 0 18px rgba(224, 164, 88, 0.15),
			0 3px 0 var(--ink-line),
			0 10px 18px rgba(8, 4, 0, 0.5);
		color: var(--gilt);
	}

	.title {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--text);
	}

	.text {
		margin: 0;
		max-width: 38ch;
		color: var(--muted);
		font-size: var(--fs-md);
		line-height: 1.4;
	}

	.action {
		margin-top: var(--sp-3);
	}

	.action :global(button) {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
	}

	@media (prefers-reduced-motion: reduce) {
		.empty {
			animation: none;
		}
	}
</style>
