<script lang="ts">
	import { Icon, type IconName } from '$lib/ui/game';

	/** A button that opens a file: the input stays in the tab order, the label is the plate. */
	let {
		label,
		icon = 'upload',
		onchange,
		accept = '.json,application/json'
	}: {
		label: string;
		icon?: IconName;
		onchange: (event: Event) => void;
		accept?: string;
	} = $props();
</script>

<label class="file-button">
	<Icon name={icon} size="1em" />{label}
	<input type="file" class="visually-hidden" {accept} {onchange} />
</label>

<style>
	.file-button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35em;
		min-height: 2.5rem;
		padding: 0.5rem 1.2rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 1px 0 1px rgba(255, 236, 200, 0.16),
			0 3px 0 var(--ink-line),
			0 7px 12px rgba(8, 4, 0, 0.4);
		color: var(--text);
		font-family: var(--font-label);
		font-size: 1.02rem;
		font-weight: 700;
		letter-spacing: 0.035em;
		line-height: 1.1;
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
		cursor: pointer;
		transition:
			transform 110ms var(--ease-out),
			box-shadow 110ms var(--ease-out),
			background 140ms var(--ease-out);
	}

	.file-button:hover {
		background: var(--wood-grad-hover);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 1px 0 1px rgba(255, 236, 200, 0.22),
			0 3px 0 var(--ink-line),
			0 7px 16px rgba(8, 4, 0, 0.45),
			0 0 22px rgba(224, 164, 88, 0.22);
		transform: translateY(-1px);
	}

	.file-button:active {
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 3px 6px rgba(0, 0, 0, 0.5),
			0 1px 0 var(--ink-line);
		transform: translateY(2px);
	}

	.file-button:focus-within {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 3px 0 var(--ink-line),
			var(--ring);
	}

	@media (prefers-reduced-motion: reduce) {
		.file-button:hover,
		.file-button:active {
			transform: none;
		}
	}
</style>
