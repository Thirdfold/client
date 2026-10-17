<script lang="ts">
	import type { MonsterListing } from '$lib/adventure/adventure';
	import type { AdventurePreview } from '$lib/adventure/preview';
	import { play } from '$lib/audio/engine';
	import { searchBestiary } from '$lib/net/library';
	import { DND_PREGENS, pregenChoices } from '$lib/rules/dnd55e/pregens';
	import { FATE_PREGENS } from '$lib/rules/fate/core';
	import { Icon, Portrait, type IconName } from '$lib/ui/game';
	import {
		addPregen,
		DND_RULES,
		rulesChoiceOf,
		withRules,
		type Draft,
		type RulesChoice
	} from './draft';
	import Empty from './ui/Empty.svelte';
	import Panel from './ui/Panel.svelte';

	/**
	 * The rules an adventure plays by and what they bring (milestones 57 and
	 * 60): the fifth edition's or Fate Condensed's party, built by the rules
	 * from ready-made choices; under the fifth edition, whether players may
	 * bring their own, and monsters from the SRD's bestiary. The server builds
	 * and checks all of it; `preview` is what it made of the draft the last
	 * time the creator asked.
	 */
	interface Props {
		draft: Draft;
		preview: AdventurePreview | null;
		/** The server's answer is about the draft as it is now. */
		current: boolean;
		checking: boolean;
		onCheck(): void;
	}

	let { draft = $bindable(), preview, current, checking, onCheck }: Props = $props();

	const choice = $derived(rulesChoiceOf(draft));
	const dnd = $derived(choice === 'dnd');
	const party = $derived(Object.entries(draft.party ?? {}));

	type Choices = { name?: string; color?: string; class?: { id?: string }; highConcept?: string };
	const choicesOf = (id: string) => (draft.party![id].choices ?? {}) as Choices;
	const classOf = (id: string) =>
		choicesOf(id).highConcept ?? (choicesOf(id).class?.id ?? '').split(':').pop() ?? '';

	function switchRules(to: RulesChoice) {
		if (to === choice) return;
		if (party.length && !confirm('Switch rules? The party and monsters go.')) return;
		draft = withRules(draft, to);
		play([{ kind: 'ui', sound: 'select' }]);
	}

	/** The three sets of rules, each on its own plate. */
	const SETS: { id: RulesChoice; icon: IconName; name: string; blurb: string }[] = [
		{
			id: 'classic',
			icon: 'shield',
			name: 'thirdfold’s classic rules',
			blurb: '(the classic characters, four stats)'
		},
		{
			id: 'dnd',
			icon: 'd20',
			name: 'Fifth edition (SRD 5.2.1)',
			blurb: '(abilities and skills, saving throws, rests, gear, SRD monsters)'
		},
		{
			id: 'fate',
			icon: 'dice',
			name: 'Fate Condensed',
			blurb: '(skills on the ladder, Fate dice, stress and consequences, foes you write)'
		}
	];

	// Ready-made characters under the draft's rules.
	const pregens = $derived(
		choice === 'fate'
			? FATE_PREGENS.map((p) => ({ id: p.id, label: p.choices.name }))
			: DND_PREGENS.map((p) => ({ id: p.id, label: p.label }))
	);
	let pregen = $state(DND_PREGENS[0].id);
	$effect(() => {
		if (!pregens.some((p) => p.id === pregen)) pregen = pregens[0]?.id ?? '';
	});
	const pregenOf = (id: string) =>
		choice === 'fate'
			? (FATE_PREGENS.find((p) => p.id === id)?.choices ?? null)
			: pregenChoices(id);

	// Monsters: searched in the rules' bestiary on the server.
	let query = $state('');
	let results = $state<MonsterListing[]>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	/** What each kind added is, as the search found it. */
	let known = $state<Record<string, MonsterListing>>({});
	async function search(e: SubmitEvent) {
		e.preventDefault();
		searching = true;
		searchError = null;
		try {
			results = await searchBestiary(draft.rules ?? DND_RULES, query.trim());
			for (const m of results) known[m.kind] = m;
		} catch (err) {
			searchError = (err as Error).message;
		} finally {
			searching = false;
		}
	}
	function addMonster(kind: string) {
		const list = (draft.monsters ??= []);
		if (!list.includes(kind)) list.push(kind);
		play([{ kind: 'ui', sound: 'confirm' }]);
	}
	function removeMonster(kind: string) {
		draft.monsters = (draft.monsters ?? []).filter((k) => k !== kind);
		if (!draft.monsters.length) delete draft.monsters;
	}
	const monsterName = (kind: string) =>
		known[kind]?.name ?? preview?.monsters.find((m) => m.kind === kind)?.name ?? kind;
	const short = (hash: string) => hash.slice(0, 8);
</script>

<div class="rules">
	<Panel title="It plays by" icon="book">
		<fieldset class="sets">
			<legend class="visually-hidden">It plays by</legend>
			{#each SETS as set (set.id)}
				<label class="tile" class:on={choice === set.id}>
					<input
						type="radio"
						name="rules"
						checked={choice === set.id}
						onchange={() => switchRules(set.id)}
					/>
					<span class="crest" aria-hidden="true"><Icon name={set.icon} size="1.4em" /></span>
					<span class="words">
						<strong>{set.name}</strong>
						<span class="muted">{set.blurb}</span>
					</span>
				</label>
			{/each}
		</fieldset>
	</Panel>

	{#if choice === 'classic'}
		<Empty icon="users" title="The classic characters are picked in the Overview">
			Choose a fifth edition or Fate Condensed set above to have the rules build the party instead.
		</Empty>
	{:else}
		<Panel title="The party" icon="users">
			<p class="hint">
				Characters the rules build from these choices, checked by the server. Rename them, give them
				a colour and an introduction.
			</p>
			<div class="members g-stagger">
				{#each party as [id], n (id)}
					{@const c = choicesOf(id)}
					<div class="member well" style:--i={n}>
						<div class="row">
							<Portrait name={c.name || id} color={c.color ?? '#888888'} size={44} />
							<span class="who">
								<code>{id}</code>
								{#if classOf(id)}<span class="g-tag brass">{classOf(id)}</span>{/if}
							</span>
							<span class="spacer"></span>
							<button
								type="button"
								class="danger"
								onclick={() => {
									delete draft.party![id];
									if (!Object.keys(draft.party!).length) delete draft.party;
									play([{ kind: 'ui', sound: 'close' }]);
								}}><Icon name="trash" size="1em" />Remove</button
							>
						</div>
						<div class="row">
							<label class="field grow">
								<span>Name</span>
								<input
									value={c.name ?? ''}
									maxlength="40"
									onchange={(e) =>
										((draft.party![id].choices as Choices).name = e.currentTarget.value.trim())}
								/>
							</label>
							<label class="field">
								<span>Colour</span>
								<input
									type="color"
									value={c.color ?? '#888888'}
									onchange={(e) =>
										((draft.party![id].choices as Choices).color = e.currentTarget.value)}
								/>
							</label>
						</div>
						<label class="field">
							<span>Introduction</span>
							<textarea
								rows="2"
								maxlength="600"
								value={draft.party![id].intro ?? ''}
								onchange={(e) => {
									const v = e.currentTarget.value.trim();
									if (v) draft.party![id].intro = v;
									else delete draft.party![id].intro;
								}}></textarea>
						</label>
					</div>
				{/each}
			</div>
			{#if party.length === 0}
				<Empty icon="users" title="Nobody in the party yet">
					Pick a ready-made character below to seat the first one.
				</Empty>
			{/if}
			<div class="foot">
				<select aria-label="A ready-made character" bind:value={pregen}>
					{#each pregens as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
				</select>
				<button
					type="button"
					disabled={!pregenOf(pregen)}
					onclick={() => {
						addPregen(draft, pregenOf(pregen) as { name: string } | null);
						play([{ kind: 'ui', sound: 'confirm' }]);
					}}><Icon name="plus" size="1em" />Add to the party</button
				>
			</div>
			{#if dnd}
				<label class="check">
					<input
						type="checkbox"
						checked={!!draft.openParty}
						onchange={(e) => {
							if (e.currentTarget.checked) draft.openParty = true;
							else delete draft.openParty;
						}}
					/>
					Players may also build their own characters
				</label>
			{/if}
		</Panel>
	{/if}

	{#if dnd}
		<Panel title="Monsters" icon="skull">
			<p class="hint">
				From the SRD’s bestiary, played by the table as the rules read them. Fights name them by
				kind.
			</p>
			{#if draft.monsters?.length}
				<ul class="monsters g-stagger">
					{#each draft.monsters as kind, n (kind)}
						<li class="well" style:--i={n}>
							<Portrait name={monsterName(kind)} size={40} foe />
							<span class="words">
								<strong>{monsterName(kind)}</strong>
								<code>{kind}</code>
							</span>
							<button
								type="button"
								class="danger"
								onclick={() => {
									removeMonster(kind);
									play([{ kind: 'ui', sound: 'close' }]);
								}}><Icon name="trash" size="1em" />Remove</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<form class="row" onsubmit={search}>
				<input
					class="grow"
					aria-label="Search the bestiary"
					placeholder="Name, type or challenge: skeleton, undead, 1/4"
					maxlength="60"
					bind:value={query}
				/>
				<button type="submit" disabled={searching}
					><Icon name="search" size="1em" />{searching ? 'Searching…' : 'Search'}</button
				>
			</form>
			{#if searchError}
				<p class="problem" role="alert"><Icon name="warn" size="1.1em" />{searchError}</p>
			{/if}
			{#if results.length}
				<ul class="results g-stagger">
					{#each results as m, n (m.kind)}
						<li style:--i={n}>
							<div>
								<strong>{m.name}</strong>
								<span class="muted"
									>{m.type}, challenge {m.challenge}: AC {m.armorClass}, {m.hitPoints} HP</span
								>
							</div>
							<div class="muted small">{m.attacks.join(' · ')}</div>
							<button
								type="button"
								disabled={draft.monsters?.includes(m.kind)}
								onclick={() => addMonster(m.kind)}><Icon name="plus" size="1em" />Add</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</Panel>
	{/if}

	<Panel variant="parchment" title="What it comes to" icon="scroll">
		<div class="row">
			<button type="button" disabled={checking} onclick={onCheck}>
				<Icon name="search" size="1em" />{checking ? 'Asking…' : 'Check on the server'}
			</button>
			{#if preview && !current}<span class="muted">The draft has changed since.</span>{/if}
		</div>
		{#if preview}
			<dl>
				<dt>Rules</dt>
				<dd>{preview.rules.name} <span class="muted">v{preview.rules.version}</span></dd>
				{#each preview.content as c (c.id)}
					<dt>Content</dt>
					<dd>
						{c.name}
						<span class="muted"
							>{c.name.includes(c.version) ? '' : `${c.version} · `}build {short(c.build)}</span
						>
					</dd>
				{/each}
			</dl>
			{#if preview.party.length}
				<div class="scroll-x">
					<table>
						<thead><tr><th>Character</th><th>HP</th><th>Defence</th><th>Speed</th></tr></thead>
						<tbody>
							{#each preview.party as p (p.id)}
								<tr>
									<td>{p.name} <span class="muted">{p.title ?? ''}</span></td>
									<td>{p.hp}</td>
									<td>{p.defense.name} {p.defense.value}</td>
									<td>{p.speed}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if preview.openParty}<p class="hint">Players may build their own too.</p>{/if}
			{#each preview.monsters as m (m.kind)}
				<p class="monster">
					<strong>{m.name}</strong>
					<span class="muted">challenge {m.challenge}, AC {m.armorClass}, {m.hitPoints} HP</span><br
					/>
					<span class="small">{m.attacks.join(' · ')}</span>
					{#if m.notPlayed.length}<br /><span class="small muted"
							>Not played yet: {m.notPlayed.join(', ')}</span
						>{/if}
				</p>
			{/each}
			{#if preview.attribution}<p class="small muted">{preview.attribution}</p>{/if}
		{:else}
			<p class="hint">
				The server builds the party and finds the monsters; ask it to see the numbers the rules give
				them.
			</p>
		{/if}
	</Panel>
</div>

<style>
	.rules {
		display: grid;
		gap: var(--sp-6);
		min-width: 0;
	}

	/* ---- The sets of rules: one plate each, the chosen one lit ---- */

	.sets {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.tile {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: center;
		gap: var(--sp-5);
		min-height: 2.75rem;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		transition:
			box-shadow 160ms var(--ease-out),
			background 160ms var(--ease-out);
	}

	.tile:hover {
		background: rgba(0, 0, 0, 0.12);
	}

	.tile.on {
		background: var(--accent-wash);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			0 0 16px rgba(224, 164, 88, 0.18);
	}

	.tile:focus-within {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.crest {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: linear-gradient(180deg, #3b2c20, #1f1611);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 2px 0 var(--ink-line);
		color: var(--gilt-hi);
	}

	.tile.on .crest {
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			0 0 12px rgba(224, 164, 88, 0.4);
	}

	.words {
		display: grid;
		min-width: 0;
		font-size: var(--fs-sm);
		line-height: 1.3;
	}

	.words strong {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
	}

	/* ---- The party and the monsters ---- */

	.members,
	.monsters {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.member {
		min-width: 0;
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
		min-width: 0;
	}

	.spacer {
		flex: 1;
	}

	.foot select {
		flex: 1 1 14rem;
		min-width: 0;
		max-width: 100%;
	}

	.grow {
		flex: 1;
		min-width: 10rem;
	}

	.monsters li {
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
	}

	.results {
		display: grid;
		gap: var(--sp-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.results li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 var(--sp-4);
		padding: var(--sp-3) var(--sp-4);
		border-bottom: 1px solid var(--gilt-line);
	}

	.results li > :global(div:nth-child(2)) {
		grid-column: 1;
	}

	.results li button {
		grid-row: 1 / span 2;
		grid-column: 2;
		align-self: center;
	}

	.problem {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid #7a2e22;
		border-left: 5px solid #c0392b;
		border-radius: var(--radius-sm);
		background: rgba(138, 59, 59, 0.18);
		color: #ffd7cf;
	}

	.problem :global(.icon) {
		flex: none;
		color: #ff9d8c;
	}

	/* ---- What it comes to: the server's reading, on parchment ---- */

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-2) var(--sp-5);
		margin: 0;
	}

	dt {
		font-family: var(--font-label);
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	dd {
		margin: 0;
	}

	.scroll-x {
		overflow-x: auto;
	}

	table {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--fs-sm);
	}

	th,
	td {
		text-align: left;
		padding: var(--sp-2) var(--sp-3);
		border-bottom: 1px solid rgba(122, 91, 48, 0.4);
	}

	th {
		font-family: var(--font-label);
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--ink-accent);
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: var(--fs-xs);
	}

	.monster {
		margin: 0;
	}

	code {
		font-size: var(--fs-xs);
		overflow-wrap: anywhere;
	}

	@media (max-width: 40rem) {
		.tile {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.tile .words {
			grid-column: 1 / -1;
		}

		.results li {
			grid-template-columns: minmax(0, 1fr);
		}

		.results li button {
			grid-row: auto;
			grid-column: 1;
			justify-self: start;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tile {
			transition: none;
		}
	}
</style>
