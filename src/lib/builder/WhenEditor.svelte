<script lang="ts">
	import { Icon, type IconName } from '$lib/ui/game';
	import type { DraftWhen as When } from './draft';
	import ListInput from './ListInput.svelte';

	/**
	 * Conditions: every one filled in must hold. Lists are written with commas.
	 * An empty set of conditions always holds (and is left out of the file).
	 */
	let { when = $bindable() }: { when: When | undefined } = $props();

	const w = $derived(when ?? {});

	function set<K extends keyof When>(key: K, value: When[K] | undefined) {
		const next: When = { ...w };
		if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
		else next[key] = value;
		when = Object.keys(next).length ? next : undefined;
	}

	const chose = $derived(
		Object.entries(w.chose ?? {})
			.map(([d, o]) => `${d}=${o}`)
			.join(', ')
	);
</script>

{#snippet head(icon: IconName, text: string)}
	<span class="head"><Icon name={icon} size="1.05em" />{text}</span>
{/snippet}

<div class="when">
	<label class="cond" class:on={!!w.events?.length}>
		{@render head('bell', 'After events')}
		<ListInput
			label="Events that have happened"
			options="ids-events"
			bind:value={() => w.events, (v) => set('events', v)}
			placeholder="event, event"
		/>
	</label>
	<label class="cond" class:on={!!w.not?.length}>
		{@render head('close', 'Not after')}
		<ListInput
			label="Events that have not happened"
			options="ids-events"
			bind:value={() => w.not, (v) => set('not', v)}
		/>
	</label>
	<label class="cond" class:on={!!w.found?.length}>
		{@render head('eye', 'Party found')}
		<ListInput
			label="Clues someone found"
			options="ids-clues"
			bind:value={() => w.found, (v) => set('found', v)}
		/>
	</label>
	<label class="cond" class:on={!!w.unfound?.length}>
		{@render head('eyeoff', 'Nobody found')}
		<ListInput
			label="Clues nobody found"
			options="ids-clues"
			bind:value={() => w.unfound, (v) => set('unfound', v)}
		/>
	</label>
	<label class="cond" class:on={!!w.clues?.length}>
		{@render head('key', 'This character knows')}
		<ListInput
			label="Clues the character acting knows"
			options="ids-clues"
			bind:value={() => w.clues, (v) => set('clues', v)}
		/>
	</label>
	<label class="cond" class:on={!!w.state?.length}>
		{@render head('user', 'In state')}
		<ListInput
			label="The speaker's or object's state"
			bind:value={() => w.state, (v) => set('state', v)}
			placeholder="e.g. worried"
		/>
	</label>
	<label class="cond" class:on={!!w.chapter?.length}>
		{@render head('flag', 'In chapter')}
		<ListInput
			label="Chapters"
			options="ids-chapters"
			bind:value={() => w.chapter, (v) => set('chapter', v)}
		/>
	</label>
	<label class="cond" class:on={!!chose}>
		{@render head('scroll', 'Chose')}
		<input
			aria-label="Choices made (choice=answer)"
			placeholder="choice=answer"
			value={chose}
			onchange={(e) => {
				const pairs = e.currentTarget.value
					.split(',')
					.map((p) => p.split('=').map((s) => s.trim()))
					.filter(([d, o]) => d && o);
				set('chose', pairs.length ? Object.fromEntries(pairs) : undefined);
			}}
		/>
	</label>
</div>

<style>
	.when {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
		gap: var(--sp-4);
	}

	/* A condition plate: it lights when it has something in it. */
	.cond {
		display: grid;
		gap: var(--sp-3);
		align-content: start;
		padding: var(--sp-4) var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		box-shadow: inset 0 0 0 1px var(--border);
		color: var(--muted);
		transition:
			box-shadow 160ms var(--ease-out),
			background 160ms var(--ease-out);
	}

	.cond.on {
		background: var(--accent-wash);
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 14px var(--accent-wash);
		color: var(--text);
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.cond.on .head {
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.cond {
			transition: none;
		}
	}
</style>
