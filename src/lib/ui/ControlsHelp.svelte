<script lang="ts">
	// The Controls popover (#279): every binding from keys.ts. A button with
	// aria-expanded; Escape closes it and puts focus back on the button.
	import { play } from '$lib/audio/engine';
	import { Icon } from '$lib/ui/game';
	import Toggle from './room/Toggle.svelte';
	import { controlGroups, isTouchDevice } from './keys';

	let { gm = false, followTurns = $bindable(false) }: { gm?: boolean; followTurns?: boolean } =
		$props();

	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	// A touch device (no hover, a coarse pointer) lists the gestures first (#288).
	const touch = isTouchDevice();
	const groups = $derived(controlGroups(gm, touch));

	function toggle() {
		open = !open;
		play([{ kind: 'ui', sound: open ? 'open' : 'close' }]);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopPropagation();
			open = false;
			play([{ kind: 'ui', sound: 'close' }]);
			button?.focus();
		}
	}
</script>

<span class="controls" onkeydown={onKeydown} role="presentation">
	<button
		bind:this={button}
		type="button"
		aria-expanded={open}
		aria-controls="controls-help"
		title="Controls: the keys and the mouse"
		onclick={toggle}
	>
		<Icon name="menu" size="1.15rem" />
		<span class="word">Controls</span>
	</button>
	{#if open}
		<!-- A card of the table's keys, hung from the button like the mixing desk beside it. -->
		<div id="controls-help" class="popover" role="region" aria-label="Controls">
			<div class="follow">
				<Toggle
					label="Follow turns (the Follow view eases to whose turn it is, when you can see them)"
					checked={followTurns}
					onchange={(next) => (followTurns = next)}
				/>
			</div>
			{#each groups as group (group.title)}
				<section>
					<h3>{group.title}</h3>
					<dl>
						{#each group.rows as row (row.label)}
							<dt>{row.label}</dt>
							<dd>
								{#each row.keys as key (key)}<kbd>{key}</kbd>{/each}
							</dd>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	{/if}
</span>

<style>
	.controls {
		position: relative;
	}

	.controls > button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.5rem;
		padding: var(--sp-2) var(--sp-5);
		font-size: var(--fs-sm);
	}

	@media (max-width: 80rem) {
		.word {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.controls > button {
			padding: var(--sp-2) var(--sp-4);
		}
	}

	@media (max-width: 48rem) {
		.controls > button {
			min-height: 2.75rem;
			min-width: 2.75rem;
			justify-content: center;
		}
	}

	.popover {
		position: absolute;
		top: calc(100% + var(--sp-5));
		right: 0;
		z-index: var(--z-overlay);
		display: grid;
		gap: var(--sp-5);
		width: min(23rem, calc(100vw - 1.5rem));
		max-height: min(70vh, 34rem);
		overflow-y: auto;
		padding: var(--sp-5) var(--sp-6) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-lg);
		background: var(--wood-grad), var(--panel-solid);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-lg);
		font-size: var(--fs-sm);
		animation: g-pop 320ms var(--spring) both;
	}

	/* On a phone the card spans the screen under the top bar, not the button. */
	@media (max-width: 48rem) {
		.popover {
			position: fixed;
			top: var(--below-bar, 6rem);
			left: var(--sp-5);
			right: var(--sp-5);
			width: auto;
			max-height: calc(100dvh - var(--below-bar, 6rem) - var(--tabs-h, 4rem) - var(--sp-6));
		}
	}

	.follow {
		padding-bottom: var(--sp-4);
		border-bottom: 1px solid var(--gilt-line);
	}

	section {
		display: grid;
		gap: var(--sp-3);
	}

	h3 {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--gilt-hi);
	}

	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--sp-3) var(--sp-5);
		margin: 0;
	}

	dt {
		min-width: 0;
		color: var(--text);
	}

	dd {
		margin: 0;
		display: flex;
		gap: var(--sp-2);
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	/* A key as a keycap: a small bevelled plate with a hard base. */
	kbd {
		display: inline-block;
		min-width: 1.6rem;
		padding: 0.05rem var(--sp-3);
		border: 1px solid var(--gilt-dark);
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, #4a3826, #2f2318);
		box-shadow:
			0 2px 0 var(--gilt-dark),
			inset 0 1px 0 rgba(240, 212, 158, 0.25);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.03em;
		text-align: center;
		color: var(--gilt-hi);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.popover {
			animation: none;
		}
	}
</style>
