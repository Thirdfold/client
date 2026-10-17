<script lang="ts">
	import { NAME_MAX_LENGTH } from '$lib/game/names';
	import { Icon } from '$lib/ui/game';

	/**
	 * "Your name", as a scroll you sign before the doors open. The title screen's actions wait for
	 * it, and the line under it says so, in the game's voice.
	 */
	interface Props {
		value: string;
		/** Enter in the field: the page moves on to the first plaque. */
		onenter?: () => void;
		el?: HTMLInputElement | null;
	}

	let { value = $bindable(), onenter, el = $bindable(null) }: Props = $props();
	const signed = $derived(value.trim().length > 0);
</script>

<div class="signing">
	<label class="scroll" class:signed>
		<span class="rod left" aria-hidden="true"></span>
		<span class="rod right" aria-hidden="true"></span>
		<span class="caption">
			<Icon name={signed ? 'check' : 'pencil'} size="1.05em" />
			Your name
		</span>
		<input
			bind:this={el}
			bind:value
			data-nav
			maxlength={NAME_MAX_LENGTH}
			autocomplete="nickname"
			placeholder="e.g. Morgan"
			onkeydown={(event) => {
				if (event.key === 'Enter' && signed) {
					event.preventDefault();
					onenter?.();
				}
			}}
		/>
	</label>
	<p class="said" id="name-hint" class:signed>
		{#if signed}
			Your name is on the scroll. Choose a door.
		{:else}
			Write your name on the scroll to open the doors.
		{/if}
	</p>
</div>

<style>
	.signing {
		display: grid;
		gap: var(--sp-4);
	}

	.scroll {
		position: relative;
		display: grid;
		gap: 0.1rem;
		padding: 0.55rem 2.2rem 0.65rem;
		margin-inline: 0.5rem;
		border-block: 1px solid #7a5b30;
		background:
			var(--grain) 0 0 / 180px,
			radial-gradient(120% 100% at 50% 0%, rgba(255, 250, 235, 0.65), transparent 70%),
			linear-gradient(180deg, #efe2c6, #ddc9a0);
		background-blend-mode: multiply, normal, normal;
		box-shadow:
			inset 0 0 26px rgba(120, 90, 50, 0.35),
			0 10px 22px rgba(8, 4, 0, 0.5);
		color: var(--ink);
		cursor: text;
		transition: box-shadow 160ms var(--ease-out);
	}

	/* The two rolled ends of the scroll, taller than the sheet. */
	.rod {
		position: absolute;
		top: -0.45rem;
		bottom: -0.45rem;
		width: 1.1rem;
		border: 1px solid var(--ink-line);
		border-radius: 0.55rem;
		background: linear-gradient(90deg, #6a4a26, #d9a04f 35%, #f1c982 50%, #b97f36 70%, #5a3a14);
		box-shadow:
			inset 0 0 0 1px rgba(255, 236, 200, 0.25),
			0 4px 8px rgba(8, 4, 0, 0.5);
	}

	.rod.left {
		left: -0.55rem;
	}

	.rod.right {
		right: -0.55rem;
	}

	.scroll:focus-within {
		box-shadow:
			inset 0 0 26px rgba(120, 90, 50, 0.35),
			0 0 0 3px var(--gilt-hi),
			0 0 28px rgba(255, 190, 100, 0.45),
			0 10px 22px rgba(8, 4, 0, 0.5);
	}

	.caption {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		font-family: var(--font-label);
		font-size: 0.98rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ink-accent);
	}

	.signed .caption {
		color: #2f5a2c;
	}

	input {
		width: 100%;
		min-height: 2.4rem;
		padding: 0.1rem 0.2rem;
		border: 0;
		border-bottom: 2px solid rgba(42, 29, 18, 0.55);
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 700;
		text-align: center;
		outline: none;
	}

	input::placeholder {
		color: var(--ink-muted);
		font-weight: 500;
		font-style: italic;
		opacity: 1;
	}

	input:hover:not(:disabled),
	input:focus-visible {
		background: transparent;
		box-shadow: none;
		border-bottom-color: var(--ink);
	}

	.said {
		margin: 0;
		min-height: 1.4em;
		text-align: center;
		color: var(--muted);
		font-size: var(--fs-md);
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9);
	}

	.said.signed {
		color: var(--gilt-hi);
	}
</style>
