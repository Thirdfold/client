<script lang="ts" module>
	// A start or a return resets the room, which mounts this panel afresh: keep it open.
	let shownOpen = false;
</script>

<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CAMPAIGN_LIMITS, type RosterEntryView, type RosterStatus } from '$lib/game/campaign';
	import type { CampaignReply, RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';
	import GmDrawer from './GmDrawer.svelte';

	/**
	 * The GM's campaigns (milestone 58): a party carried from adventure to
	 * adventure. Begin or open one at the table, and every adventure started
	 * here brings its active characters; return a finished story to it to
	 * write its history, rest the party and advance the survivors. The server
	 * keeps the campaign and decides everything; this only asks.
	 */
	interface Props {
		adventure: AdventureView | null;
		reply: CampaignReply | null;
		send(action: RoomAction): boolean;
	}

	let { adventure, reply, send }: Props = $props();

	let open = $state(shownOpen);
	$effect(() => {
		shownOpen = open;
	});
	// Asked once the panel is open, and again after a campaign is put away.
	$effect(() => {
		if (open && !reply?.campaigns) send({ type: 'campaign_list' });
	});

	const current = $derived(reply?.current ?? null);
	const others = $derived((reply?.campaigns ?? []).filter((c) => c.id !== current?.id));
	let name = $state('');

	/** The story here is played for the open campaign, and not yet back in it. */
	const story = $derived(
		adventure?.campaign && current && adventure.campaign.id === current.id
			? adventure.campaign
			: null
	);
	const over = $derived(adventure?.stage === 'complete' || adventure?.stage === 'defeat');
	let advance = $state(true);

	function begin(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		send({ type: 'campaign_create', name: name.trim() });
		name = '';
	}

	function putAway() {
		send({ type: 'campaign_open', campaignId: null });
		send({ type: 'campaign_list' });
	}

	function returnStory() {
		const why = over
			? 'Write this story into the campaign?'
			: 'The story isn’t over. Return it to the campaign as left unfinished?';
		if (confirm(why)) send({ type: 'campaign_close', advance: over && advance });
	}

	function forget(id: string, title: string) {
		if (confirm(`Forget the campaign ${title}? Its roster and history go with it.`))
			send({ type: 'campaign_delete', campaignId: id });
	}

	const roster = (op: 'approve' | 'retire' | 'restore', e: RosterEntryView) =>
		send({ type: 'campaign_roster', op: { op, character: e.id } });

	function assign(e: RosterEntryView, value: string) {
		const player = value.trim() || null;
		if (player !== e.player)
			send({ type: 'campaign_roster', op: { op: 'assign', character: e.id, player } });
	}

	const STATUS: Record<RosterStatus, string> = {
		active: 'Comes along',
		pending: 'Waiting for you',
		retired: 'Retired',
		dead: 'Fallen'
	};
	const OUTCOME = { complete: 'finished', defeat: 'the party fell', abandoned: 'left unfinished' };
	const when = (at: string) => new Date(at).toLocaleDateString();
</script>

<GmDrawer title={`Campaign${current ? `: ${current.name}` : ''}`} icon="flag" bind:open>
	{#if !current}
		<p class="muted small">
			A campaign carries a party from one adventure to the next: their gear, their levels and the
			story so far. Open one here, and the next adventure you start brings its characters.
		</p>
		{#if others.length}
			<ul class="list" aria-label="Your campaigns">
				{#each others as c (c.id)}
					<li>
						<span class="what">
							<strong>{c.name}</strong>
							<span class="muted small"
								>{c.rules} · {c.characters}
								{c.characters === 1 ? 'character' : 'characters'} · {c.adventures}
								{c.adventures === 1 ? 'adventure' : 'adventures'}</span
							>
						</span>
						<span class="row">
							<button
								type="button"
								onclick={() => send({ type: 'campaign_open', campaignId: c.id })}
							>
								<Icon name="book" size="1.1em" />Open
							</button>
							<button type="button" class="quiet ghost" onclick={() => forget(c.id, c.name)}>
								<Icon name="trash" size="1.1em" />Forget
							</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		<form class="row" onsubmit={begin}>
			<input
				aria-label="New campaign’s name"
				placeholder="The Long Road"
				maxlength={CAMPAIGN_LIMITS.name}
				bind:value={name}
			/>
			<button type="submit" disabled={!name.trim()}>
				<Icon name="plus" size="1.1em" />Begin a campaign
			</button>
		</form>
		<p class="muted small">Campaigns play by the fifth edition rules (SRD 5.2.1).</p>
	{:else}
		<p class="muted small">
			{current.rules.name} v{current.rules.version}
			{#each current.content as c (c.id)}· {c.name}{/each}
			· since {when(current.createdAt)}
		</p>
		{#if current.playing}
			<p class="small playing">
				<Icon name="play" size="1em" />Playing <strong>{current.playing.title}</strong>
			</p>
		{/if}

		{#if story && !story.closed}
			<div class="return">
				{#if over}
					<label class="check">
						<input type="checkbox" bind:checked={advance} />
						{adventure?.stage === 'complete'
							? 'Survivors advance a level'
							: 'Nobody advances after a defeat'}
					</label>
				{/if}
				<button type="button" class="primary" onclick={returnStory}>
					<Icon name="save" size="1.1em" />Return {adventure?.title} to the campaign
				</button>
				<p class="muted small">
					Writes its history, keeps everyone’s gear, gives the party a full rest and puts new
					characters on the roster for you to approve.
				</p>
			</div>
		{:else if story?.closed}
			<p class="ok small">
				<Icon name="check" size="1em" />This story is written into the campaign.
			</p>
		{/if}

		<h4 class="rubric"><Icon name="users" size="1.1em" />Roster</h4>
		{#if current.roster.length}
			<ul class="list" aria-label="Roster">
				{#each current.roster as e (e.id)}
					<li class:faded={e.status === 'retired' || e.status === 'dead'}>
						<span class="what">
							<strong>{e.name}</strong>
							<span class="muted small">{e.title ?? `level ${e.level}`}</span>
							<span
								class="g-tag status"
								class:brass={e.status === 'pending'}
								class:ember={e.status === 'dead'}
								data-status={e.status}>{STATUS[e.status]}</span
							>
						</span>
						<span class="row">
							<input
								class="player"
								aria-label={`Who plays ${e.name}`}
								placeholder="Anyone"
								value={e.player ?? ''}
								onchange={(ev) => assign(e, ev.currentTarget.value)}
							/>
							{#if e.status === 'pending'}
								<button type="button" onclick={() => roster('approve', e)}>
									<Icon name="check" size="1.1em" />Approve
								</button>
							{/if}
							{#if e.status === 'active' || e.status === 'pending'}
								<button type="button" class="quiet ghost" onclick={() => roster('retire', e)}>
									Retire
								</button>
							{:else if e.status === 'retired'}
								<button type="button" onclick={() => roster('restore', e)}>
									<Icon name="refresh" size="1.1em" />Bring back
								</button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted small">
				Nobody yet. Characters played in an adventure for the campaign join the roster when you
				return the story.
			</p>
		{/if}

		{#if current.history.length}
			<h4 class="rubric"><Icon name="scroll" size="1.1em" />The story so far</h4>
			<ol class="history">
				{#each current.history.toReversed() as h, i (i)}
					<li>
						<strong>{h.title}</strong>
						<span class="muted small"
							>{OUTCOME[h.outcome]}{h.ending ? `: ${h.ending}` : ''} · {when(h.endedAt)}</span
						>
						<div class="small">
							{#each h.characters as c, j (c.id)}{j ? ', ' : ''}{c.name}{c.fate === 'dead'
									? ' (fell)'
									: c.advancedTo
										? ` (level ${c.advancedTo})`
										: ''}{/each}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
		{#if current.rewards.length}
			<h4 class="rubric"><Icon name="star" size="1.1em" />Rewards</h4>
			<p class="small">{current.rewards.join(' · ')}</p>
		{/if}

		<div class="row">
			<button
				type="button"
				class="quiet ghost"
				disabled={!!story && !story.closed && !!adventure && adventure.stage !== 'choosing'}
				onclick={putAway}><Icon name="back" size="1.1em" />Put the campaign away</button
			>
		</div>
	{/if}
</GmDrawer>

<style>
	p {
		margin: 0;
	}

	.rubric {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: var(--sp-3) 0 0;
		padding-bottom: var(--sp-2);
		border-bottom: 1px solid rgba(0, 0, 0, 0.6);
		box-shadow: 0 1px 0 rgba(240, 212, 158, 0.12);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.07em;
		color: var(--gilt);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		align-items: center;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}

	/* The name over its button: the drawer is narrow. */
	form.row {
		display: grid;
	}

	.list,
	.history {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--sp-3);
	}

	/* A roster entry or a past story: a plate sunk into the drawer. */
	.list li,
	.history li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--sp-3);
		align-items: center;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px var(--gilt-line);
	}

	.history li {
		display: grid;
		justify-content: stretch;
		gap: var(--sp-1);
	}

	.what {
		display: grid;
		gap: var(--sp-1);
		justify-items: start;
		min-width: 0;
	}

	.what strong {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
	}

	.faded {
		opacity: 0.65;
	}

	.player {
		width: 8em;
	}

	.playing {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.return {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.2);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.return .primary {
		justify-self: start;
	}

	.check {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		font-size: var(--fs-sm);
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: var(--fs-xs);
	}

	.ok {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		color: #9fd49a;
	}

	@media (max-width: 48rem) {
		.row button,
		.row input {
			min-height: 2.75rem;
		}
	}
</style>
