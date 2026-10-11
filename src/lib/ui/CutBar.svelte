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

	function set(n: number) {
		onchange({ level: n > TOP ? null : n * WALL_LEVELS, locked: true });
	}
</script>

<div class="cut" class:locked={cut.locked} role="group" aria-label="Cut height">
	<input
		type="range"
		min="1"
		max={TOP + 1}
		step="1"
		value={cut.locked ? storey : TOP + 1}
		aria-label="Cut height"
		aria-valuetext={words}
		title="Cut height: {words}"
		oninput={(e) => set(Number(e.currentTarget.value))}
	/>
	<button
		type="button"
		aria-pressed={cut.locked}
		title={cut.locked ? 'Locked: click to follow the camera (Esc)' : 'Auto: follows the camera'}
		aria-label={cut.locked ? 'Unlock the cut' : 'The cut follows the camera'}
		onclick={() => onchange(AUTO_CUT)}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
			<path
				d={cut.locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'}
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
			/>
		</svg>
	</button>
</div>

<style>
	.cut {
		position: absolute;
		right: var(--free-right, 0.75rem);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.3rem;
		border-radius: var(--radius-pill, 999px);
		background: var(--panel, rgb(20 20 24 / 0.8));
		border: 1px solid var(--border, transparent);
		color: var(--muted, #aaa);
		pointer-events: auto;
	}

	.cut.locked {
		color: var(--accent, #9c6);
	}

	input {
		writing-mode: vertical-lr;
		direction: rtl;
		height: 9rem;
		width: 1.25rem;
		accent-color: currentColor;
		opacity: 0.6;
	}

	.locked input {
		opacity: 1;
	}

	button {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	button:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--accent, #9c6);
		outline-offset: 2px;
	}
</style>
