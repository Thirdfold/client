<!--
	The cut's height bar (#281), at the table's right edge: like TaleSpire's padlocked slider.
	Dragging the handle (or the arrow keys on it, or Shift+PageUp/PageDown anywhere) sets the cut a
	storey at a time and locks it; the padlock (or Escape with nothing else to let go) returns it to
	auto, which follows the camera's pivot (tabletop/cut.ts).
-->
<script lang="ts" module>
	export interface Cut {
		/** A multiple of WALL_LEVELS, or null for no cut; read only while locked. */
		level: number | null;
		locked: boolean;
	}
	export const AUTO_CUT: Cut = { level: null, locked: false };
</script>

<script lang="ts">
	import { MAX_LEVEL } from '$lib/game/terrain';
	import { WALL_LEVELS } from '$lib/game/visibility';
	import { play } from '$lib/audio/engine';
	import { Icon } from '$lib/ui/game';

	let { cut, onchange }: { cut: Cut; onchange: (cut: Cut) => void } = $props();

	/** The storeys a cut may sit on; one more is no cut. */
	const TOP = Math.floor(MAX_LEVEL / WALL_LEVELS);
	const storey = $derived(cut.level === null ? TOP + 1 : cut.level / WALL_LEVELS);
	const words = $derived(
		!cut.locked
			? 'Auto: follows the camera'
			: cut.level === null
				? 'No cut'
				: `Cut above storey ${storey}`
	);

	/** What the plate reads: the storey the cut sits above, or why there is none. */
	const reading = $derived(!cut.locked ? 'Auto' : cut.level === null ? 'Off' : String(storey));
	/** How high the brass fill stands, bottom to knob. */
	const fill = $derived(TOP > 0 ? ((cut.locked ? storey - 1 : TOP) / TOP) * 100 : 100);

	function set(n: number) {
		onchange({ level: n > TOP ? null : n * WALL_LEVELS, locked: true });
	}

	function toggle() {
		play([{ kind: 'ui', sound: cut.locked ? 'close' : 'select' }]);
		onchange(AUTO_CUT);
	}
</script>

<div class="cut" class:locked={cut.locked} role="group" aria-label="Cut height">
	<span class="cap" aria-hidden="true">Cut</span>
	<span class="reading num" aria-hidden="true">{reading}</span>
	<input
		type="range"
		min="1"
		max={TOP + 1}
		step="1"
		value={cut.locked ? storey : TOP + 1}
		aria-label="Cut height"
		aria-valuetext={words}
		title="Cut height: {words}"
		style:--fill="{fill}%"
		oninput={(e) => set(Number(e.currentTarget.value))}
	/>
	<button
		type="button"
		aria-pressed={cut.locked}
		title={cut.locked ? 'Locked: click to follow the camera (Esc)' : 'Auto: follows the camera'}
		aria-label={cut.locked ? 'Unlock the cut' : 'The cut follows the camera'}
		onclick={toggle}
	>
		{#if cut.locked}
			<Icon name="lock" size="1.2rem" />
		{:else}
			<svg
				class="icon"
				viewBox="0 0 24 24"
				width="1.2rem"
				height="1.2rem"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				focusable="false"
			>
				<rect x="5" y="10.5" width="14" height="10" rx="2" />
				<path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
			</svg>
		{/if}
	</button>
</div>

<style>
	/* A brass-edged rail of wood at the table's right edge, with a padlock at its foot. */
	.cut {
		position: absolute;
		right: var(--free-right, 0.75rem);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-4) var(--sp-2) var(--sp-3);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-lg);
		background:
			var(--grain) 0 0 / 180px,
			var(--wood-grad);
		background-blend-mode: soft-light, normal;
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 4px rgba(0, 0, 0, 0.28),
			var(--shadow-md);
		color: var(--muted);
		pointer-events: auto;
		z-index: var(--z-hud);
		animation: g-pop 420ms var(--spring) both;
	}

	.cut.locked {
		color: var(--gilt-hi);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 0 0 4px rgba(0, 0, 0, 0.28),
			var(--shadow-md),
			0 0 18px rgba(224, 164, 88, 0.22);
	}

	.cap {
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.reading {
		min-width: 2.4rem;
		padding: 0 var(--sp-2);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		text-align: center;
		color: inherit;
	}

	input {
		--groove: 0.6rem;
		--knob: 1.3rem;
		appearance: none;
		writing-mode: vertical-lr;
		direction: rtl;
		width: 2rem;
		height: 9rem;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		accent-color: var(--gilt);
		opacity: 0.8;
	}

	.locked input {
		opacity: 1;
	}

	input:hover:not(:disabled),
	input:focus-visible {
		background: transparent;
		box-shadow: none;
	}

	input::-webkit-slider-runnable-track {
		width: var(--groove);
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background:
			linear-gradient(0deg, var(--gilt-lo), var(--gilt)) 0 100% / 100% var(--fill, 0%) no-repeat,
			var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 rgba(240, 212, 158, 0.18);
	}

	input::-moz-range-track {
		width: var(--groove);
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background: var(--panel-sunk);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7);
	}

	input::-moz-range-progress {
		width: var(--groove);
		border-radius: 999px;
		background: linear-gradient(0deg, var(--gilt-lo), var(--gilt));
	}

	input::-webkit-slider-thumb {
		appearance: none;
		width: var(--knob);
		height: var(--knob);
		margin-left: calc((var(--groove) - var(--knob)) / 2 - 1px);
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

	button {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border-radius: 50%;
	}

	@media (max-width: 48rem) {
		/* Higher and shorter on a phone, clear of the hint and the hotbar below. */
		.cut {
			top: 40%;
		}

		input {
			height: 6.5rem;
		}

		button {
			width: 2.75rem;
			height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cut {
			animation: none;
		}
	}
</style>
