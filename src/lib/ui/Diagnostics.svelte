<script lang="ts">
	import { hintOf, type Diagnostic } from '$lib/validation/diagnostics';
	import { Icon } from '$lib/ui/game';

	/**
	 * What is wrong with a piece of content (milestone 56): each finding with
	 * where it is, what exactly, its code and how to fix it. The same list
	 * whether the builder found it or the server refused with it.
	 *
	 * It stands on any dark ground (the library hall, the builder's panels): each finding is a
	 * small slate of its own, marked by a word and an icon (oxblood for a problem, brass for a
	 * warning), never by colour alone.
	 */
	interface Props {
		diagnostics: readonly Diagnostic[];
	}

	let { diagnostics }: Props = $props();
</script>

{#if diagnostics.length}
	<ul class="diagnostics">
		{#each diagnostics as d, i (i)}
			<li class="{d.severity} g-rise" style:--i={Math.min(i, 6)}>
				<span class="mark">
					<Icon name={d.severity === 'warning' ? 'info' : 'warn'} size="1.05em" />
					<span class="word">{d.severity === 'warning' ? 'Warning' : 'Problem'}</span>
				</span>
				<div class="body">
					<div class="line">
						{#if d.path}<code class="path">{d.path}</code>{/if}
						<span class="message">{d.message}</span>
					</div>
					<div class="hint">
						<span class="code">{d.code}</span>
						{hintOf(d.code)}
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.diagnostics {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--sp-4);
	}

	li {
		--tone: var(--danger);
		--tone-ink: #ffd7cf;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: var(--sp-3) var(--sp-5);
		padding: var(--sp-4) var(--sp-5) var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-left: 4px solid var(--tone);
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, rgba(90, 36, 28, 0.55), rgba(24, 14, 10, 0.82) 70%);
		box-shadow:
			inset 0 0 0 1px rgba(255, 170, 150, 0.14),
			0 2px 0 var(--ink-line);
		color: var(--text);
		overflow-wrap: anywhere;
		animation-delay: calc(var(--i, 0) * 50ms);
	}

	li.warning {
		--tone: var(--gilt);
		--tone-ink: var(--gilt-hi);
		background: linear-gradient(90deg, rgba(120, 80, 28, 0.45), rgba(24, 14, 10, 0.82) 70%);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 2px 0 var(--ink-line);
	}

	/* The word and the icon say what kind of finding it is, so colour is never alone. */
	.mark {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		min-height: 1.5rem;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--tone-ink);
		white-space: nowrap;
	}

	.body {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-4);
		align-items: baseline;
	}

	.message {
		color: var(--text);
	}

	.path {
		padding: 0 var(--sp-3);
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.4);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-xs);
		color: var(--gilt-hi);
	}

	.hint {
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.code {
		margin-right: var(--sp-2);
		font-family: var(--font-mono, monospace);
		font-size: var(--fs-xs);
		color: var(--tone-ink);
		opacity: 0.9;
	}

	@media (max-width: 30rem) {
		li {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
