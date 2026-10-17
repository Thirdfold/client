<script lang="ts">
	import { setMix } from '$lib/audio/engine';
	import { loadMix, saveMix, type Mix } from '$lib/audio/mix';
	import { play } from '$lib/audio/engine';
	import { Icon } from '$lib/ui/game';

	/** The sound settings: mute, and how loud the music, ambience and effects are. */
	let mix = $state<Mix>(loadMix(localStorage));
	let open = $state(false);

	function change(next: Mix) {
		mix = next;
		setMix(next);
		saveMix(localStorage, next);
	}

	const LEVELS = [
		{ key: 'master', label: 'Volume' },
		{ key: 'music', label: 'Music' },
		{ key: 'ambience', label: 'Ambience' },
		{ key: 'effects', label: 'Effects' }
	] as const;
</script>

<div class="audio">
	<button
		type="button"
		aria-expanded={open}
		aria-label="Sound settings"
		title="Sound"
		onclick={() => {
			open = !open;
			play([{ kind: 'ui', sound: open ? 'open' : 'close' }]);
		}}
	>
		<Icon name={mix.muted ? 'mute' : 'sound'} size="1.15rem" />
		<span class="word">{mix.muted ? 'Sound off' : 'Sound'}</span>
	</button>
	{#if open}
		<!-- Opens as a mixing desk under the button (see .mixer below). -->
		<div class="mixer" role="group" aria-label="Sound">
			<div class="faders">
				{#each LEVELS as l (l.key)}
					<label class="fader">
						<b>{Math.round(mix[l.key] * 100)}</b>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={mix[l.key]}
							disabled={mix.muted}
							aria-label={l.label}
							oninput={(e) => change({ ...mix, [l.key]: Number(e.currentTarget.value) })}
						/>
						<span>{l.label}</span>
					</label>
				{/each}
			</div>
			<label class="mute">
				<input
					type="checkbox"
					checked={mix.muted}
					onchange={(e) => change({ ...mix, muted: e.currentTarget.checked })}
				/>
				Mute everything
			</label>
		</div>
	{/if}
</div>

<style>
	.audio {
		position: relative;
	}

	.audio > button {
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

		.audio > button {
			padding: var(--sp-2) var(--sp-4);
		}
	}

	/* A mixing desk: hangs from the button at the room's right edge, over the satchel. */
	.mixer {
		position: absolute;
		top: calc(100% + var(--sp-5));
		right: 0;
		display: grid;
		gap: var(--sp-5);
		width: 17rem;
		max-width: calc(100vw - 1.5rem);
		padding: var(--sp-5) var(--sp-5) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-lg);
		background: var(--wood-grad), var(--panel-solid);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-lg);
		z-index: var(--z-overlay);
		animation: g-pop 320ms var(--spring) both;
	}

	.faders {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		justify-items: center;
		gap: var(--sp-3);
	}

	.fader {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.03em;
		color: var(--muted);
	}

	.fader b {
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	/* The master fader leads. */
	.fader:first-child b,
	.fader:first-child span {
		color: var(--gilt);
	}

	.fader input {
		writing-mode: vertical-lr;
		direction: rtl;
		width: 1.8rem;
		height: 7rem;
		min-height: 0;
		padding: 0;
		margin: 0;
		border: 0;
		background: none;
		box-shadow: none;
		accent-color: var(--accent);
	}

	.mute {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--sp-3);
		padding-top: var(--sp-4);
		border-top: 1px solid var(--gilt-line);
		font-size: var(--fs-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.mixer {
			animation: none;
		}
	}
</style>
