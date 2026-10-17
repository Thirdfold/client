<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		EVIDENCE_KINDS,
		type AdventureView,
		type CharacterStatus,
		type ObjectState
	} from '$lib/adventure/adventure';
	import { STATUS_IDS, STATUSES, type StatusId } from '$lib/adventure/characters';
	import { NARRATION_MAX_LENGTH } from '$lib/game/chat';
	import type { AdventureListing, PublicPlayer } from '$lib/game/protocol';
	import { ADVENTURE_FILE_MAX_BYTES, CONTENT_PACK_MAX_BYTES } from '$lib/game/file-limits';
	import type {
		CampaignReply,
		RoomAction,
		SourcesReply,
		UpgradeReply
	} from '$lib/net/room-connection.svelte';
	import type { LibraryListing } from '$lib/game/library';
	import { listLibrary } from '$lib/net/library';
	import { describeRating } from '$lib/ui/rating';
	import { Icon, Meter, Portrait, type IconName } from '$lib/ui/game';
	import { withoutArticle } from './room/names';
	import Fold from './room/Fold.svelte';
	import PanelTitle from './room/PanelTitle.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		adventure: AdventureView | null;
		isGm: boolean;
		players: readonly PublicPlayer[];
		/** The adventures the server can run, for the GM to pick. */
		adventures?: readonly AdventureListing[];
		send(action: RoomAction): boolean;
		onError?(message: string): void;
		/** Opens a party member's character sheet. */
		onSheet?(characterId: string): void;
		/** The latest answer about the story's versions (the GM's). */
		upgrade?: UpgradeReply | null;
		/** The GM's campaigns, as the server last told them. */
		campaign?: CampaignReply | null;
		/** The licensed sources the GM may use, as the server last told them. */
		sources?: SourcesReply | null;
	}

	let {
		adventure,
		isGm,
		players,
		adventures = [],
		send,
		onError,
		onSheet,
		upgrade = null,
		campaign = null,
		sources = null
	}: Props = $props();

	let narration = $state('');
	/** The character the GM is adjusting. */
	let editing = $state<string | null>(null);

	function adjust(
		c: CharacterStatus,
		patch: { hp?: number; revive?: true; statuses?: StatusId[] }
	) {
		send({ type: 'adventure_override', characterId: c.id, patch });
	}

	function toggleStatus(c: CharacterStatus, id: StatusId) {
		const now = c.statuses.map((s) => s.id);
		adjust(c, { statuses: now.includes(id) ? now.filter((s) => s !== id) : [...now, id] });
	}

	const playerName = (id: string | null) =>
		(id && players.find((p) => p.id === id)?.name) ?? 'the GM';
	const party = $derived(adventure?.characters.filter((c) => c.inPlay) ?? []);
	const STAGE_LABEL: Record<AdventureView['stage'], string | null> = {
		choosing: 'Choosing characters',
		playing: null,
		complete: 'The end',
		defeat: 'The party has fallen'
	};
	/** What kind of find it is, as a glyph on its pinned note. */
	const KIND_ICON: Record<keyof typeof EVIDENCE_KINDS, IconName> = {
		document: 'scroll',
		object: 'cube',
		environment: 'eye',
		testimony: 'chat'
	};
	/** Story events as the GM reads them: well_clue → well clue. */
	const eventLabel = (id: string) => id.replace(/_/g, ' ');

	/** GM, before a story: the library's best rated, to start one from here. */
	let picks = $state<LibraryListing[] | null>(null);
	$effect(() => {
		if (!isGm || adventure) return;
		listLibrary({ sort: 'top' }).then(
			(found) => (picks = found.adventures.slice(0, 5)),
			() => (picks = [])
		);
	});

	function startFromLibrary(listing: LibraryListing) {
		const warning = `Start ${listing.title}? This replaces the map and everything on it.`;
		if (confirm(warning)) send({ type: 'adventure_start', libraryId: listing.id });
	}

	function start(listing: AdventureListing) {
		const warning = `Start ${listing.title}? This replaces the map and everything on it.`;
		if (confirm(warning)) send({ type: 'adventure_start', adventureId: listing.id });
	}

	/** Plays an adventure file (made in the builder, or shared by its creator); the server checks it. */
	async function playFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > ADVENTURE_FILE_MAX_BYTES) return onError?.('That file is too large.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return onError?.('That file is not an adventure (not JSON).');
		}
		if (confirm('Start this adventure? This replaces the map and everything on it.')) {
			send({ type: 'adventure_start', file: data });
		}
	}

	/** GM: brings a homebrew pack file to the story; the server checks every field of it. */
	async function addPack(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > CONTENT_PACK_MAX_BYTES) return onError?.('That homebrew file is too large.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return onError?.('That file is not a homebrew pack (not JSON).');
		}
		send({ type: 'adventure_pack', op: 'attach', pack: data });
	}

	const KIND_LABEL: Record<string, string> = {
		weapon: 'Weapons',
		armor: 'Armor',
		spell: 'Spells',
		monster: 'Monsters'
	};
	const byKind = (records: { kind: string; name: string }[]) =>
		[...new Set(records.map((r) => r.kind))].map((kind) => ({
			kind,
			label: KIND_LABEL[kind] ?? kind,
			names: records.filter((r) => r.kind === kind).map((r) => r.name)
		}));

	/** GM: the next adventure of the story's collection, at the version this story started with. */
	function playFromCollection(entry: number, title: string) {
		const set = adventure?.collection;
		if (!set) return;
		if (confirm(`Start ${title}? This replaces the map and the story on it.`))
			send({ type: 'adventure_start', collectionId: set.id, version: set.version, entry });
	}

	function control(op: 'restart' | 'end') {
		const warning =
			op === 'restart'
				? 'Start the story over from the beginning? The table and the story reset; everyone keeps their character.'
				: 'End the adventure? The table stays as it is, but the story stops.';
		if (confirm(warning)) send({ type: 'adventure_control', op });
	}

	function narrate(event: SubmitEvent) {
		event.preventDefault();
		const text = narration.trim();
		if (text && send({ type: 'adventure_narrate', text })) narration = '';
	}
</script>

{#if adventure}
	<section class="adventure" aria-label="Adventure">
		<!-- The journal: a page of parchment pinned over the table, hung with the chapter's banner. -->
		<article class="g-frame parchment vellum journal">
			<h2 class="g-banner ribbon">Chapter {adventure.chapter.number} of {adventure.chapter.of}</h2>
			<header>
				<p class="kicker">{adventure.title}</p>
				<h3 class="chapter">{STAGE_LABEL[adventure.stage] ?? adventure.chapter.title}</h3>
				<p class="where"><Icon name="map" size="1.1em" />{adventure.location.name}</p>
				{#if adventure.library}
					<p class="by">
						by <a href={resolve(`/library?creator=${adventure.library.creator.id}`)}
							>{adventure.library.creator.name}</a
						>
						· version {adventure.library.version}
					</p>
				{/if}
				{#if adventure.collection}
					{@const set = adventure.collection}
					<p class="by">
						<Icon name="book" size="1.1em" />
						<span>
							Part of <a href={resolve(`/library?collection=${set.id}`)}>{set.title}</a>
							by {set.creator.name} · adventure {set.adventures.findIndex((a) => a.playing) + 1} of {set
								.adventures.length}
						</span>
					</p>
				{/if}
				{#if adventure.campaign}
					<p class="by">
						<Icon name="flag" size="1.1em" />
						<span
							>For the campaign {adventure.campaign.name}{adventure.campaign.closed
								? ' · written into it'
								: ''}</span
						>
					</p>
				{/if}
				{#if adventure.rules.id !== 'thirdfold-classic'}
					<p class="by">
						<Icon name="scroll" size="1.1em" /><span>Rules: {adventure.rules.name}</span>
					</p>
					{#if adventure.rules.attribution}
						<p class="credit">{adventure.rules.attribution}</p>
					{/if}
				{/if}
			</header>

			<h4 class="rubric"><Icon name="flag" size="1.1em" />Objectives</h4>
			<ul class="objectives" aria-label="Objectives">
				{#each adventure.objectives as o, i (o.id)}
					<li class:done={o.done} class:optional={o.optional} style:--i={i}>
						<span class="box" aria-hidden="true">
							{#if o.done}<Icon name="check" size="1em" />{/if}
						</span>
						<span class="text"
							>{o.text}{#if o.optional}<small class="opt">(optional)</small>{/if}</span
						>
					</li>
				{/each}
			</ul>

			<h4 class="rubric">
				<Icon name="scroll" size="1.1em" />Evidence
				{#if adventure.clues.length}<span class="count num">{adventure.clues.length}</span>{/if}
			</h4>
			{#if adventure.clues.length}
				<ul class="notes">
					{#each adventure.clues as clue, i (clue.id)}
						<li class="note" class:secret={!clue.shared} style:--i={i}>
							<span class="pin" aria-hidden="true"></span>
							<div class="head">
								<span class="glyph"><Icon name={KIND_ICON[clue.kind]} size="1.2em" /></span>
								<strong>{clue.title}</strong>
								<span class="evidence-kind">{EVIDENCE_KINDS[clue.kind]}</span>
							</div>
							<p>{clue.text}</p>
							{#if !clue.shared}
								<p class="who-knows">
									<Icon name="lock" size="1em" />
									{clue.mine ? 'Only you know this.' : `Known only to ${clue.foundBy.join(', ')}.`}
								</p>
								{#if clue.mine || isGm}
									<button
										type="button"
										class="share"
										onclick={() => send({ type: 'adventure_share', clueId: clue.id })}
									>
										<Icon name="users" size="1em" /> Share with the party
									</button>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">Nothing found yet. Look closely at what is on the table.</p>
			{/if}

			{#if adventure.rewards.length}
				<h4 class="rubric"><Icon name="star" size="1.1em" />Rewards</h4>
				<ul class="rewards" aria-label="Rewards">
					{#each adventure.rewards as reward (reward)}
						<li><Icon name="star" size="1em" /><strong>{reward}</strong></li>
					{/each}
				</ul>
			{/if}

			{#if adventure.decisions.length}
				<h4 class="rubric"><Icon name="pencil" size="1.1em" />Choices made</h4>
				<ul class="choices">
					{#each adventure.decisions as d (d.id)}
						<li>
							<strong>{d.choice}</strong>
							<p>{d.prompt} ({d.by})</p>
						</li>
					{/each}
				</ul>
			{/if}
		</article>

		{#if party.length}
			<Tray title="Party" icon="users">
				<ul class="party" aria-label="Party">
					{#each party as c, i (c.id)}
						<li class:downed={c.downed || c.dead} style:--i={i}>
							<div class="member">
								<Portrait
									name={withoutArticle(c.def.name)}
									label={c.def.name}
									color={c.def.color}
									size={42}
									ratio={(c.health?.max ?? c.maxHp) > 0
										? (c.health?.value ?? c.hp) / (c.health?.max ?? c.maxHp)
										: 0}
									badge={c.dead ? 'skull' : null}
								/>
								<span class="who">
									{#if onSheet}
										<button
											type="button"
											class="name sheet-link ghost"
											title="Open {c.def.name}'s character sheet"
											onclick={() => onSheet(c.id)}>{c.def.name}</button
										>
									{:else}
										<span class="name">{c.def.name}</span>
									{/if}
									<small>
										{playerName(c.playerId)}{c.statuses.length
											? ` · ${c.statuses.map((s) => STATUSES[s.id].name).join(', ')}`
											: ''}
									</small>
									<span class="hp num" title={c.health?.name ?? 'Hit points'}>
										{#if c.dead}
											<Icon name="skull" size="1em" /> Dead
										{:else if c.downed}
											<Icon name="warn" size="1em" /> Down
										{:else}
											<Meter
												value={c.health?.value ?? c.hp}
												max={c.health?.max ?? c.maxHp}
												label={c.health?.name ?? 'Hit points'}
												showValue
											/>
										{/if}
									</span>
								</span>
								{#if isGm}
									<button
										type="button"
										class="edit"
										aria-expanded={editing === c.id}
										title="Adjust this character"
										aria-label="Adjust {c.def.name}"
										onclick={() => (editing = editing === c.id ? null : c.id)}
										><Icon name="gear" size="1.1em" /></button
									>
								{/if}
							</div>
							{#if isGm && editing === c.id}
								<div class="override" aria-label={`Adjust ${c.def.name}`}>
									<div class="row">
										{#each [-5, -1, 1, 5] as delta (delta)}
											<button
												type="button"
												disabled={c.dead}
												onclick={() =>
													adjust(c, { hp: Math.max(0, Math.min(c.maxHp, c.hp + delta)) })}
											>
												{delta > 0 ? `+${delta}` : delta}
											</button>
										{/each}
										<button
											type="button"
											disabled={c.dead}
											onclick={() => adjust(c, { hp: c.maxHp })}
										>
											Full
										</button>
									</div>
									<div class="row">
										{#each STATUS_IDS as id (id)}
											<button
												type="button"
												aria-pressed={c.statuses.some((s) => s.id === id)}
												title={STATUSES[id].about}
												onclick={() => toggleStatus(c, id)}
											>
												{STATUSES[id].name}
											</button>
										{/each}
										{#if c.dead}
											<button type="button" onclick={() => adjust(c, { revive: true })}
												>Revive</button
											>
										{/if}
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</Tray>
		{/if}

		{#if adventure.collection && (adventure.collection.adventures.length > 1 || adventure.collection.tables.length)}
			{@const set = adventure.collection}
			<Fold title="Collection: {set.title}" icon="book" aside={String(set.adventures.length)}>
				<ol class="shelf" aria-label="Its adventures">
					{#each set.adventures as a, i (i)}
						<li class:playing={a.playing}>
							<span class="entry num">{i + 1}</span>
							<strong>{a.title}</strong>
							{#if a.playing}<span class="g-tag brass">playing</span>{:else if isGm}
								<button type="button" onclick={() => playFromCollection(i, a.title)}>
									<Icon name="play" size="1.1em" />Play this one
								</button>
							{/if}
						</li>
					{/each}
				</ol>
				{#if set.tables.length}
					<p class="note-line">Tables that go with it:</p>
					<ul class="tables">
						{#each set.tables as t (t.code)}
							<li>
								<a
									class="plate-link"
									href={resolve(`/?table=${t.code}`)}
									target="_blank"
									rel="noopener"><Icon name="link" />{t.name}</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</Fold>
		{/if}

		{#if isGm}
			{#if adventure.stage === 'choosing' || adventure.encounter}
				<Tray title="The table" icon="flag">
					{#if adventure.stage === 'choosing'}
						<button
							class="primary begin"
							type="button"
							disabled={party.length === 0}
							onclick={() => send({ type: 'adventure_begin' })}
						>
							<Icon name="play" /> Begin the adventure
						</button>
						<p class="note-line">
							{party.length === 0
								? 'Waiting for players to choose their characters.'
								: `${party.length} of ${adventure.characters.length} characters chosen. Begin when everyone is ready.`}
						</p>
					{/if}
					{#if adventure.encounter}
						{@const up = adventure.encounter.order[adventure.encounter.current]}
						<button
							type="button"
							class="turn"
							onclick={() => send({ type: 'adventure_control', op: 'end_turn' })}
						>
							<Icon name="hourglass" /> End {up ? `${up.name}'s` : 'this'} turn
						</button>
					{/if}
				</Tray>
			{/if}

			<Tray title="Narrate" icon="pencil">
				<form class="narrate" onsubmit={narrate}>
					<label for="narration">Narrate to the table</label>
					<textarea
						id="narration"
						bind:value={narration}
						maxlength={NARRATION_MAX_LENGTH}
						rows="2"
						placeholder="Describe what they see, hear, feel…"></textarea>
					<button type="submit" disabled={!narration.trim()}>
						<Icon name="chat" /> Narrate
					</button>
				</form>
				{#if adventure.cues?.length}
					<Fold title="Read aloud" icon="bell" aside={String(adventure.cues.length)}>
						<ul class="cues">
							{#each adventure.cues as cue (cue.id)}
								<li>
									<button
										type="button"
										class:read={cue.read}
										title={cue.text}
										onclick={() => send({ type: 'adventure_cue', cueId: cue.id })}
									>
										<Icon name={cue.read ? 'check' : 'bell'} size="1.1em" />
										{cue.title}
									</button>
								</li>
							{/each}
						</ul>
					</Fold>
				{/if}
			</Tray>

			<!-- Loaded when shown: only the GM's panel has these. -->
			{#await import('$lib/ui/CampaignPanel.svelte') then { default: CampaignPanel }}
				<CampaignPanel {adventure} reply={campaign} {send} />
			{/await}
			{#if adventure.versions}
				{#await import('$lib/ui/StoryVersions.svelte') then { default: StoryVersions }}
					<StoryVersions versions={adventure.versions} reply={upgrade} {send} />
				{/await}
			{/if}

			{#if adventure.objects?.length}
				<Fold title="World objects" icon="door" aside={String(adventure.objects.length)}>
					<ul class="world">
						{#each adventure.objects as o (o.id)}
							<li>
								<label for={`object-${o.id}`}>
									{o.name}
									<small>{o.kind}</small>
								</label>
								<select
									id={`object-${o.id}`}
									value={o.state}
									class:hidden-state={o.state === 'hidden'}
									onchange={(e) =>
										send({
											type: 'adventure_object',
											objectId: o.id,
											state: e.currentTarget.value as ObjectState
										})}
								>
									{#each o.states as state (state)}
										<option value={state}>{state}</option>
									{/each}
								</select>
							</li>
						{/each}
					</ul>
				</Fold>
			{/if}

			{#if adventure.ledger}
				<Fold title="Story state" icon="compass">
					<dl class="ledger">
						<dt>Events</dt>
						<dd>
							{#if adventure.ledger.events.length}
								<span class="tags">
									{#each adventure.ledger.events as e, i (i)}<span class="g-tag"
											>{eventLabel(e)}</span
										>{/each}
								</span>
							{:else}
								<span class="none">none yet</span>
							{/if}
						</dd>
						<dt>People</dt>
						<dd>
							<ul class="people">
								{#each adventure.ledger.npcs as n (n.id)}
									<li>
										<Portrait name={n.name} size={34} />
										<span class="id">
											<span class="npc">{n.name} <em>{n.state}</em></span>
											<small>{n.home}</small>
										</span>
									</li>
								{/each}
							</ul>
						</dd>
						<dt>Fights</dt>
						<dd>
							{#if adventure.ledger.encounters.length}
								<span class="tags">
									{#each adventure.ledger.encounters as e (e.id)}<span class="g-tag"
											>{e.id}: {e.state}</span
										>{/each}
								</span>
							{:else}
								<span class="none">none yet</span>
							{/if}
						</dd>
						<dt>Defeated</dt>
						<dd>
							{#if adventure.ledger.defeated.length}
								<span class="tags">
									{#each adventure.ledger.defeated as d, i (i)}<span class="g-tag ember">{d}</span
										>{/each}
								</span>
							{:else}
								<span class="none">none</span>
							{/if}
						</dd>
					</dl>
				</Fold>
			{/if}
		{/if}

		{#if adventure.packs && (adventure.packs.length || isGm)}
			<Fold
				title="Homebrew{adventure.packs.some((p) => p.source === 'licensed')
					? ' and licensed'
					: ''}"
				icon="cube"
				aside={String(adventure.packs.length)}
				open={adventure.packs.length > 0 && isGm}
			>
				{#if adventure.packs.length}
					<ul class="packs" aria-label="Homebrew">
						{#each adventure.packs as pack (pack.id)}
							<li class="pack">
								<div class="head">
									<strong>{pack.name}</strong>
									<span class="g-tag">{pack.version}</span>
									<span class="g-tag" class:brass={!!pack.licensed}
										>{pack.licensed ? `Licensed · ${pack.licensed.publisher}` : 'Homebrew'}</span
									>
								</div>
								{#if pack.creator || pack.license}
									<p class="credit">
										{pack.creator ? `by ${pack.creator}` : ''}{pack.creator && pack.license
											? ' · '
											: ''}{pack.license ?? ''}
									</p>
								{/if}
								{#if pack.about}<p class="about">{pack.about}</p>{/if}
								{#if pack.licensed}
									<p class="credit">{pack.licensed.attribution}</p>
									{#if pack.licensed.terms.display === 'mechanics'}
										<p class="credit">Mechanics only: its licence keeps its text back.</p>
									{/if}
								{/if}
								{#each byKind(pack.records) as group (group.kind)}
									<p class="pack-records"><em>{group.label}:</em> {group.names.join(', ')}</p>
								{/each}
								{#if isGm}
									<button
										type="button"
										class="put-away"
										onclick={() => send({ type: 'adventure_pack', op: 'detach', id: pack.id })}
									>
										<Icon name="trash" size="1.1em" />Put away
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="note-line">
						Homebrew adds your own weapons, armor, spells and monsters to the rules’ own, for this
						story only.
					</p>
				{/if}
				{#if isGm && adventure.stage !== 'complete' && adventure.stage !== 'defeat'}
					<label class="plate-link file-offer">
						<Icon name="upload" />Add homebrew from a file…
						<input type="file" accept=".json,application/json" hidden onchange={addPack} />
					</label>
					<!-- Loaded when shown: only the GM's panel has it. -->
					{#await import('$lib/ui/LicensedSources.svelte') then { default: LicensedSources }}
						<LicensedSources
							reply={sources}
							attached={adventure.packs.flatMap((p) => (p.licensed ? [p.licensed.source] : []))}
							{send}
						/>
					{/await}
				{/if}
			</Fold>
		{/if}

		{#if isGm}
			<div class="row story-ends">
				<button type="button" onclick={() => control('restart')}>
					<Icon name="refresh" /> Start story over
				</button>
				<button type="button" class="danger" onclick={() => control('end')}>
					<Icon name="close" /> End adventure
				</button>
			</div>
		{/if}
	</section>
{:else if isGm}
	<section class="adventure" aria-label="Adventure">
		<PanelTitle icon="book">Adventure</PanelTitle>
		<ol class="gm-steps" aria-label="How a game goes">
			<li>Start a story. The table fills in for everyone.</li>
			<li>Send the invite link from the top bar. Each player picks a character.</li>
			<li>Run it from the Direct panel: pause, skip ahead, start fights, bring on foes.</li>
		</ol>
		{#if adventures[0]}
			{@const featured = adventures[0]}
			<div class="g-frame parchment offer featured">
				<p class="kicker">Tonight’s story</p>
				<strong class="story">{featured.title}</strong>
				{#if featured.about}<p class="about">{featured.about}</p>{/if}
				<button class="primary" type="button" onclick={() => start(featured)}>
					<Icon name="play" /> Start {featured.title}
				</button>
			</div>
		{/if}
		<Fold title="More adventures" icon="book">
			{#each adventures.slice(1) as listing (listing.id)}
				<div class="offer">
					<strong class="story">{listing.title}</strong>
					{#if listing.about}<p class="about">{listing.about}</p>{/if}
					<button type="button" onclick={() => start(listing)}>
						<Icon name="play" /> Start {listing.title}
					</button>
				</div>
			{/each}
			<h3 class="from-library">From the library</h3>
			{#if picks === null}
				<p class="empty">Looking through the library…</p>
			{:else if picks.length === 0}
				<p class="empty">The library has nothing to offer yet.</p>
			{:else}
				{#each picks as listing (listing.id)}
					<div class="offer">
						<strong class="story">{listing.title}</strong>
						<p class="about">by {listing.creator.name} · {describeRating(listing.rating)}</p>
						<button type="button" onclick={() => startFromLibrary(listing)}>
							<Icon name="play" /> Start {listing.title}
						</button>
					</div>
				{/each}
			{/if}
			<a class="plate-link" href={resolve('/library')}><Icon name="book" />Browse the library</a>
			<label class="plate-link file-offer">
				<Icon name="upload" />Play an adventure file…
				<input type="file" accept=".json,application/json" hidden onchange={playFile} />
			</label>
			<a class="plate-link" href={resolve('/builder')}
				><Icon name="pencil" />Build your own adventure</a
			>
		</Fold>
		{#await import('$lib/ui/CampaignPanel.svelte') then { default: CampaignPanel }}
			<CampaignPanel adventure={null} reply={campaign} {send} />
		{/await}
	</section>
{/if}

<style>
	.adventure {
		display: grid;
		gap: var(--sp-5);
	}

	h3,
	h4 {
		margin: 0;
	}

	/* ---- The journal page ---------------------------------------------------------------- */

	.journal {
		display: grid;
		gap: var(--sp-4);
		margin-top: 1.2rem;
		padding: 2rem var(--sp-6) var(--sp-6);
		border-radius: var(--radius-lg);
		animation: none;
	}

	.ribbon {
		position: absolute;
		top: -1.1rem;
		left: 50%;
		translate: -50% 0;
		z-index: 1;
		min-width: 0;
		padding: 0.3rem 2rem 0.35rem;
		font-size: var(--fs-md);
		white-space: nowrap;
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
	}

	header {
		display: grid;
		justify-items: center;
		gap: var(--sp-2);
		text-align: center;
	}

	.kicker {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.1em;
		color: var(--ink-muted);
	}

	.chapter {
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.1;
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
		text-wrap: balance;
	}

	.where,
	.by {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--ink-muted);
	}

	.by a {
		color: var(--ink-accent);
	}

	.rubric {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin-top: var(--sp-3);
		padding-bottom: var(--sp-2);
		border-bottom: 1px solid rgba(94, 74, 53, 0.45);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ink-accent);
	}

	.count {
		margin-left: auto;
		padding: 0 var(--sp-4);
		border-radius: var(--radius-sm);
		background: var(--ink-accent);
		font-size: var(--fs-xs);
		color: #ffe9dc;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}

	/* A checklist: an inked box that takes a tick when the goal is met. */
	.objectives li {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: var(--sp-4);
		font-family: var(--font-display);
		font-size: var(--fs-md);
		line-height: 1.3;
		color: var(--ink);
		animation: g-rise 420ms var(--ease-out) calc(var(--i) * 70ms) backwards;
	}

	.box {
		display: grid;
		place-items: center;
		width: 1.3rem;
		height: 1.3rem;
		margin-top: 0.1rem;
		border: 2px solid var(--ink-muted);
		border-radius: 4px;
		background: rgba(255, 250, 235, 0.55);
		box-shadow: inset 0 1px 3px rgba(90, 60, 30, 0.3);
		color: #fff;
	}

	.done .box {
		border-color: #3c7a3c;
		background: #3c7a3c;
		animation: g-pop 360ms var(--spring) backwards;
	}

	.objectives .done {
		color: var(--ink-muted);
	}

	.objectives .done .text {
		text-decoration: line-through;
		text-decoration-color: rgba(94, 74, 53, 0.7);
	}

	.optional:not(.done) .box {
		border-style: dashed;
	}

	.optional:not(.done) {
		color: var(--ink-muted);
	}

	.opt {
		margin-left: 0.4em;
		font-family: var(--font-ui);
		font-size: var(--fs-xs);
		font-style: italic;
	}

	/* Evidence: notes pinned to the page, a glyph for what kind of find it is. */
	.notes {
		gap: var(--sp-5);
		padding-top: var(--sp-2);
	}

	.note {
		position: relative;
		padding: var(--sp-5) var(--sp-5) var(--sp-4);
		border: 1px solid rgba(109, 79, 40, 0.5);
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, #f8eed6, #efe0bd);
		box-shadow:
			0 1px 0 rgba(255, 250, 235, 0.8),
			0 3px 6px rgba(60, 40, 20, 0.25);
		rotate: -0.4deg;
		animation: g-pop 420ms var(--spring) calc(var(--i) * 80ms) backwards;
	}

	.note:nth-child(even) {
		rotate: 0.5deg;
	}

	.note.secret {
		border-color: rgba(138, 59, 59, 0.55);
		background: linear-gradient(180deg, #f6e4cf, #ecd2b0);
	}

	.pin {
		position: absolute;
		top: -6px;
		left: 50%;
		width: 12px;
		height: 12px;
		margin-left: -6px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #d8776a 0, #8a3b3b 55%, #5c2323 100%);
		box-shadow: 0 2px 3px rgba(40, 10, 0, 0.5);
	}

	.note .head {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		font-family: var(--font-display);
		font-size: var(--fs-md);
		color: var(--ink);
	}

	.glyph {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		background: rgba(138, 59, 59, 0.14);
		color: var(--ink-accent);
	}

	.evidence-kind {
		margin-left: auto;
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.08em;
		color: var(--ink-muted);
	}

	.note p,
	.choices p {
		margin: var(--sp-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--ink-muted);
	}

	.note > p:first-of-type {
		color: var(--ink);
		line-height: 1.35;
	}

	.note .who-knows {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		color: var(--ink-accent);
		font-size: var(--fs-xs);
	}

	.share {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		margin-top: var(--sp-3);
		padding: var(--sp-2) var(--sp-5);
		min-height: 2.2rem;
		font-size: var(--fs-sm);
	}

	.empty {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--fs-sm);
		color: var(--ink-muted);
	}

	.rewards {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	.rewards li {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-2) var(--sp-5);
		border: 1px solid var(--gilt-dark);
		border-radius: var(--radius-sm);
		background: var(--gilt-grad);
		box-shadow: inset 0 0 0 1px rgba(255, 244, 214, 0.5);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		color: var(--accent-text);
	}

	.choices strong {
		font-family: var(--font-display);
		color: var(--ink);
	}

	/* ---- Party ------------------------------------------------------------------------- */

	.party {
		gap: var(--sp-5);
	}

	.party > li {
		animation: g-rise 420ms var(--ease-out) calc(var(--i) * 70ms) backwards;
	}

	.party .member {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		font-size: var(--fs-sm);
	}

	.sheet-link {
		justify-self: start;
		min-height: 0;
		padding: 0;
		border: 0;
		background: none;
		box-shadow: none;
		color: inherit;
		text-align: left;
		text-decoration: underline dotted var(--gilt-line-strong);
		text-underline-offset: 4px;
		cursor: pointer;
	}

	.sheet-link:hover {
		color: var(--gilt-hi);
	}

	.sheet-link:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.party .downed .member > :global(.portrait),
	.party .downed .who .name {
		filter: grayscale(0.7);
		opacity: 0.8;
	}

	.who {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: var(--sp-1);
	}

	.who .name {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.who small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.hp {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
		min-height: 1.2rem;
	}

	.hp :global(.wrap) {
		flex: 1;
	}

	.hp :global(.g-meter) {
		height: 0.6rem;
	}

	.edit {
		flex: none;
		min-height: 2.2rem;
		width: 2.2rem;
		padding: 0;
	}

	.override {
		display: grid;
		gap: var(--sp-3);
		margin: var(--sp-4) 0 var(--sp-2);
		padding: var(--sp-4);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
	}

	.override .row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	.override button {
		min-height: 2rem;
		padding: var(--sp-2) var(--sp-4);
		font-size: var(--fs-sm);
	}

	/* ---- The GM's own trays -------------------------------------------------------------- */

	.begin {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-4);
		min-height: 3rem;
		font-size: var(--fs-lg);
	}

	.turn,
	.narrate button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-4);
	}

	.note-line {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.narrate {
		display: grid;
		gap: var(--sp-3);
	}

	.narrate label {
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	textarea {
		resize: vertical;
		font-family: var(--font-display);
	}

	.world {
		gap: var(--sp-4);
	}

	.world li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		font-size: var(--fs-sm);
	}

	.world label {
		display: grid;
		min-width: 0;
	}

	.world small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.world select {
		width: 8.5rem;
		padding: var(--sp-2) var(--sp-3);
		font-size: var(--fs-xs);
	}

	.world .hidden-state {
		color: var(--muted);
		font-style: italic;
	}

	.cues button {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		padding: var(--sp-3) var(--sp-5);
		text-align: left;
		font-size: var(--fs-sm);
	}

	.cues button.read {
		color: var(--muted);
	}

	.ledger {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-4) var(--sp-5);
		margin: 0;
		font-size: var(--fs-xs);
	}

	.ledger dt {
		padding-top: 0.15rem;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.05em;
		color: var(--gilt);
	}

	.ledger dd {
		margin: 0;
		min-width: 0;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}

	.none {
		color: var(--muted);
	}

	.people {
		gap: var(--sp-4);
	}

	.people li {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
	}

	.people .id {
		display: grid;
		min-width: 0;
	}

	.people em {
		margin-left: var(--sp-2);
		color: var(--gilt-hi);
		font-style: normal;
		font-family: var(--font-label);
		letter-spacing: 0.04em;
	}

	.people small {
		color: var(--muted);
	}

	.story-ends {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}

	.story-ends button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
		padding-inline: var(--sp-3);
		font-size: var(--fs-md);
	}

	/* ---- Collection and homebrew -------------------------------------------------------- */

	.shelf,
	.packs,
	.tables {
		gap: var(--sp-3);
	}

	.shelf {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
	}

	.shelf li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-4);
		padding: var(--sp-3) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
	}

	.shelf li.playing {
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px var(--gilt);
	}

	.shelf strong {
		flex: 1;
		min-width: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.03em;
	}

	.entry {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #e5ac5f, #a8722f);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--accent-text);
	}

	.shelf button,
	.put-away {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.pack {
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
		font-size: var(--fs-sm);
	}

	.pack p {
		margin: 0;
	}

	.pack .head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
	}

	.pack .head strong {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
	}

	.pack .about {
		color: var(--muted);
	}

	.pack-records {
		font-size: var(--fs-xs);
	}

	.pack-records em {
		font-family: var(--font-label);
		font-style: normal;
		color: var(--gilt);
	}

	.credit {
		margin: var(--sp-1) 0 0;
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	.journal .credit {
		margin: 0;
		color: var(--ink-muted);
	}

	/* ---- Before a story: the shelf -------------------------------------------------------- */

	.gm-steps {
		counter-reset: step;
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.gm-steps li {
		counter-increment: step;
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: var(--sp-5);
	}

	.gm-steps li::before {
		content: counter(step);
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #e5ac5f, #a8722f);
		box-shadow:
			inset 0 0 0 2px rgba(255, 244, 214, 0.35),
			0 2px 3px rgba(0, 0, 0, 0.5);
		font-family: var(--font-label);
		font-weight: 700;
		color: var(--accent-text);
	}

	.offer {
		display: grid;
		gap: var(--sp-3);
	}

	.featured {
		gap: var(--sp-4);
		padding: var(--sp-6);
		border-radius: var(--radius-lg);
		animation: none;
	}

	.featured .kicker {
		text-align: center;
	}

	.story {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.15;
	}

	.featured .story {
		font-size: var(--fs-xl);
		text-align: center;
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.7);
	}

	.about {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.featured .about {
		font-family: var(--font-display);
		font-size: var(--fs-md);
		line-height: 1.4;
		color: var(--ink);
	}

	.offer button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-4);
	}

	.from-library {
		margin-top: var(--sp-3);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.06em;
		color: var(--gilt);
	}

	.plate-link {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2.5rem;
		padding: var(--sp-3) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 3px 0 var(--ink-line);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.035em;
		color: var(--text);
		text-decoration: none;
		cursor: pointer;
	}

	.plate-link:hover {
		background: var(--wood-grad-hover);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 3px 0 var(--ink-line),
			0 0 18px rgba(224, 164, 88, 0.2);
	}

	.plate-link:focus-within,
	.plate-link:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	@media (max-width: 48rem) {
		.edit,
		.override button,
		.share {
			min-height: 2.75rem;
		}

		.edit {
			width: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.objectives li,
		.done .box,
		.note,
		.party > li {
			animation: none;
		}
	}
</style>
