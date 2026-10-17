<script lang="ts">
	import type { CollectionReport, DependencyStatus } from '$lib/game/collection';
	import { Icon, type IconName } from '$lib/ui/game';

	/**
	 * A collection and what the server found of everything it names, as a checklist on the
	 * collection's parchment page: each piece with its kind, and a stamp (word and icon) for whether
	 * it can be used. Ink colours throughout: it is read on vellum.
	 */
	interface Props {
		report: CollectionReport;
	}

	let { report }: Props = $props();

	const KIND: Record<string, string> = {
		rules: 'Rules',
		adventure: 'Adventure',
		pack: 'Homebrew',
		table: 'Table'
	};
	const KIND_ICON: Record<string, IconName> = {
		rules: 'scroll',
		adventure: 'book',
		pack: 'wand',
		table: 'map'
	};
	const STATUS: Record<DependencyStatus, string> = {
		ok: 'Ready',
		missing: 'Missing',
		unavailable: 'Unavailable',
		incompatible: 'Doesn’t fit',
		invalid: 'Broken'
	};
	const bad = $derived(report.items.filter((i) => i.status !== 'ok').length);
</script>

<section class="report" aria-label="What the collection holds">
	<p class="summary" class:ok={report.ok} role="status">
		<Icon name={report.ok ? 'check' : 'warn'} size="1.3em" />
		<span>
			{report.ok
				? 'Everything it names is here and plays by the same rules: it’s ready to run.'
				: `${bad} of ${report.items.length} ${report.items.length === 1 ? 'piece' : 'pieces'} can’t be used, so it can’t be run yet.`}
		</span>
	</p>
	<ul class="g-stagger">
		{#each report.items as item, i (i)}
			<li class={item.status} style:--i={Math.min(i, 8)}>
				<span class="kind"
					><Icon name={KIND_ICON[item.kind] ?? 'book'} />{KIND[item.kind] ?? item.kind}</span
				>
				<span class="what">
					<strong>{item.title ?? item.ref}</strong>
					{#if item.version !== null && item.kind !== 'rules'}<span class="muted"
							>version {item.version}</span
						>{/if}
					{#if item.message}<span class="message">{item.message}</span>{/if}
				</span>
				<span class="status">
					<Icon name={item.status === 'ok' ? 'check' : 'warn'} size="1.05em" />{STATUS[item.status]}
				</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.report {
		display: grid;
		gap: var(--sp-5);
		color: var(--ink);
	}

	/* Whether it can be run, said first, in the page's own hand. */
	.summary {
		display: flex;
		align-items: flex-start;
		gap: 0.55em;
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid rgba(138, 59, 59, 0.55);
		border-radius: var(--radius-sm);
		background: rgba(138, 59, 59, 0.1);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.3;
		color: var(--ink-accent);
	}

	.summary.ok {
		border-color: rgba(40, 92, 36, 0.55);
		background: rgba(40, 92, 36, 0.09);
		color: #285c24;
	}

	.summary :global(.icon) {
		flex: none;
		margin-top: 0.1em;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		border-block: 1px solid var(--vellum-edge);
	}

	li {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr) auto;
		gap: var(--sp-4) var(--sp-5);
		align-items: baseline;
		padding: var(--sp-5) var(--sp-3);
	}

	li + li {
		border-top: 1px dashed var(--vellum-edge);
	}

	li:not(.ok) {
		background: linear-gradient(90deg, rgba(138, 59, 59, 0.1), transparent 80%);
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--ink-muted);
	}

	.kind :global(.icon) {
		align-self: center;
		color: var(--ink-accent);
	}

	.what {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.what strong {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.15;
	}

	.muted,
	.message {
		font-size: var(--fs-sm);
		color: var(--ink-muted);
	}

	li:not(.ok) .message {
		color: var(--ink-accent);
	}

	/* The stamp: a word and an icon, boxed like an inked mark. */
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		padding: 0.1rem 0.6rem;
		border: 1.5px solid currentColor;
		border-radius: var(--radius-sm);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.07em;
		white-space: nowrap;
		color: #285c24;
		rotate: -1.5deg;
	}

	li:not(.ok) .status {
		color: var(--ink-accent);
	}

	@media (max-width: 36rem) {
		li {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.kind {
			grid-column: 1 / -1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.status {
			rotate: none;
		}
	}
</style>
