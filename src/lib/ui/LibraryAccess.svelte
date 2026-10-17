<script lang="ts">
	import {
		GRANT_LIMITS,
		grantActive,
		parseNewGrant,
		type Grant,
		type GrantTarget,
		type LibraryAccess
	} from '$lib/game/access';
	import type { MyAdventure } from '$lib/game/library';
	import type { LibraryOp } from '$lib/game/protocol';
	import { grantAccess, manageAdventure, revokeGrant, type LibraryHome } from '$lib/net/library';
	import { play } from '$lib/audio/engine';
	import { Icon } from '$lib/ui/game';
	import { inSentence, lastPlayed } from '$lib/ui/when';

	/**
	 * Who may find, open and play one of a creator's items, and whom it is
	 * shared with (milestone 54). The server decides every request; this asks.
	 */
	interface Props {
		item: MyAdventure;
		gmKey: string;
		/** The creator's items changed (the server's answer). */
		onChange(home: { mine: MyAdventure[] } | LibraryHome): void;
	}

	let { item, gmKey, onChange }: Props = $props();

	const LEVELS: { access: LibraryAccess; op: LibraryOp; label: string; note: string }[] = [
		{
			access: 'public',
			op: 'list',
			label: 'Public',
			note: 'In the library: anyone finds it, plays it and puts it in a collection.'
		},
		{
			access: 'restricted',
			op: 'restrict',
			label: 'Restricted',
			note: 'In the library, but only those you share it with may open or play it.'
		},
		{
			access: 'private',
			op: 'unlist',
			label: 'Private',
			note: 'Not in the library: only you and those you share it with know it is there.'
		}
	];

	let kind = $state<GrantTarget['kind']>('creator');
	let targetId = $state('');
	let role = $state<'member' | 'collaborator'>('member');
	let hours = $state('');
	let note = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const now = $derived(Date.now());
	const active = $derived(item.grants.filter((g) => grantActive(g, now)));
	const past = $derived(item.grants.filter((g) => !grantActive(g, now)));

	function whom(t: GrantTarget): string {
		if (t.kind === 'creator') return `Creator ${t.id}`;
		if (t.kind === 'collection') return `Collection ${t.id.slice(0, 8)}…`;
		return `Table ${t.id}`;
	}
	const roleWord = (g: Grant) =>
		g.target.kind === 'collection'
			? 'may carry it'
			: g.role === 'collaborator'
				? 'collaborator'
				: 'may play';

	async function act(fn: () => Promise<{ mine: MyAdventure[] } | LibraryHome>) {
		busy = true;
		error = null;
		try {
			onChange(await fn());
			return true;
		} catch (err) {
			error = (err as Error).message;
			return false;
		} finally {
			busy = false;
		}
	}

	async function setLevel(op: LibraryOp) {
		play([{ kind: 'ui', sound: 'select' }]);
		await act(async () => ({ mine: await manageAdventure(gmKey, item.id, op) }));
	}

	async function share(e: SubmitEvent) {
		e.preventDefault();
		const id = targetId.trim();
		const parsed = parseNewGrant({
			target: { kind, id: kind === 'room' ? id.toUpperCase() : id.toLowerCase() },
			role: kind === 'creator' ? role : 'member',
			...(hours.trim() ? { hours: Number(hours) } : {}),
			...(note.trim() ? { note: note.trim() } : {})
		});
		if (!parsed.ok) return void (error = parsed.error);
		if (await act(() => grantAccess(gmKey, item.id, parsed.grant))) targetId = hours = note = '';
	}
</script>

<div class="access g-rise">
	<fieldset disabled={busy} class="levels">
		<legend><Icon name="lock" size="1.05em" />Who may find and play it</legend>
		{#each LEVELS as level (level.access)}
			<label class="level" class:on={item.access === level.access}>
				<input
					type="radio"
					name={`access-${item.id}`}
					checked={item.access === level.access}
					onchange={() => setLevel(level.op)}
				/>
				<span class="words"
					><strong>{level.label}</strong> <span class="muted">{level.note}</span></span
				>
			</label>
		{/each}
	</fieldset>

	<div class="grants">
		<h4><Icon name="users" size="1.05em" />Shared with</h4>
		{#if active.length}
			<ul>
				{#each active as g (g.id)}
					<li>
						<span class="who">
							<strong>{whom(g.target)}</strong>
							<span class="muted">
								· {roleWord(g)} · since {inSentence(lastPlayed(g.at))}{g.expires
									? ` · until ${new Date(g.expires).toLocaleString()}`
									: ''}{g.note ? ` · ${g.note}` : ''}
							</span>
						</span>
						<button
							type="button"
							class="danger"
							disabled={busy}
							onclick={() => act(() => revokeGrant(gmKey, item.id, g.id))}
							><Icon name="close" />Revoke</button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted nobody">Nobody yet.</p>
		{/if}
		{#if past.length}
			<details>
				<summary class="muted"
					><Icon name="hourglass" size="1em" />{past.length} revoked or run out</summary
				>
				<ul>
					{#each past as g (g.id)}
						<li class="muted past">
							{whom(g.target)} · {roleWord(g)} · {g.revoked
								? `revoked ${new Date(g.revoked).toLocaleString()}`
								: `ran out ${new Date(g.expires!).toLocaleString()}`}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>

	<form class="share" onsubmit={share}>
		<h4><Icon name="key" size="1.05em" />Share it</h4>
		<div class="row">
			<label>
				<span class="cap">With</span>
				<select bind:value={kind} disabled={busy}>
					<option value="creator">a creator</option>
					<option value="collection">a collection</option>
					<option value="room">a table, for a while</option>
				</select>
			</label>
			<label class="grow">
				<span class="cap"
					>{kind === 'creator'
						? 'Their creator id'
						: kind === 'collection'
							? 'The collection’s id (from its link)'
							: 'The table’s code'}</span
				>
				<input
					bind:value={targetId}
					required
					disabled={busy}
					maxlength={32}
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			{#if kind === 'creator'}
				<label>
					<span class="cap">As</span>
					<select bind:value={role} disabled={busy}>
						<option value="member">may play it</option>
						<option value="collaborator">a collaborator</option>
					</select>
				</label>
			{/if}
			<label>
				<span class="cap">For hours</span>
				<input
					bind:value={hours}
					inputmode="numeric"
					disabled={busy}
					placeholder={kind === 'room' ? `${GRANT_LIMITS.roomHours}` : 'always'}
					size="6"
				/>
			</label>
		</div>
		<label>
			<span class="cap">Note <span class="muted">(only you see it)</span></span>
			<input bind:value={note} maxlength={GRANT_LIMITS.note} disabled={busy} />
		</label>
		<p class="muted small">
			{kind === 'creator'
				? role === 'collaborator'
					? 'A collaborator may also add versions, put it in their collections and export what they play.'
					: 'They may open and play it, not pass it on or export it.'
				: kind === 'collection'
					? 'Anyone who runs that collection plays it there, nowhere else.'
					: 'Whoever runs that table plays it, for at most a day.'}
		</p>
		<button type="submit" class="primary" disabled={busy}><Icon name="key" />Share</button>
	</form>
	{#if error}<p class="error" role="alert"><Icon name="warn" />{error}</p>{/if}
</div>

<style>
	/* A tray let into the published item's row: sunken wood with a gilt line. */
	.access {
		display: grid;
		gap: var(--sp-6);
		margin-top: var(--sp-3);
		padding: var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.28);
		box-shadow:
			inset 0 2px 6px rgba(0, 0, 0, 0.5),
			inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
	}

	legend,
	h4 {
		display: flex;
		align-items: center;
		gap: 0.45em;
		margin: 0 0 var(--sp-3);
		padding: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--gilt);
		text-shadow: none;
	}

	/* The three levels are plates; the lit one is the one in force. */
	.level {
		display: flex;
		gap: var(--sp-5);
		align-items: flex-start;
		min-height: 2.75rem;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 2px 0 var(--ink-line);
		cursor: pointer;
		transition:
			box-shadow 140ms var(--ease-out),
			background 140ms var(--ease-out);
	}

	.level:hover {
		background: var(--wood-grad-hover);
	}

	.level.on {
		background: linear-gradient(180deg, #2a1d10, #3a2814);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 2px 6px rgba(0, 0, 0, 0.5),
			0 0 16px rgba(224, 164, 88, 0.25);
	}

	.level:has(input:focus-visible) {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.level input {
		flex: none;
		width: 1.15rem;
		height: 1.15rem;
		margin: 0.1rem 0 0;
	}

	.words {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}

	.level.on strong {
		color: var(--gilt-hi);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}

	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3) var(--sp-5);
		padding: var(--sp-3) var(--sp-5);
		border-radius: var(--radius-sm);
		background: rgba(255, 238, 214, 0.05);
		overflow-wrap: anywhere;
	}

	li.past {
		display: block;
		background: transparent;
		padding-block: var(--sp-2);
	}

	.who {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}

	li button {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		min-height: 2.5rem;
	}

	.nobody {
		margin: 0;
	}

	details {
		margin-top: var(--sp-4);
	}

	summary {
		display: flex;
		align-items: center;
		gap: 0.45em;
		min-height: 2.5rem;
		cursor: pointer;
	}

	.share {
		display: grid;
		gap: var(--sp-5);
	}

	.share label {
		display: grid;
		gap: var(--sp-2);
	}

	.cap {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.05em;
		color: var(--text);
	}

	.share input,
	.share select {
		min-height: 2.5rem;
		padding: 0.4rem 0.7rem;
		color: var(--text);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5);
		align-items: end;
	}

	.grow {
		flex: 1;
		min-width: 12rem;
	}

	.share button {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
	}

	p {
		margin: 0;
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: var(--fs-xs);
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.5em;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid rgba(226, 122, 107, 0.55);
		border-radius: var(--radius-sm);
		background: rgba(54, 24, 18, 0.9);
		color: #ffd7cf;
	}

	@media (max-width: 48rem) {
		.access {
			padding: var(--sp-5);
		}

		.share button,
		li button {
			min-height: 2.75rem;
		}
	}
</style>
