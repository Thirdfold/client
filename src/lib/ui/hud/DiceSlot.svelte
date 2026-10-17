<script lang="ts">
	import { Icon } from '$lib/ui/game';

	/** The d20: the one die the table reaches for most, a big slot of its own in the hotbar. */
	let { onRoll, key = 'Q' }: { onRoll(): void; key?: string } = $props();

	function onKeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== key.toLowerCase()) return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		onRoll();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<button
	type="button"
	class="d20 g-glint"
	onclick={onRoll}
	title={`Roll a d20 for everyone to see (${key})`}
>
	<span class="key" aria-hidden="true">{key}</span>
	<Icon name="d20" size="2.6rem" />
	<span class="word">Roll d20</span>
</button>

<style>
	.d20 {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: var(--sp-1);
		width: 5.4rem;
		height: 5.4rem;
		padding: 0;
		flex: none;
		border: 1px solid var(--gilt-dark);
		border-radius: 1.1rem;
		background: var(--gilt-grad);
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.5);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.55),
			inset 0 -4px 7px rgba(120, 70, 20, 0.35),
			0 4px 0 var(--gilt-dark),
			0 10px 18px rgba(8, 4, 0, 0.5),
			0 0 26px rgba(224, 164, 88, 0.3);
	}

	.d20 :global(.icon) {
		filter: drop-shadow(0 1px 0 rgba(255, 238, 200, 0.5));
	}

	.word {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.key {
		position: absolute;
		top: 0.3rem;
		left: 0.4rem;
		font-family: var(--font-label);
		font-size: var(--fs-2xs);
		font-weight: 700;
		line-height: 1;
		opacity: 0.8;
	}

	@media (max-width: 48rem) {
		.d20 {
			width: 4.6rem;
			height: 4.6rem;
		}

		.key {
			display: none;
		}
	}
</style>
