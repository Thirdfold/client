<script lang="ts">
	import { setMix } from '$lib/audio/engine';
	import { loadMix, saveMix, type Mix } from '$lib/audio/mix';
	import { Icon } from '$lib/ui/game';

	/** The sound switch in the title screen's corner: the same saved mix the table uses. */
	let mix = $state<Mix>(loadMix(localStorage));

	function toggle() {
		mix = { ...mix, muted: !mix.muted };
		setMix(mix);
		saveMix(localStorage, mix);
	}
</script>

<button type="button" class="sound" aria-pressed={!mix.muted} onclick={toggle}>
	<Icon name={mix.muted ? 'mute' : 'sound'} size="1.3rem" />
	<span>{mix.muted ? 'Sound off' : 'Sound on'}</span>
</button>

<style>
	.sound {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0.3rem 0.9rem 0.3rem 0.7rem;
		font-size: 0.98rem;
	}

	.sound[aria-pressed='false'] {
		color: var(--muted);
	}

	@media (max-width: 47.99rem) {
		.sound {
			min-height: 2.75rem;
		}
	}
</style>
