<script lang="ts">
	/** A rocker switch with its lamp: on is brass and lit, off is dark wood. */
	interface Props {
		label: string;
		checked: boolean;
		title?: string;
		onchange(checked: boolean): void;
	}
	let { label, checked, title, onchange }: Props = $props();
</script>

<label class="toggle" {title}>
	<input type="checkbox" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
	<span class="text">{label}</span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		min-height: 1.9rem;
		font-size: var(--fs-sm);
		cursor: pointer;
	}

	@media (max-width: 48rem) {
		.toggle {
			min-height: 2.75rem;
		}
	}

	.text {
		min-width: 0;
		flex: 1;
	}

	input {
		appearance: none;
		position: relative;
		flex: none;
		width: 2.6rem;
		height: 1.45rem;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background: linear-gradient(180deg, #0b0705, #1a120d);
		box-shadow:
			inset 0 2px 5px rgba(0, 0, 0, 0.75),
			inset 0 0 0 1px var(--gilt-line),
			0 1px 0 rgba(255, 236, 200, 0.1);
		cursor: pointer;
		transition: background 160ms var(--ease-out);
	}

	input::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(1.45rem - 8px);
		height: calc(1.45rem - 8px);
		border: 1px solid #1a110a;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #6a5338, #33261a 70%);
		box-shadow: 0 2px 3px rgba(0, 0, 0, 0.6);
		transition:
			transform 180ms var(--spring),
			background 160ms var(--ease-out),
			box-shadow 160ms var(--ease-out);
	}

	input:checked {
		background: linear-gradient(180deg, #3a2410, #6b4519);
	}

	input:checked::after {
		transform: translateX(1.15rem);
		background: radial-gradient(circle at 35% 30%, #fff1cf 0 12%, #e5ac5f 42%, #a8722f 100%);
		box-shadow:
			0 2px 3px rgba(0, 0, 0, 0.6),
			0 0 12px rgba(255, 190, 100, 0.55);
	}

	input:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}
</style>
