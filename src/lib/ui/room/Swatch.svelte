<script lang="ts">
	/** A colour as a cut gem on a button: lit ring when it is the one chosen. */
	interface Props {
		color: string;
		label: string;
		pressed: boolean;
		title?: string;
		size?: string;
		onclick(): void;
	}
	let { color, label, pressed, title, size = '1.7rem', onclick }: Props = $props();
</script>

<button
	type="button"
	class="gem"
	style:--gem={color}
	style:--size={size}
	aria-label={label}
	aria-pressed={pressed}
	{title}
	{onclick}
></button>

<style>
	.gem {
		flex: none;
		width: var(--size);
		height: var(--size);
		min-height: 0;
		padding: 0;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background:
			radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.55) 0 14%, transparent 42%),
			radial-gradient(circle at 60% 70%, rgba(0, 0, 0, 0.35), transparent 60%), var(--gem);
		box-shadow:
			inset 0 0 0 2px rgba(0, 0, 0, 0.35),
			0 2px 0 var(--ink-line),
			0 4px 6px rgba(0, 0, 0, 0.4);
		transform: none;
	}

	/* A bigger invisible target on touch screens. */
	@media (max-width: 48rem) {
		.gem::before {
			content: '';
			position: absolute;
			inset: -0.55rem;
			border-radius: 50%;
		}
	}

	.gem:not(:disabled):hover {
		background:
			radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.65) 0 14%, transparent 42%),
			radial-gradient(circle at 60% 70%, rgba(0, 0, 0, 0.35), transparent 60%), var(--gem);
		transform: translateY(-1px) scale(1.08);
	}

	.gem[aria-pressed='true'],
	.gem[aria-pressed='true']:not(:disabled):hover {
		background:
			radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.55) 0 14%, transparent 42%),
			radial-gradient(circle at 60% 70%, rgba(0, 0, 0, 0.35), transparent 60%), var(--gem);
		box-shadow:
			0 0 0 2px var(--panel-solid),
			0 0 0 4px var(--gilt-hi),
			0 0 14px rgba(246, 219, 163, 0.55);
		transform: scale(1.06);
	}
</style>
