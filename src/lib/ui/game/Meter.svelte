<script lang="ts">
	interface Props {
		value: number;
		max: number;
		/** hp: green; foe: ember red; warn: brass; rune: pale blue. */
		tone?: 'hp' | 'foe' | 'warn' | 'rune';
		/** What it measures, for assistive tech ("Hit points"). */
		label: string;
		/** Show "12 / 20" at the right. */
		showValue?: boolean;
		class?: string;
	}
	let { value, max, tone = 'hp', label, showValue = false, class: extra = '' }: Props = $props();

	const ratio = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
	// A tick for every point up to 20 points, then every tenth: it reads like a game's bar.
	const tick = $derived(max > 0 && max <= 20 ? 100 / max : 10);
	const mood = $derived(
		tone === 'hp' ? (ratio <= 0.25 ? 'foe' : ratio <= 0.5 ? 'warn' : '') : tone
	);
</script>

<div class="wrap {extra}">
	<div
		class="g-meter {mood === 'foe' ? 'foe' : ''} {mood === 'warn' ? 'warn' : ''} {mood === 'rune'
			? 'rune'
			: ''}"
		role="meter"
		aria-label={label}
		aria-valuemin="0"
		aria-valuemax={max}
		aria-valuenow={value}
		style:--ratio={ratio}
		style:--tick="{tick}%"
	>
		<div class="g-meter-fill"></div>
	</div>
	{#if showValue}<span class="num value">{value} / {max}</span>{/if}
</div>

<style>
	.wrap {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
	}
	.wrap :global(.g-meter) {
		flex: 1;
	}
	.value {
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--muted);
		letter-spacing: 0.04em;
	}
</style>
