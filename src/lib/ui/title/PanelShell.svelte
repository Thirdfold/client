<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Frame, Icon, type IconName } from '$lib/ui/game';

	/**
	 * A sub-menu of the title screen: a framed board with a banner for its name. On a wide screen
	 * it stands beside the menu; on a phone it takes the whole screen, like a game's sub-menu, and
	 * Back returns to the main menu.
	 */
	interface Props {
		id: string;
		title: string;
		icon: IconName;
		onback(): void;
		/** The heading, for moving focus into the panel when it opens. */
		heading?: HTMLElement | null;
		children: Snippet;
	}

	let { id, title, icon, onback, heading = $bindable(null), children }: Props = $props();
</script>

<section class="shell" {id} aria-labelledby="{id}-title">
	<div class="head">
		<button type="button" class="back" onclick={onback}>
			<Icon name="back" size="1.2rem" />
			<span>Back</span>
		</button>
		<h2 id="{id}-title" class="g-banner" bind:this={heading} tabindex="-1">
			<span class="ic"><Icon name={icon} size="1.1em" /></span>
			{title}
		</h2>
	</div>
	<Frame variant="wood" class="board">
		<div class="body">
			{@render children()}
		</div>
	</Frame>
</section>

<style>
	.shell {
		display: grid;
		gap: 0;
		min-width: 0;
	}

	.head {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: -1.1rem;
	}

	.head .g-banner {
		outline: none;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--fs-lg);
	}

	.ic {
		display: inline-grid;
	}

	/* Back is only for the phone's full-screen panel. */
	.back {
		display: none;
	}

	.shell :global(.board) {
		padding: 2rem var(--sp-7) var(--sp-7);
	}

	.body {
		position: relative;
		z-index: 1;
		display: grid;
		gap: var(--sp-6);
	}

	@media (max-width: 59.99rem) {
		.head {
			justify-content: space-between;
			margin-bottom: var(--sp-5);
			gap: var(--sp-5);
		}

		.back {
			display: inline-flex;
			align-items: center;
			gap: 0.35rem;
			min-height: 2.75rem;
		}

		.shell :global(.board) {
			padding: var(--sp-7) var(--sp-6) var(--sp-7);
		}
	}
</style>
