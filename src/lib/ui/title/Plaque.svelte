<script lang="ts">
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * One entry of the title screen's main menu: a wide plate with a medallion, a name in small
	 * caps and a line beneath it. A button, or a link when it goes to another screen. The lit
	 * state (hover, keyboard focus, its panel open) slides a brass marker in from the right.
	 */
	interface Props {
		icon: IconName;
		label: string;
		/** The line under the label. */
		hint?: string;
		/** A third, quieter line (a save's chapter and party). */
		detail?: string;
		/** primary: the one gilt plaque; quiet: a smaller, plainer plate. */
		tone?: 'primary' | 'plain' | 'quiet';
		href?: string;
		disabled?: boolean;
		/** Set when the plaque opens a panel: whether that panel is open now. */
		expanded?: boolean;
		controls?: string;
		onclick?: (event: MouseEvent) => void;
		/** The element, for returning focus to it when a panel closes. */
		el?: HTMLElement | null;
	}

	let {
		icon,
		label,
		hint,
		detail,
		tone = 'plain',
		href,
		disabled = false,
		expanded,
		controls,
		onclick,
		el = $bindable(null)
	}: Props = $props();
</script>

{#snippet inner()}
	<span class="medal"><Icon name={icon} size="1.45rem" /></span>
	<span class="words">
		<span class="label">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
		{#if detail}<span class="detail">{detail}</span>{/if}
	</span>
	<span class="marker" aria-hidden="true">
		{#if disabled}<Icon name="lock" size="1.1rem" />{:else}<Icon
				name="chevron"
				size="1.3rem"
			/>{/if}
	</span>
{/snippet}

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass a resolve()d path -->
	<a bind:this={el} class="plaque {tone}" data-nav {href}>{@render inner()}</a>
{:else}
	<button
		bind:this={el}
		class="plaque {tone}"
		class:open={expanded === true}
		data-nav
		type="button"
		{disabled}
		aria-expanded={expanded}
		aria-controls={expanded === undefined ? undefined : controls}
		{onclick}
	>
		{@render inner()}
	</button>
{/if}

<style>
	.plaque {
		--plate: var(--wood-grad);
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-6);
		width: 100%;
		min-height: 3.3rem;
		padding: 0.4rem 1rem 0.4rem 0.6rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--plate);
		color: var(--text);
		font-family: var(--font-label);
		text-align: left;
		text-decoration: none;
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
		cursor: pointer;
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 1px 0 1px rgba(255, 236, 200, 0.16),
			0 3px 0 var(--ink-line),
			0 9px 16px rgba(8, 4, 0, 0.45);
		transform: translateY(0);
		transition:
			transform 120ms var(--ease-out),
			box-shadow 120ms var(--ease-out),
			background 140ms var(--ease-out);
	}

	/* The medallion: a brass coin the icon is struck on. */
	.medal {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: radial-gradient(circle at 35% 28%, #3a2b1d, #1b1310 72%);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 2px 5px rgba(0, 0, 0, 0.6),
			0 1px 0 rgba(255, 236, 200, 0.12);
		color: var(--gilt);
		transition:
			color 140ms var(--ease-out),
			box-shadow 140ms var(--ease-out);
	}

	.words {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}

	.label {
		font-size: 1.28rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		line-height: 1.1;
	}

	.hint,
	.detail {
		font-family: var(--font-ui);
		font-size: var(--fs-sm);
		line-height: 1.25;
		letter-spacing: 0;
		color: var(--muted);
		text-shadow: none;
		overflow-wrap: anywhere;
	}

	.detail {
		font-size: var(--fs-xs);
		white-space: pre-line;
	}

	.marker {
		display: grid;
		place-items: center;
		color: var(--gilt);
		opacity: 0;
		transform: translateX(-8px);
		transition:
			opacity 140ms var(--ease-out),
			transform 180ms var(--spring);
	}

	/* ---- the big gilt plaque: the one thing to do next ---- */
	.primary {
		--plate: var(--gilt-grad);
		min-height: 4.2rem;
		border-color: var(--gilt-dark);
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			inset 0 -3px 5px rgba(120, 70, 20, 0.35),
			0 4px 0 var(--gilt-dark),
			0 12px 22px rgba(8, 4, 0, 0.5),
			0 0 34px rgba(224, 164, 88, 0.22);
		overflow: hidden;
	}

	.primary .label {
		font-size: 1.6rem;
	}

	.primary .medal {
		width: 2.9rem;
		height: 2.9rem;
		color: var(--gilt-hi);
	}

	.primary .hint,
	.primary .detail {
		color: #4a3114;
	}

	.primary .marker {
		color: var(--accent-text);
	}

	/* The glint crosses the gilt plate now and then (the skin's .g-glint, scoped here). */
	.primary::after {
		content: '';
		position: absolute;
		inset: -10% auto -10% 0;
		width: 34%;
		background: linear-gradient(90deg, transparent, rgba(255, 244, 214, 0.6), transparent);
		transform: translateX(-130%) skewX(-18deg);
		animation: shine 4.8s ease-in-out 2.4s infinite;
		pointer-events: none;
	}

	.quiet {
		min-height: 2.8rem;
		padding-block: 0.25rem;
	}

	.quiet .medal {
		width: 2rem;
		height: 2rem;
	}

	.quiet .label {
		font-size: 1.12rem;
	}

	/* ---- lit: hover, keyboard focus, panel open ---- */
	.plaque:not(:disabled):hover,
	.plaque:focus-visible,
	.plaque.open {
		--plate: var(--wood-grad-hover);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 1px 0 1px rgba(255, 236, 200, 0.22),
			0 3px 0 var(--ink-line),
			0 9px 18px rgba(8, 4, 0, 0.5),
			0 0 28px rgba(224, 164, 88, 0.26);
		transform: translateY(-1px);
	}

	.plaque:not(:disabled):hover .marker,
	.plaque:focus-visible .marker,
	.plaque.open .marker {
		opacity: 1;
		transform: none;
	}

	.plaque:not(:disabled):hover .medal,
	.plaque:focus-visible .medal,
	.plaque.open .medal {
		color: var(--gilt-hi);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 2px 5px rgba(0, 0, 0, 0.6),
			0 0 14px rgba(255, 190, 100, 0.5);
	}

	.primary:not(:disabled):hover,
	.primary:focus-visible {
		--plate: linear-gradient(180deg, #fbe5b4 0%, #edb96d 38%, #d29749 72%, #b57d36 100%);
		box-shadow:
			inset 0 0 0 1px rgba(255, 248, 226, 0.65),
			inset 0 -3px 5px rgba(120, 70, 20, 0.3),
			0 4px 0 var(--gilt-dark),
			0 12px 24px rgba(8, 4, 0, 0.5),
			0 0 44px rgba(255, 190, 100, 0.45);
	}

	.primary:not(:disabled):hover .medal,
	.primary:focus-visible .medal {
		color: var(--gilt-hi);
	}

	.plaque.open:not(.primary) {
		border-color: var(--gilt-dark);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 0 22px var(--accent-wash),
			0 3px 0 var(--ink-line),
			0 9px 18px rgba(8, 4, 0, 0.5),
			0 0 26px rgba(224, 164, 88, 0.3);
	}

	.plaque:focus-visible {
		outline: 3px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.plaque:not(:disabled):active {
		transform: translateY(2px);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 3px 6px rgba(0, 0, 0, 0.5),
			0 1px 0 var(--ink-line);
	}

	/* ---- not yet: the name is still unwritten. Still legible: it says what it will do. ---- */
	.plaque:disabled {
		--plate: var(--wood-grad);
		cursor: not-allowed;
		border-color: var(--ink-line);
		color: var(--muted);
		text-shadow: none;
		box-shadow:
			inset 0 0 0 1px rgba(240, 212, 158, 0.18),
			0 3px 0 var(--ink-line);
	}

	.plaque:disabled .medal {
		color: var(--muted);
		box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6);
	}

	.plaque:disabled .hint,
	.plaque:disabled .detail {
		color: var(--muted);
	}

	.plaque:disabled .marker {
		opacity: 0.85;
		transform: none;
		color: var(--muted);
	}

	.primary:disabled::after {
		display: none;
	}

	@keyframes shine {
		0%,
		40% {
			transform: translateX(-130%) skewX(-18deg);
		}
		100% {
			transform: translateX(380%) skewX(-18deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary::after {
			animation: none;
			display: none;
		}

		.marker {
			transition: none;
		}
	}

	@media (max-width: 47.99rem) {
		.plaque {
			min-height: 3.9rem;
		}

		.quiet {
			min-height: 3.4rem;
		}
	}
</style>
