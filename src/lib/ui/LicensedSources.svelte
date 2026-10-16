<script lang="ts">
	import { describeTerms } from '$lib/content/licence';
	import type { RoomAction, SourcesReply } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';

	/**
	 * The licensed sources installed on this server that the GM may use
	 * (milestone 59): what each is, whose, its terms in words and its credit,
	 * and Use to bring it to the story. The server decides who may use what;
	 * this only asks.
	 */
	interface Props {
		reply: SourcesReply | null;
		/** Ids of the licensed sources the story already has. */
		attached: string[];
		send(action: RoomAction): boolean;
	}

	let { reply, attached, send }: Props = $props();
	let asked = $state(-1);
	const shown = $derived(reply && reply.seq > asked ? reply : null);

	function ask() {
		asked = reply?.seq ?? -1;
		send({ type: 'content_sources' });
	}
	const kinds = (counts: Record<string, number>) =>
		Object.entries(counts)
			.map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`)
			.join(', ');
</script>

<div class="licensed">
	<button type="button" onclick={ask}><Icon name="scroll" size="1.1em" />Licensed content…</button>
	{#if shown}
		{#if shown.sources.length}
			<ul class="sources" aria-label="Licensed sources">
				{#each shown.sources as s (s.id)}
					<li>
						<div class="head">
							<strong>{s.name}</strong>
							<span class="g-tag brass">Licensed · {s.publisher}</span>
							<span class="muted small">{s.version}</span>
						</div>
						{#if s.hypothetical}<p class="small muted">
								Hypothetical: made up for tests and docs.
							</p>{/if}
						<p class="small">{s.about}</p>
						<p class="small muted">{kinds(s.counts)}</p>
						<ul class="terms">
							{#each describeTerms(s.terms) as line (line)}<li>{line}</li>{/each}
						</ul>
						<p class="credit">{s.terms.licence.name} · {s.attribution}</p>
						<button
							type="button"
							disabled={!s.usable || attached.includes(s.id)}
							onclick={() => send({ type: 'adventure_pack', op: 'licensed', source: s.id })}
						>
							{#if attached.includes(s.id)}<Icon name="check" size="1.1em" />{/if}
							{attached.includes(s.id) ? 'In the story' : s.usable ? 'Use it' : 'Other rules'}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="small muted">
				No licensed source on this server is yours to use. Its operator grants them by your creator
				id.
			</p>
		{/if}
	{/if}
</div>

<style>
	.licensed {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
		width: 100%;
	}

	/* A source: a plate sunk into the drawer, its terms spelled out. */
	.sources > li {
		display: grid;
		gap: var(--sp-2);
		justify-items: start;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px var(--gilt-line);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
	}

	.head strong {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
	}

	.terms {
		gap: 0;
		padding-left: var(--sp-5);
		list-style: disc;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	p {
		margin: 0;
	}

	.small {
		font-size: var(--fs-xs);
	}

	.muted {
		color: var(--muted);
	}

	.credit {
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	@media (max-width: 48rem) {
		button {
			min-height: 2.75rem;
		}
	}
</style>
