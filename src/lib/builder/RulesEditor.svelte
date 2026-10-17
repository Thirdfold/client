<script lang="ts">
	import { Icon } from '$lib/ui/game';
	import { without, type DraftRule as Rule } from './draft';
	import EffectsEditor from './EffectsEditor.svelte';
	import WhenEditor from './WhenEditor.svelte';

	/** Rules: the first whose conditions hold is the one that happens (one without conditions always holds). */
	let { rules = $bindable() }: { rules: Rule[] } = $props();

	const setRule = (i: number, next: Rule) => (rules = rules.map((r, j) => (j === i ? next : r)));
	const count = (when: Rule['if']) => Object.keys(when ?? {}).length;
</script>

<div class="rules">
	{#if rules.length === 0}
		<p class="none">No rules yet: the first one whose conditions hold is the one that happens.</p>
	{/if}
	<ol>
		{#each rules as rule, i (i)}
			<li class="rule" class:last={!rule.if}>
				<span class="knot" aria-hidden="true">{i + 1}</span>
				<div class="body">
					<details open={!rule.if}>
						<summary>
							<Icon name={rule.if ? 'wand' : 'sparkle'} size="1.05em" />
							{rule.if ? 'If…' : 'Otherwise (always)'}
							{#if rule.if}<span class="n"
									>{count(rule.if)} {count(rule.if) === 1 ? 'condition' : 'conditions'}</span
								>{/if}
						</summary>
						<WhenEditor
							bind:when={
								() => rule.if,
								(when) => {
									setRule(i, when ? { ...rule, if: when } : without(rule, 'if'));
								}
							}
						/>
					</details>
					<EffectsEditor
						bind:effects={() => [...rule.do], (d) => setRule(i, { ...rule, do: d })}
						label="Then"
					/>
					<button
						type="button"
						class="danger remove"
						onclick={() => (rules = rules.filter((_, j) => j !== i))}
					>
						<Icon name="trash" size="1em" />Remove this rule
					</button>
				</div>
			</li>
		{/each}
	</ol>
	<button type="button" class="add" onclick={() => (rules = [...rules, { do: [] }])}>
		<Icon name="plus" size="1em" />Add a rule
	</button>
</div>

<style>
	.rules {
		display: grid;
		gap: var(--sp-4);
		justify-items: start;
		min-width: 0;
		width: 100%;
	}

	ol {
		display: grid;
		gap: var(--sp-5);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.none {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	/* One rule: a numbered knot on a thread that runs down the rules, as a branch in a flow. */
	.rule {
		position: relative;
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		gap: var(--sp-4);
	}

	.rule:not(:last-child)::before {
		content: '';
		position: absolute;
		top: 2rem;
		bottom: calc(var(--sp-5) * -1);
		left: calc(1rem - 1px);
		width: 2px;
		background: linear-gradient(180deg, var(--border-strong), var(--border));
	}

	.knot {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: var(--panel-raised);
		box-shadow:
			inset 0 0 0 1px var(--border-strong),
			0 2px 0 var(--ink-line);
		font-family: var(--font-label);
		font-weight: 700;
		color: var(--accent);
	}

	.last .knot {
		background: var(--accent-wash);
	}

	.body {
		display: grid;
		gap: var(--sp-4);
		min-width: 0;
		padding: var(--sp-4) var(--sp-5) var(--sp-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.14);
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin-bottom: var(--sp-4);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent);
		cursor: pointer;
	}

	details:not([open]) summary {
		margin-bottom: 0;
	}

	.n {
		font-family: var(--font-ui);
		font-size: var(--fs-xs);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--muted);
	}

	.remove {
		justify-self: start;
		min-height: 2.25rem;
		padding-block: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.add {
		min-height: 2.25rem;
		border-style: dashed;
		background: transparent;
		box-shadow: none;
		color: var(--accent);
	}
</style>
