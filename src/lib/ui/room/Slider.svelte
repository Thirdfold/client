<script lang="ts">
	/** A range as a brass-fitted slide: a groove, a lit fill, a gilt knob and its reading. */
	interface Props {
		label: string;
		/** The reading beside the label ("4 cells"). */
		reading?: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		ariaLabel?: string;
		/** Fired when the knob is let go (not while it is dragged), like the old `change`. */
		onchange(value: number): void;
	}
	let { label, reading, value, min, max, step = 1, ariaLabel, onchange }: Props = $props();

	/** Follows the server's value, but moves with the knob while it is held. */
	let live = $derived(value);
	const fill = $derived(max > min ? ((live - min) / (max - min)) * 100 : 0);
</script>

<label class="slider">
	<span class="head">
		<span class="lab">{label}</span>
		{#if reading !== undefined}<span class="reading num">{reading}</span>{/if}
	</span>
	<input
		type="range"
		{min}
		{max}
		{step}
		{value}
		aria-label={ariaLabel}
		style:--fill="{fill}%"
		oninput={(e) => (live = e.currentTarget.valueAsNumber)}
		onchange={(e) => onchange(e.currentTarget.valueAsNumber)}
	/>
</label>

<style>
	.slider {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
		font-size: var(--fs-xs);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--sp-4);
	}

	.lab {
		color: var(--muted);
	}

	.reading {
		font-family: var(--font-label);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--gilt-hi);
	}

	input {
		--groove: 0.6rem;
		--knob: 1.3rem;
		appearance: none;
		width: 100%;
		min-height: 1.6rem;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		accent-color: var(--gilt);
	}

	@media (max-width: 48rem) {
		input {
			min-height: 2.75rem;
		}
	}

	input:hover:not(:disabled),
	input:focus-visible {
		background: transparent;
		box-shadow: none;
	}

	input::-webkit-slider-runnable-track {
		height: var(--groove);
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background:
			linear-gradient(90deg, var(--gilt-lo), var(--gilt)) 0 0 / var(--fill, 0%) 100% no-repeat,
			var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 rgba(240, 212, 158, 0.18);
	}

	input::-moz-range-track {
		height: var(--groove);
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background: var(--panel-sunk);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7);
	}

	input::-moz-range-progress {
		height: var(--groove);
		border-radius: 999px;
		background: linear-gradient(90deg, var(--gilt-lo), var(--gilt));
	}

	input::-webkit-slider-thumb {
		appearance: none;
		width: var(--knob);
		height: var(--knob);
		margin-top: calc((var(--groove) - var(--knob)) / 2 - 1px);
		border: 1px solid var(--gilt-dark);
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #fff1cf 0 12%, #e5ac5f 40%, #a8722f 100%);
		box-shadow:
			0 2px 0 var(--gilt-dark),
			0 4px 8px rgba(0, 0, 0, 0.55);
		transition: transform 120ms var(--spring);
	}

	input::-moz-range-thumb {
		width: var(--knob);
		height: var(--knob);
		border: 1px solid var(--gilt-dark);
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #fff1cf 0 12%, #e5ac5f 40%, #a8722f 100%);
		box-shadow: 0 2px 0 var(--gilt-dark);
	}

	input:hover::-webkit-slider-thumb {
		transform: scale(1.1);
	}

	input:active::-webkit-slider-thumb {
		transform: scale(0.94);
	}

	input:focus-visible {
		outline: none;
	}

	input:focus-visible::-webkit-slider-thumb {
		box-shadow:
			0 2px 0 var(--gilt-dark),
			var(--ring);
	}

	input:focus-visible::-moz-range-thumb {
		box-shadow: var(--ring);
	}
</style>
