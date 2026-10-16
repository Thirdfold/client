<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		/** Shown as initials; also the accessible name unless `label` is given. */
		name: string;
		/** A CSS colour for the medallion (a player's token colour). */
		color?: string;
		size?: number;
		/** 0–1 ring of health around the medallion; omit for no ring. */
		ratio?: number;
		/** Whose turn it is: lit brass ring that breathes. */
		active?: boolean;
		/** A small gilt badge, e.g. the GM's crown. */
		badge?: 'crown' | 'skull' | 'star' | null;
		/** A foe: red ring and no initials fuss. */
		foe?: boolean;
		label?: string;
	}
	let {
		name,
		color = '#8a6a3d',
		size = 44,
		ratio,
		active = false,
		badge = null,
		foe = false,
		label
	}: Props = $props();

	const initials = $derived(
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
	const ring = $derived(ratio === undefined ? null : Math.min(1, Math.max(0, ratio)));
</script>

<span
	class="portrait"
	class:active
	class:foe
	style:--size="{size}px"
	style:--color={color}
	style:--ring={ring === null ? '0turn' : `${ring}turn`}
	role="img"
	aria-label={label ?? name}
>
	<span class="medal"><span class="letters">{initials}</span></span>
	{#if badge}
		<span class="badge" aria-hidden="true">
			<Icon name={badge} size="1em" />
		</span>
	{/if}
</span>

<style>
	.portrait {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		/* The ring: health as a gilt arc (or red for a foe) around a dark groove. */
		background: conic-gradient(var(--ringcolor, var(--gilt)) var(--ring), rgba(0, 0, 0, 0.55) 0);
		padding: 3px;
		box-shadow:
			0 0 0 1px var(--ink-line),
			0 3px 6px rgba(8, 4, 0, 0.5);
	}
	.foe {
		--ringcolor: #e27a6b;
	}
	.medal {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background:
			radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.35), transparent 55%), var(--color);
		box-shadow:
			inset 0 0 0 2px rgba(0, 0, 0, 0.55),
			inset 0 -4px 8px rgba(0, 0, 0, 0.35);
	}
	.letters {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: calc(var(--size) * 0.38);
		line-height: 1;
		color: #fff7e6;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
	}
	.badge {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: grid;
		place-items: center;
		width: calc(var(--size) * 0.42);
		height: calc(var(--size) * 0.42);
		border-radius: 50%;
		background: var(--gilt-grad);
		color: var(--accent-text);
		font-size: calc(var(--size) * 0.26);
		line-height: 1;
		box-shadow: 0 0 0 1px var(--ink-line);
	}
	.active {
		animation: breathe 1.8s ease-in-out infinite;
		--ringcolor: var(--gilt-hi);
	}
	@keyframes breathe {
		0%,
		100% {
			box-shadow:
				0 0 0 1px var(--ink-line),
				0 0 0 0 var(--ember-glow),
				0 3px 6px rgba(8, 4, 0, 0.5);
		}
		50% {
			box-shadow:
				0 0 0 1px var(--ink-line),
				0 0 0 6px transparent,
				0 0 16px var(--ember-glow);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.active {
			animation: none;
			box-shadow:
				0 0 0 1px var(--ink-line),
				0 0 14px var(--ember-glow);
		}
	}
</style>
