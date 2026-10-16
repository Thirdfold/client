<script lang="ts" module>
	// A move resets the room, which mounts this panel afresh: what it was showing carries over.
	let shownOpen = false;
	let askedBefore = -1;
</script>

<script lang="ts">
	import type { UpgradeReview, VersionsView } from '$lib/adventure/versions';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';
	import GmDrawer from './GmDrawer.svelte';

	/**
	 * The GM's view of what the story is pinned to (milestone 55), and moving
	 * it to another version of its library content: reviewed first (what
	 * changes, whether the story fits), then moved only when the GM says so,
	 * and moved back the same way. The server decides; this only asks.
	 */
	interface Props {
		versions: VersionsView;
		/** The latest review or move the server answered. */
		reply: { review: UpgradeReview; applied: boolean; seq: number } | null;
		send(action: RoomAction): boolean;
	}

	let { versions, reply, send }: Props = $props();

	/** The reply this panel asked for (an older one isn't shown). */
	let asked = $state(askedBefore);
	let open = $state(shownOpen);
	$effect(() => {
		shownOpen = open;
		askedBefore = asked;
	});
	const shown = $derived(reply && reply.seq > asked ? reply : null);
	let waiting = $state(false);
	$effect(() => {
		if (shown) waiting = false;
	});

	const lock = $derived(versions.lock);
	const short = (hash: string) => hash.slice(0, 8);

	/** Asks, and stops waiting after a while if the answer was an error (shown elsewhere). */
	function ask() {
		asked = reply?.seq ?? -1;
		waiting = true;
		setTimeout(() => (waiting = false), 6000);
	}

	function review(what: 'adventure' | 'collection', version?: number) {
		ask();
		send({ type: 'adventure_upgrade', op: 'review', what, ...(version ? { version } : {}) });
	}

	function apply(r: UpgradeReview) {
		ask();
		send({ type: 'adventure_upgrade', op: 'apply', what: r.what, version: r.to });
	}

	const last = $derived(versions.steps.at(-1) ?? null);
</script>

<GmDrawer title="Versions" icon="save" bind:open>
	<dl class="plate">
		<dt>Rules</dt>
		<dd>{lock.rules.name} <span class="muted">v{lock.rules.version}</span></dd>
		{#each lock.content as c (c.id)}
			<dt>Content</dt>
			<dd>
				{c.name} <span class="muted">{c.version} · build {short(c.build)}</span>
			</dd>
		{/each}
		<dt>Adventure</dt>
		<dd>
			{#if lock.adventure.kind === 'built-in'}
				Comes with thirdfold <span class="muted">(saved state v{lock.adventure.version})</span>
			{:else if lock.adventure.library}
				{lock.adventure.title}
				<span class="muted"
					>version {lock.adventure.library.version}, by {lock.adventure.library.creator.name}</span
				>
			{:else}
				{lock.adventure.title} <span class="muted">from a file</span>
			{/if}
		</dd>
		{#if lock.packs.length}
			<dt>Homebrew</dt>
			<dd>{lock.packs.map((p) => `${p.name} ${p.version}`).join(', ')}</dd>
		{/if}
		{#if lock.collection}
			<dt>Collection</dt>
			<dd>{lock.collection.title} <span class="muted">version {lock.collection.version}</span></dd>
		{/if}
	</dl>
	<p class="muted small">
		Its creator’s updates never change this story. Look for a newer version to see what would
		change, then move the story if you want to.
	</p>

	<div class="row">
		{#if versions.movable.adventure}
			<button type="button" disabled={waiting} onclick={() => review('adventure')}>
				<Icon name="search" size="1.1em" />Look for a newer version
			</button>
		{/if}
		{#if versions.movable.collection}
			<button type="button" disabled={waiting} onclick={() => review('collection')}>
				<Icon name="search" size="1.1em" />Look for a newer collection
			</button>
		{/if}
		{#if last}
			<button type="button" disabled={waiting} onclick={() => review(last.what, last.from)}>
				<Icon name="back" size="1.1em" />Back to version {last.from}…
			</button>
		{/if}
	</div>

	{#if shown}
		{@const r = shown.review}
		<div class="review" role="status">
			{#if shown.applied}
				<p class="ok">
					<Icon name="check" size="1em" />Moved the story {r.rollback ? 'back ' : ''}to version {r.to}
					of {r.title}.
				</p>
			{:else}
				<p>
					<strong>{r.title}</strong>: version {r.from} → {r.to}{r.rollback ? ' (back)' : ''}
				</p>
				{#if r.changes.length || r.packs.added.length || r.packs.removed.length}
					<ul class="changes">
						{#each r.changes as c (c.section)}
							<li>
								<strong>{c.section}</strong>
								{#if c.added.length}<span class="added">+ {c.added.join(', ')}</span>{/if}
								{#if c.removed.length}<span class="removed">− {c.removed.join(', ')}</span>{/if}
								{#if c.changed.length}<span class="muted">changed: {c.changed.join(', ')}</span
									>{/if}
							</li>
						{/each}
						{#if r.packs.added.length}<li>
								<strong>Homebrew</strong> <span class="added">+ {r.packs.added.join(', ')}</span>
							</li>{/if}
						{#if r.packs.removed.length}<li>
								<strong>Homebrew</strong>
								<span class="removed">− {r.packs.removed.join(', ')}</span>
							</li>{/if}
					</ul>
				{:else}
					<p class="muted">Nothing in the adventure changes.</p>
				{/if}
				{#if r.problems.length}
					<ul class="problems" role="alert">
						{#each r.problems as p (p)}<li><Icon name="warn" size="1em" />{p}</li>{/each}
					</ul>
				{:else}
					<button type="button" class="primary" disabled={waiting} onclick={() => apply(r)}>
						<Icon name="check" size="1.1em" />Move the story to version {r.to}
					</button>
				{/if}
			{/if}
		</div>
	{/if}

	{#if versions.steps.length}
		<p class="muted small">Moves so far:</p>
		<ol class="steps">
			{#each versions.steps as s, i (i)}
				<li class="muted small">
					{s.what === 'adventure' ? 'Adventure' : 'Collection'} version {s.from} → {s.to}{s.rollback
						? ' (back)'
						: ''} · {new Date(s.at).toLocaleString()}
				</li>
			{/each}
		</ol>
	{/if}
</GmDrawer>

<style>
	p {
		margin: 0;
	}

	/* What the story is pinned to: an engraved plate. */
	.plate {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-2) var(--sp-5);
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
	}

	dt {
		font-family: var(--font-label);
		letter-spacing: 0.05em;
		color: var(--gilt);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}

	.review {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.2);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
	}

	ul,
	ol {
		margin: 0;
		padding-left: var(--sp-5);
		display: grid;
		gap: var(--sp-1);
	}

	.changes li {
		overflow-wrap: anywhere;
	}

	.changes span {
		margin-left: var(--sp-2);
	}

	.added,
	.ok {
		color: #9fd49a;
	}

	.removed,
	.problems {
		color: #ff9d8f;
	}

	.problems {
		padding-left: 0;
		list-style: none;
	}

	.problems li {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-3);
	}

	.ok {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: var(--fs-xs);
	}

	button.primary {
		justify-self: start;
	}

	@media (max-width: 48rem) {
		.row button,
		button.primary {
			min-height: 2.75rem;
		}
	}
</style>
