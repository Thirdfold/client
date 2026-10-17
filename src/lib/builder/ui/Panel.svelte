<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Frame, Icon, type IconName } from '$lib/ui/game';

	/**
	 * A framed panel of the workshop. Iron is a tool tray (fields and switches); parchment is the
	 * story being written (what is said, what is read aloud). Its name sits on a plaque; the form kit
	 * the builder's editors share (fields, grids, rows, wells) is defined here for whatever it holds.
	 */
	interface Props {
		variant?: 'iron' | 'parchment';
		title?: string;
		icon?: IconName;
		level?: 2 | 3 | 4;
		/** Something to the right of the name: a count, a button. */
		aside?: Snippet;
		class?: string;
		children: Snippet;
		[attr: string]: unknown;
	}
	let {
		variant = 'iron',
		title,
		icon,
		level = 3,
		aside,
		class: extra = '',
		children,
		...rest
	}: Props = $props();
</script>

<Frame {variant} as="section" class="panel {extra}" {...rest}>
	<div class="pad" class:vellum={variant === 'parchment'}>
		{#if title}
			<header class="plaque">
				<svelte:element this={`h${level}`}>
					{#if icon}<span class="medal"><Icon name={icon} size="1.05em" /></span>{/if}
					{title}
				</svelte:element>
				{#if aside}<span class="aside">{@render aside()}</span>{/if}
			</header>
		{/if}
		{@render children()}
	</div>
</Frame>

<style>
	:global(.panel) {
		min-width: 0;
	}

	.pad {
		display: grid;
		gap: var(--sp-5);
		grid-template-columns: minmax(0, 1fr);
		padding: var(--sp-6) var(--sp-7);
		min-width: 0;
	}

	/* On parchment the app's vellum variables (ink) apply; the vellum card itself does not. */
	.pad.vellum {
		animation: none;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		clip-path: none;
		color-scheme: light;
		--accent-wash: rgba(138, 59, 59, 0.08);
	}

	.plaque {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5);
		flex-wrap: wrap;
		padding-bottom: var(--sp-4);
		border-bottom: 1px solid var(--gilt-line);
	}

	.vellum .plaque {
		border-bottom-color: rgba(122, 91, 48, 0.45);
	}

	.plaque :is(h2, h3, h4) {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--gilt);
	}

	.vellum .plaque :is(h2, h3, h4) {
		color: var(--ink-accent);
		text-shadow: none;
	}

	.medal {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: linear-gradient(180deg, #3b2c20, #1f1611);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 2px 0 var(--ink-line);
		color: var(--gilt-hi);
	}

	.vellum .medal {
		background: linear-gradient(180deg, #f1e4c8, #dcc79c);
		box-shadow:
			inset 0 0 0 1px #7a5b30,
			0 2px 0 rgba(60, 40, 20, 0.35);
		color: var(--ink-accent);
	}

	.aside {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}

	/* ---- The form kit: fields, grids, rows, wells, hints ---- */

	.pad :global(.field) {
		display: grid;
		gap: var(--sp-2);
		align-content: start;
		min-width: 0;
		font-family: var(--font-label);
		font-size: 0.9rem;
		font-weight: 500;
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	.pad :global(.field > :is(input, select, textarea)),
	.pad :global(.field input),
	.pad :global(.field select),
	.pad :global(.field textarea) {
		font-family: var(--font-ui);
		font-size: var(--fs-md);
		letter-spacing: 0;
		color: var(--text);
	}

	.pad :global(.grid2),
	.pad :global(.grid3) {
		display: grid;
		gap: var(--sp-5) var(--sp-6);
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
	}

	.pad :global(.grid3) {
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
	}

	.pad :global(.row) {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
		align-items: center;
	}

	.pad :global(.check) {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2rem;
		font-family: var(--font-ui);
		font-size: var(--fs-sm);
		letter-spacing: 0;
		color: var(--text);
		cursor: pointer;
	}

	.pad :global(input[type='checkbox']) {
		flex: none;
		width: 1.2rem;
		height: 1.2rem;
		padding: 0;
		accent-color: var(--gilt);
		cursor: pointer;
	}

	.vellum :global(input[type='checkbox']) {
		accent-color: var(--ink-accent);
	}

	.pad :global(.hint) {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.4;
		color: var(--muted);
		max-width: 62ch;
	}

	.pad :global(.hint code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--gilt-hi);
	}

	.vellum :global(.hint code) {
		color: var(--ink-accent);
	}

	/* A recess in the panel for a group of things: lines of a speech, verbs of an object. */
	.pad :global(.well) {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.26);
		box-shadow:
			inset 0 2px 8px rgba(0, 0, 0, 0.45),
			0 1px 0 rgba(240, 212, 158, 0.08);
	}

	.vellum :global(.well) {
		border-color: rgba(122, 91, 48, 0.55);
		background: rgba(122, 91, 48, 0.1);
		box-shadow: inset 0 2px 6px rgba(90, 60, 30, 0.22);
	}

	/* A sub-heading inside a panel. */
	.pad :global(.sub) {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin: var(--sp-3) 0 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--text);
	}

	.pad :global(.sub::after) {
		content: '';
		flex: 1;
		height: 1px;
		background: linear-gradient(90deg, var(--gilt-line), transparent);
	}

	.vellum :global(.sub::after) {
		background: linear-gradient(90deg, rgba(122, 91, 48, 0.5), transparent);
	}

	.pad :global(.sub .hint) {
		font-family: var(--font-ui);
		font-weight: 400;
		letter-spacing: 0;
	}

	/* An unmarked row of buttons at the foot of an editor. */
	.pad :global(.foot) {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
		align-items: center;
		padding-top: var(--sp-4);
		border-top: 1px solid var(--gilt-line);
	}

	.vellum :global(.foot) {
		border-top-color: rgba(122, 91, 48, 0.4);
	}

	.pad :global(button .icon) {
		margin-right: 0.35em;
		vertical-align: -0.22em;
	}

	.pad :global(button.icon-only .icon) {
		margin: 0;
	}

	@media (max-width: 40rem) {
		.pad {
			padding: var(--sp-5) var(--sp-5) var(--sp-6);
		}

		.pad :global(.grid2),
		.pad :global(.grid3) {
			grid-template-columns: 1fr;
		}
	}
</style>
