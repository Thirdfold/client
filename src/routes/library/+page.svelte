<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { ClientMessage } from '$lib/game/protocol';
	import {
		CREATOR_ID_PATTERN,
		LIBRARY_ID_PATTERN,
		LIBRARY_LIMITS,
		LIBRARY_SORTS,
		type BuiltInStory,
		type Creator,
		type LibraryListing,
		type LibrarySort,
		type StoryDetail
	} from '$lib/game/library';
	import { RoomConnection, handOff, type ConnectionError } from '$lib/net/room-connection.svelte';
	import { checkCollection, listLibrary, openStory } from '$lib/net/library';
	import type { CollectionReport as Report } from '$lib/game/collection';
	import { play } from '$lib/audio/engine';
	import CollectionReport from '$lib/ui/CollectionReport.svelte';
	import { loadGmKey, loadName, saveName } from '$lib/prefs';
	import { describeFacts, describePlays } from '$lib/ui/rating';
	import { inSentence, lastPlayed } from '$lib/ui/when';
	import { prefetchRenderer } from '$lib/tabletop/load';
	import { Backdrop, Banner, Frame, Icon, type IconName } from '$lib/ui/game';
	import LibraryBook from '$lib/ui/LibraryBook.svelte';
	import NameDialog from '$lib/ui/NameDialog.svelte';
	import LibraryStory from '$lib/ui/LibraryStory.svelte';
	import Stars from '$lib/ui/Stars.svelte';
	import EmptyShelf from '$lib/ui/library/EmptyShelf.svelte';
	import { flagFor, loadLastRun, saveLastRun } from '$lib/ui/library/flags';
	import Glyph from '$lib/ui/library/Glyph.svelte';
	import { roving } from '$lib/ui/library/roving';
	import Shelf from '$lib/ui/library/Shelf.svelte';
	import SkeletonBook from '$lib/ui/library/SkeletonBook.svelte';

	// Where the reader is, all in the URL so it can be shared or refreshed:
	// `?creator=` a creator's shelf, `?story=` a published adventure opened,
	// `?built=` one that comes with thirdfold, `?q=` a search, `?sort=` an order.
	const params = $derived(page.url.searchParams);
	const creatorId = $derived.by(() => {
		const id = params.get('creator');
		return id && CREATOR_ID_PATTERN.test(id) ? id : null;
	});
	const storyId = $derived.by(() => {
		const id = params.get('story');
		return id && LIBRARY_ID_PATTERN.test(id) ? id : null;
	});
	const builtId = $derived(params.get('built'));
	const collectionId = $derived.by(() => {
		const id = params.get('collection');
		return id && LIBRARY_ID_PATTERN.test(id) ? id : null;
	});

	let query = $state(page.url.searchParams.get('q') ?? '');
	let sort = $state<LibrarySort>(
		LIBRARY_SORTS.find((s) => s === page.url.searchParams.get('sort')) ?? 'top'
	);

	let adventures = $state<LibraryListing[] | null>(null);
	let builtIn = $state<BuiltInStory[]>([]);
	let creator = $state<Creator | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let attempt = $state(0);

	let collections = $state<LibraryListing[]>([]);
	let report = $state<Report | null>(null);
	let reportMissing = $state(false);
	let detail = $state<StoryDetail | null>(null);
	let detailMissing = $state(false);
	/** Listed, but shared only with those its creator chooses (and not with this browser's GM key). */
	let locked = $state(false);

	/** The name this browser plays under; asked for the first time someone runs an adventure. */
	let name = $state(loadName());
	let starting = $state<string | null>(null);
	let runError = $state<string | null>(null);
	let pending = $state<Runnable | null>(null);
	let nameDialog = $state<ReturnType<typeof NameDialog> | null>(null);

	type Runnable = { kind: 'library' | 'built' | 'collection'; id: string; title: string };

	/** Keeps the URL in step with the search and order (replacing, not stacking, history). */
	function setParams(next: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(next)) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		if (url.search !== page.url.search) {
			void goto(url.search ? resolve(`/library?${url.search.slice(1)}`) : resolve('/library'), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}
	}

	// Look again a moment after the search stops changing.
	$effect(() => {
		const q = { query, sort, creator: creatorId ?? undefined };
		void attempt;
		loading = true;
		const timer = setTimeout(() => {
			setParams({ q: query.trim() || null, sort: sort === 'top' ? null : sort });
			listLibrary({ ...q, kind: 'collection' }).then(
				(found) => (collections = found.adventures),
				() => (collections = [])
			);
			listLibrary(q).then(
				(found) => {
					adventures = found.adventures;
					creator = found.creator;
					builtIn = found.builtIn ?? [];
					loadError = null;
					loading = false;
				},
				(err: Error) => {
					loadError = err.message;
					loading = false;
				}
			);
		}, 250);
		return () => clearTimeout(timer);
	});

	// An opened adventure: its opening and facts come from the server.
	$effect(() => {
		const id = storyId;
		detail = null;
		detailMissing = false;
		locked = false;
		if (!id) return;
		openStory(id, loadGmKey()).then(
			(found) => {
				detail = found.story;
				detailMissing = found.story === null;
				locked = found.locked;
			},
			(err: Error) => (loadError = err.message)
		);
	});

	// An opened collection: everything it names, as the server found it.
	$effect(() => {
		const id = collectionId;
		report = null;
		reportMissing = false;
		locked = false;
		if (!id) return;
		void attempt;
		checkCollection(id, undefined, loadGmKey()).then(
			(found) => {
				report = found.report;
				reportMissing = found.report === null;
				locked = found.locked;
			},
			(err: Error) => (loadError = err.message)
		);
	});

	const shownBuiltIn = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (creatorId) return [];
		if (!q) return builtIn;
		return builtIn.filter((s) =>
			q.split(/\s+/).every((w) => `${s.title} ${s.about}`.toLowerCase().includes(w))
		);
	});
	const openedBuilt = $derived(builtIn.find((s) => s.id === builtId) ?? null);
	const opened = $derived(storyId !== null || builtId !== null);

	const title = $derived.by(() => {
		if (report) return report.title;
		if (collectionId) return 'A collection';
		if (detail) return detail.listing.title;
		if (openedBuilt) return openedBuilt.title;
		if (creatorId) return creator ? `${creator.name}’s adventures` : 'A creator';
		return 'Adventure library';
	});

	/** Which shelf of the case is open. */
	type ShelfId = 'built' | 'community' | 'collections';
	let shelf = $state<ShelfId>('built');
	const loadingFirst = $derived(adventures === null && !loadError);
	const builtCount = $derived(shownBuiltIn.length);
	const communityCount = $derived(adventures ? adventures.length : null);
	/** The tabs on the case's top edge; a creator's page has no built-in shelf. */
	const tabs = $derived.by(() => {
		const out: { id: ShelfId; label: string; icon: IconName; count: number | null }[] = [];
		if (!creatorId) {
			out.push({
				id: 'built',
				label: 'Made with thirdfold',
				icon: 'book',
				count: loadingFirst ? null : builtCount
			});
		}
		out.push({
			id: 'community',
			label: creatorId ? 'Published' : 'From the community',
			icon: creatorId ? 'user' : 'users',
			count: communityCount
		});
		if (collections.length) {
			out.push({
				id: 'collections',
				label: 'Collections',
				icon: 'scroll',
				count: collections.length
			});
		}
		return out;
	});
	const active = $derived<ShelfId>(tabs.some((t) => t.id === shelf) ? shelf : tabs[0].id);
	/** What this browser ran last: that book wears a "your pick" flag. */
	let lastRun = $state(loadLastRun());

	const ORDERS: { value: LibrarySort; label: string; icon: IconName }[] = [
		{ value: 'top', label: 'Best rated', icon: 'star' },
		{ value: 'played', label: 'Most played', icon: 'd20' },
		{ value: 'new', label: 'Newest', icon: 'sparkle' }
	];

	const resultsNote = $derived.by(() => {
		if (loadError) return '';
		if (loadingFirst) return 'Searching the library…';
		if (loading) return '';
		const n =
			active === 'built'
				? builtCount
				: active === 'collections'
					? collections.length
					: (communityCount ?? 0);
		if (n === 0) return query.trim() ? 'No adventures match that search.' : '';
		const what =
			active === 'collections' ? ['collection', 'collections'] : ['adventure', 'adventures'];
		return `${n} ${n === 1 ? what[0] : what[1]}${query.trim() ? ' match' : ''}.`;
	});

	function pickShelf(next: ShelfId) {
		if (active === next) return;
		shelf = next;
		play([{ kind: 'ui', sound: 'select' }]);
	}

	function pickOrder(next: LibrarySort) {
		if (sort === next) return;
		sort = next;
		play([{ kind: 'ui', sound: 'select' }]);
	}

	/** Back, the way a game's menu does it: out of a book to the shelves, out of the shelves to the title. */
	function goBack() {
		const inside = opened || collectionId !== null;
		play([{ kind: 'ui', sound: inside ? 'close' : 'back' }]);
		void goto(inside || creatorId ? resolve('/library') : resolve('/'));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || starting) return;
		if (document.querySelector('dialog[open]')) return;
		// A field keeps Escape for itself (a search clears its words).
		if ((event.target as HTMLElement | null)?.closest('input, select, textarea')) return;
		event.preventDefault();
		goBack();
	}

	// An error that arrives is heard as well as seen.
	$effect(() => {
		if (loadError || runError) play([{ kind: 'ui', sound: 'error' }]);
	});

	/** Runs it straight away if we know the GM's name; asks for it first if not. */
	function run(r: Runnable) {
		runError = null;
		if (name.trim()) return void start(r);
		pending = r;
		nameDialog?.open('');
	}

	function changeName() {
		pending = null;
		nameDialog?.open(name);
	}

	/** A name given in the dialog: remembered, then the adventure it was asked for runs. */
	function named(given: string) {
		name = given;
		saveName(given);
		const r = pending;
		pending = null;
		if (r) void start(r);
	}

	/** Opens a new table as its GM with this adventure set up on it. */
	async function start(r: Runnable) {
		if (starting) return;
		starting = r.id;
		const gmKey = loadGmKey();
		const conn = new RoomConnection({
			type: 'create',
			name: name.trim(),
			...(gmKey ? { gmKey } : {})
		});
		try {
			await conn.ready();
			const begin: ClientMessage =
				r.kind === 'library'
					? { type: 'adventure_start', libraryId: r.id }
					: r.kind === 'collection'
						? { type: 'adventure_start', collectionId: r.id }
						: { type: 'adventure_start', adventureId: r.id };
			conn.send(begin);
			handOff(conn);
			saveLastRun(r.id);
			lastRun = r.id;
			await goto(resolve('/room/[id]', { id: conn.room!.id }));
		} catch (err) {
			conn.close();
			const e = err as ConnectionError;
			if (e.code !== 'closed') runError = e.message;
		} finally {
			starting = null;
		}
	}

	$effect(() => prefetchRenderer());
</script>

<svelte:head>
	<title>{title} · thirdfold</title>
</svelte:head>

<svelte:window {onkeydown} />

{#snippet runButton(r: Runnable, primary: boolean)}
	<button
		type="button"
		class:primary
		class:g-glint={primary}
		class="run"
		disabled={starting !== null}
		onclick={() => run(r)}
	>
		<Icon name="play" />{starting === r.id ? 'Opening…' : 'Run it'}<span class="visually-hidden"
			>: {r.title}</span
		>
	</button>
{/snippet}

{#snippet lockedNote(kind: 'adventure' | 'collection')}
	<Frame variant="parchment" class="note-card g-pop">
		<h1><Icon name="lock" size="1.1em" /> Shared with chosen GMs</h1>
		<p>
			Its creator shares this {kind} only with those they choose. To run it, ask them to share it with
			you: they’ll need your creator id, which you’ll find under “Your homebrew and collections” in the
			<a href={resolve('/library')}>library</a>.
		</p>
	</Frame>
{/snippet}

{#snippet restrictedMark(a: LibraryListing)}
	{#if a.access === 'restricted'}<span
			class="g-tag restricted"
			title="Its creator shares it with chosen GMs"
			><Icon name="lock" size="0.95em" />Shared with chosen GMs</span
		>{/if}
{/snippet}

<Backdrop variant="hall" />

<main>
	<header class="bar">
		<button type="button" class="back" aria-keyshortcuts="Escape" onclick={goBack}>
			<Icon name="back" />Back<span class="visually-hidden"
				>{opened || collectionId
					? ' to the library'
					: creatorId
						? ' to the whole library'
						: ' to the title'}</span
			>
			<kbd aria-hidden="true">Esc</kbd>
		</button>
		{#if !opened && name.trim()}
			<p class="as">
				<Icon name="user" />
				<span>Running as <strong>{name.trim()}</strong></span>
				<button type="button" class="ghost link" onclick={changeName}>Change</button>
			</p>
		{/if}
	</header>

	{#if collectionId}
		<!-- One collection, opened: what it holds and whether it can be run. -->
		{#if report}
			<Frame
				variant="parchment"
				as="article"
				class="ledger collection g-rise"
				aria-labelledby="collection-title"
			>
				<p class="kicker"><Icon name="scroll" /> Collection</p>
				<h1 id="collection-title">{report.title}</h1>
				<p class="byline">
					A collection by <a href={resolve(`/library?creator=${report.creator.id}`)}
						>{report.creator.name}</a
					>
					· version {report.version} · plays by {report.rules.name ?? report.rules.id}
				</p>
				{#if report.about}<p class="about">{report.about}</p>{/if}
				<hr class="g-rule" />
				<CollectionReport {report} />
				<div class="collection-run">
					{#if report.ok}
						{@render runButton({ kind: 'collection', id: report.id, title: report.title }, true)}
						<p class="small">
							You’ll open a table as its GM with its first adventure and its homebrew.
						</p>
					{:else}
						<p class="small">Its creator can fix what’s missing and publish it again.</p>
					{/if}
				</div>
			</Frame>
		{:else if reportMissing && locked}
			{@render lockedNote('collection')}
		{:else if reportMissing}
			<Frame variant="parchment" class="note-card g-pop">
				<h1>Collection not found</h1>
				<p>
					It may have been taken out of the library. <a href={resolve('/library')}
						>Browse the library</a
					>
				</p>
			</Frame>
		{:else}
			<Frame variant="parchment" class="note-card g-pop" role="status">
				<p class="opening-now"><Icon name="scroll" /> Looking through the collection…</p>
				<span class="lines" aria-hidden="true"><i></i><i></i><i></i></span>
			</Frame>
		{/if}
	{:else if opened}
		<!-- One adventure, opened. -->
		{#if detail || openedBuilt}
			{@const story = detail
				? {
						kind: 'library' as const,
						id: detail.listing.id,
						title: detail.listing.title,
						about: detail.listing.about,
						opening: detail.opening,
						facts: detail.facts
					}
				: {
						kind: 'built' as const,
						id: openedBuilt!.id,
						title: openedBuilt!.title,
						about: openedBuilt!.about,
						opening: openedBuilt!.opening,
						facts: openedBuilt!.facts
					}}
			<LibraryStory
				id={story.id}
				title={story.title}
				about={story.about}
				opening={story.opening}
				facts={story.facts}
				listing={detail?.listing ?? null}
				flag={flagFor(story.id, detail?.listing.publishedAt ?? null, lastRun)}
			>
				{#snippet actions()}
					{@render runButton({ kind: story.kind, id: story.id, title: story.title }, true)}
					{#if name.trim()}
						<p class="muted small">
							You’ll open a table as its GM, as {name.trim()}.
							<button type="button" class="ghost link" onclick={changeName}>Change</button>
						</p>
					{/if}
				{/snippet}
			</LibraryStory>
		{:else if detailMissing && locked}
			{@render lockedNote('adventure')}
		{:else if detailMissing || (builtId !== null && !loading)}
			<Frame variant="parchment" class="note-card g-pop">
				<h1>Adventure not found</h1>
				<p>
					It may have been taken out of the library. <a href={resolve('/library')}
						>Browse the library</a
					>
				</p>
			</Frame>
		{:else}
			<Frame variant="parchment" class="note-card g-pop" role="status">
				<p class="opening-now"><Icon name="scroll" /> Opening the adventure…</p>
				<span class="lines" aria-hidden="true"><i></i><i></i><i></i></span>
			</Frame>
		{/if}
	{:else}
		<section class="lobby" aria-labelledby="library-title">
			<div class="masthead">
				<Banner level={1} class="mast"><span id="library-title">{title}</span></Banner>
				{#if creatorId}
					<p class="tagline">
						{creator
							? `Everything ${creator.name} has published to the library.`
							: 'There’s no creator by that link.'}
					</p>
				{:else}
					<p class="tagline">
						Stories to run at your table, as its GM. Pick one and your friends join by link.
						<a class="plaque" href={resolve('/builder')}
							><Icon name="pencil" />Build and publish your own</a
						>
					</p>
				{/if}
			</div>

			<Frame class="sign g-rise" role="search" aria-label="Find a story">
				<label class="find">
					<Glyph name="search" />
					<span class="visually-hidden">Search</span>
					<input
						bind:value={query}
						maxlength={LIBRARY_LIMITS.query}
						type="search"
						placeholder="Title, story or creator"
					/>
					{#if query}
						<button
							type="button"
							class="ghost clear"
							aria-label="Clear the search"
							onclick={() => (query = '')}><Icon name="close" /></button
						>
					{/if}
				</label>
				<div class="order">
					<span class="legend" id="order-legend">Order</span>
					<div
						class="seg"
						role="radiogroup"
						aria-labelledby="order-legend"
						use:roving={'[role=radio]'}
					>
						{#each ORDERS as o (o.value)}
							<button
								type="button"
								role="radio"
								aria-checked={sort === o.value}
								tabindex={sort === o.value ? 0 : -1}
								onclick={() => pickOrder(o.value)}><Icon name={o.icon} />{o.label}</button
							>
						{/each}
					</div>
				</div>
			</Frame>

			<div class="cabinet">
				{#if loadError}
					<!-- The server could not be asked. -->
					<div role="alert">
						<EmptyShelf trouble>
							<p class="lead">The shelves are out of reach</p>
							<p class="muted">The library couldn’t be reached: {loadError}</p>
							{#snippet ghost()}
								<button type="button" onclick={() => attempt++}
									><Icon name="refresh" />Try again</button
								>
							{/snippet}
						</EmptyShelf>
					</div>
				{:else}
					{#if tabs.length === 1}
						<h2 class="plate"><Icon name={tabs[0].icon} />{tabs[0].label}</h2>
					{:else}
						<div class="tabs" role="tablist" aria-label="Shelves" use:roving={'[role=tab]'}>
							{#each tabs as t (t.id)}
								<button
									type="button"
									role="tab"
									class="tab"
									id="tab-{t.id}"
									aria-selected={active === t.id}
									aria-controls="shelf-panel"
									tabindex={active === t.id ? 0 : -1}
									onclick={() => pickShelf(t.id)}
								>
									<Icon name={t.icon} /><span class="label">{t.label}</span>
									<span class="count">{t.count ?? ''}</span>
								</button>
							{/each}
						</div>
					{/if}

					<div
						id="shelf-panel"
						class="panel"
						role={tabs.length === 1 ? undefined : 'tabpanel'}
						aria-labelledby={tabs.length === 1 ? undefined : `tab-${active}`}
					>
						<p class="muted note" role="status">
							{#if active === 'built' && !loadingFirst && !creatorId}<span
									>Complete stories, ready on every new table.</span
								>{/if}
							{#if active === 'collections'}<span
									>Campaigns: adventures, homebrew and tables that go together.</span
								>{/if}
							<span>{resultsNote}</span>
						</p>

						{#if loadingFirst}
							<Shelf items={[0, 1, 2, 3]} label="Loading" decorative>
								{#snippet book(n)}<SkeletonBook index={n} />{/snippet}
							</Shelf>
						{:else if active === 'built'}
							{#if shownBuiltIn.length}
								<Shelf items={shownBuiltIn} label="Made with thirdfold" stale={loading}>
									{#snippet book(s)}
										<LibraryBook
											id={s.id}
											title={s.title}
											opens={`built=${s.id}`}
											flag={flagFor(s.id, null, lastRun)}
										>
											<p>{describeFacts(s.facts)}</p>
											{#snippet action()}
												{@render runButton({ kind: 'built', id: s.id, title: s.title }, false)}
											{/snippet}
										</LibraryBook>
									{/snippet}
								</Shelf>
							{:else}
								<EmptyShelf>
									<p class="lead">No story that comes with thirdfold matches</p>
									<p class="muted">Try another word, or look on the community shelf.</p>
									{#snippet ghost()}
										{#if communityCount}
											<button type="button" onclick={() => pickShelf('community')}
												><Icon name="users" />{communityCount} on the community shelf</button
											>
										{/if}
									{/snippet}
								</EmptyShelf>
							{/if}
						{:else if active === 'collections'}
							<Shelf items={collections} label="Collections" stale={loading}>
								{#snippet book(c)}
									<LibraryBook id={c.id} title={c.title} opens={`collection=${c.id}`}>
										<p>
											{#if !creatorId}
												by <a class="creator" href={resolve(`/library?creator=${c.creator.id}`)}
													>{c.creator.name}</a
												> ·
											{/if}
											updated {inSentence(lastPlayed(c.publishedAt))}
										</p>
										{#if c.about}<p class="about">{c.about}</p>{/if}
										<p>{describePlays(c.plays)}</p>
										{@render restrictedMark(c)}
										{#snippet action()}
											<a
												class="plaque run look"
												href={resolve(`/library?collection=${c.id}`)}
												onclick={() => play([{ kind: 'ui', sound: 'open' }])}
												><Icon name="eye" />Look inside<span class="visually-hidden"
													>: {c.title}</span
												></a
											>
										{/snippet}
									</LibraryBook>
								{/snippet}
							</Shelf>
						{:else if adventures && adventures.length === 0}
							<EmptyShelf>
								{#if query.trim()}
									<p class="lead">Nothing matches that search</p>
									<p class="muted">Try a word from the story, or a creator’s name.</p>
								{:else if creatorId}
									<p class="lead">The shelf is empty</p>
									<p class="muted">
										{creator?.name ?? 'This creator'} hasn’t published anything to the library yet.
									</p>
								{:else}
									<p class="lead">The shelf is empty</p>
									<p class="muted">
										Nothing has been published here yet. <a href={resolve('/builder')}
											>Build an adventure</a
										> and publish it: it will be the first.
									</p>
								{/if}
								{#snippet ghost()}
									{#if !query.trim() && !creatorId}
										<a class="plaque" href={resolve('/builder')}
											><Icon name="pencil" />Build an adventure</a
										>
									{/if}
									{#if query.trim() && !creatorId && builtCount}
										<button type="button" onclick={() => pickShelf('built')}
											><Icon name="book" />{builtCount} made with thirdfold</button
										>
									{/if}
								{/snippet}
							</EmptyShelf>
						{:else if adventures}
							<Shelf items={adventures} label="From the community" stale={loading}>
								{#snippet book(a)}
									<LibraryBook
										id={a.id}
										title={a.title}
										opens={`story=${a.id}`}
										flag={flagFor(a.id, a.publishedAt, lastRun)}
									>
										<p>
											{#if !creatorId}
												by <a class="creator" href={resolve(`/library?creator=${a.creator.id}`)}
													>{a.creator.name}</a
												> ·
											{/if}
											updated {inSentence(lastPlayed(a.publishedAt))}
											{#if a.version > 1}· version {a.version}{/if}
										</p>
										{#if a.about}<p class="about">{a.about}</p>{/if}
										<p><Stars rating={a.rating} /></p>
										<p>{describePlays(a.plays)}</p>
										{@render restrictedMark(a)}
										{#snippet action()}
											{@render runButton({ kind: 'library', id: a.id, title: a.title }, false)}
										{/snippet}
									</LibraryBook>
								{/snippet}
							</Shelf>
						{/if}
					</div>
				{/if}
			</div>

			{#if !creatorId}
				<!-- Loaded when shown: most visitors run stories and never publish. -->
				{#await import('$lib/ui/LibraryWorkshop.svelte') then { default: LibraryWorkshop }}
					<LibraryWorkshop
						{builtIn}
						onRun={(item) =>
							run({
								kind: item.kind === 'collection' ? 'collection' : 'library',
								id: item.id,
								title: item.title
							})}
						onPublished={(id) => {
							attempt++;
							void goto(resolve(`/library?collection=${id}`));
						}}
					/>
				{/await}
			{/if}
		</section>
	{/if}

	{#if runError}
		<p class="run-error g-pop" role="alert"><Icon name="warn" />{runError}</p>
	{/if}
	<p class="visually-hidden" role="status">{starting ? 'Opening a table…' : ''}</p>
	<footer class="foot">
		<a class="plaque" href={resolve('/credits')}><Icon name="scroll" />Credits and licences</a>
	</footer>
</main>

<NameDialog
	bind:this={nameDialog}
	running={pending?.title ?? null}
	onSave={named}
	onCancel={() => (pending = null)}
/>

<style>
	/* The hall is a place: the backdrop is fixed behind, everything here stands in front of it. */
	main {
		position: relative;
		z-index: 1;
		max-width: 76rem;
		min-height: 100dvh;
		margin: 0 auto;
		padding: var(--sp-6) clamp(var(--sp-6), 4vw, var(--sp-8)) calc(var(--sp-8) * 1.5);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5);
		margin-bottom: var(--sp-6);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		min-height: 2.75rem;
		padding-inline: 1rem 0.8rem;
	}

	.back kbd {
		margin-left: 0.2rem;
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.05em;
	}

	/* "Running as": a small name plate. */
	.as {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		margin: 0;
		padding: 0.1rem 0.2rem 0.1rem 0.8rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--panel-raised);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.as strong {
		color: var(--text);
		font-weight: 700;
	}

	.link {
		min-height: 2.2rem;
		padding: var(--sp-2) var(--sp-4);
		color: var(--accent);
		font-size: inherit;
	}

	/* ---- The lobby: banner, the shelf sign, the case ---- */
	.masthead {
		display: grid;
		justify-items: center;
		gap: var(--sp-5);
		margin-bottom: var(--sp-7);
		text-align: center;
	}

	.masthead :global(.mast) {
		min-width: min(100%, 20rem);
		max-width: 100%;
		padding-inline: 3.4rem;
		font-size: clamp(1.5rem, 4vw, 2.2rem);
		text-wrap: balance;
	}

	.tagline {
		max-width: 44rem;
		margin: 0;
		font-size: var(--fs-lg);
		font-family: var(--font-display);
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
	}

	.plaque {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		min-height: 2.2rem;
		margin-left: var(--sp-3);
		padding: 0 var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--panel-raised);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 2px 0 var(--ink-line);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-decoration: none;
		color: var(--gilt-hi);
		white-space: nowrap;
		transition:
			box-shadow 140ms var(--ease-out),
			background 140ms var(--ease-out);
	}

	.plaque:hover {
		background: var(--wood-grad-hover);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 2px 0 var(--ink-line),
			0 0 18px rgba(224, 164, 88, 0.25);
	}

	.plaque:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
		box-shadow: var(--ring);
	}

	/* The sign hung over the shelves: a groove to search in, and the three orders as plates. */
	.lobby :global(.sign) {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--sp-5) var(--sp-7);
		margin: 0 auto var(--sp-7);
		padding: var(--sp-5) var(--sp-7) var(--sp-6);
		max-width: 56rem;
		border-radius: var(--radius-lg);
	}

	.find {
		position: relative;
		display: block;
		flex: 1 1 16rem;
		min-width: 0;
		color: var(--muted);
	}

	.find :global(.glyph) {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		translate: 0 -50%;
		color: var(--gilt);
		pointer-events: none;
	}

	.find input {
		width: 100%;
		min-height: 2.9rem;
		padding: 0.55rem 2.9rem 0.55rem 2.6rem;
		color: var(--text);
		font-size: var(--fs-md);
	}

	/* The browser's own clear control would sit beside ours. */
	.find input::-webkit-search-cancel-button {
		display: none;
	}

	.clear {
		position: absolute;
		right: 0.3rem;
		top: 50%;
		translate: 0 -50%;
		min-height: 2.2rem;
		padding: 0 var(--sp-4);
	}

	.order {
		display: grid;
		justify-items: start;
		gap: var(--sp-3);
	}

	.legend {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--gilt);
	}

	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}

	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		min-height: 2.9rem;
		padding-inline: 0.95rem;
	}

	/* ---- The case: tabs on its top edge, shelves inside ---- */
	.cabinet {
		position: relative;
		max-width: 68rem;
		margin: 0 auto;
	}

	.tabs {
		display: flex;
		gap: var(--sp-3);
		padding-left: 1.4rem;
		margin-bottom: -1px;
		position: relative;
		z-index: 2;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		min-height: 2.9rem;
		padding: 0.5rem 1.2rem 0.65rem;
		border-radius: 12px 12px 0 0;
		background: linear-gradient(180deg, #241a13, #1b140f);
		color: var(--muted);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 -2px 0 var(--ink-line);
	}

	.tab:not(:disabled):hover {
		transform: none;
		color: var(--text);
		background: linear-gradient(180deg, #2f2319, #231a13);
	}

	.tab[aria-selected='true'] {
		transform: none;
		border-color: var(--ink-line);
		background: var(--wood-grad);
		color: var(--gilt-hi);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 1px 0 1px rgba(255, 236, 200, 0.2),
			0 -6px 18px rgba(224, 164, 88, 0.22);
	}

	.tab .count {
		min-width: 1.1em;
		font-variant-numeric: lining-nums;
		color: var(--gilt);
	}

	.plate {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		margin: 0 0 -1px 1.4rem;
		padding: 0.5rem 1.2rem 0.65rem;
		border-radius: 12px 12px 0 0;
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			0 -6px 18px rgba(224, 164, 88, 0.2);
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
		position: relative;
		z-index: 2;
	}

	.note {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0 var(--sp-5);
		min-height: 1.45em;
		margin: 0 0 var(--sp-5);
		padding-inline: var(--sp-3);
		font-size: var(--fs-sm);
		text-align: center;
	}

	.panel {
		position: relative;
	}

	/* ---- Not found, opening ---- */
	:global(.note-card) {
		--muted: var(--ink-muted);
		--accent: var(--ink-accent);
		display: grid;
		gap: var(--sp-5);
		justify-items: center;
		max-width: 34rem;
		margin: var(--sp-8) auto;
		padding: var(--sp-8) var(--sp-7);
		text-align: center;
		color: var(--ink);
	}

	:global(.note-card) h1 {
		margin: 0;
		color: var(--ink);
		text-shadow: none;
	}

	:global(.note-card) p {
		margin: 0;
	}

	:global(.note-card) a {
		color: var(--ink-accent);
	}

	.opening-now {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
	}

	.lines {
		display: grid;
		gap: 0.6rem;
		width: 100%;
	}

	.lines i {
		display: block;
		height: 0.8rem;
		border-radius: 3px;
		background: rgba(94, 74, 53, 0.16);
	}

	.lines i:nth-child(2) {
		width: 80%;
	}

	.lines i:nth-child(3) {
		width: 55%;
	}

	.run-error {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		max-width: 40rem;
		margin: var(--sp-7) auto 0;
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid rgba(226, 122, 107, 0.55);
		border-radius: var(--radius-md);
		background: rgba(54, 24, 18, 0.9);
		color: #ffd7cf;
	}

	.foot {
		display: flex;
		justify-content: center;
		margin-top: calc(var(--sp-8) * 1.5);
		font-size: var(--fs-sm);
	}

	.foot .plaque {
		margin: 0;
	}

	/* ---- A collection, opened: parchment ledger with what it holds and the key to run it ---- */
	:global(.collection) {
		--muted: var(--ink-muted);
		--accent: var(--ink-accent);
		--text: var(--ink);
		--border: var(--vellum-edge);
		display: grid;
		gap: var(--sp-5);
		max-width: 50rem;
		margin: 0 auto;
		padding: clamp(1.6rem, 4vw, 2.6rem) clamp(1.5rem, 4vw, 2.8rem);
		color: var(--ink);
	}

	:global(.collection) p {
		margin: 0;
	}

	:global(.collection) a {
		color: var(--ink-accent);
		text-decoration-color: rgba(138, 59, 59, 0.5);
	}

	:global(.collection) .kicker {
		display: flex;
		align-items: center;
		gap: 0.45em;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--ink-accent);
	}

	:global(.collection) h1 {
		margin: 0;
		font-size: clamp(1.9rem, 4.4vw, 2.7rem);
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 250, 235, 0.6);
	}

	:global(.collection) .byline {
		font-size: var(--fs-md);
		color: var(--ink-muted);
	}

	:global(.collection) .about {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.4;
	}

	:global(.collection) hr.g-rule {
		margin: var(--sp-3) 0 0;
		opacity: 0.85;
	}

	.collection-run {
		display: grid;
		gap: var(--sp-4);
		justify-items: center;
		margin-top: var(--sp-4);
		text-align: center;
	}

	.collection-run :global(.run) {
		min-width: min(100%, 18rem);
		min-height: 3.6rem;
		padding: 0.6rem 2.6rem;
		font-size: 1.55rem;
		letter-spacing: 0.06em;
		justify-content: center;
		gap: 0.5em;
	}

	.collection-run .small {
		color: var(--ink-muted);
	}

	/* A collection's key on the shelf: a plaque, the same size as a book's "Run it". */
	.plaque.look {
		margin-left: 0;
		min-height: 2.5rem;
		padding-inline: 0.9rem;
	}

	.restricted {
		justify-self: start;
	}

	.small {
		font-size: var(--fs-sm);
	}

	@media (max-width: 48rem) {
		main {
			padding-top: var(--sp-5);
		}

		.back kbd {
			display: none;
		}

		.lobby :global(.sign) {
			padding: var(--sp-6) var(--sp-6);
			gap: var(--sp-5);
		}

		.seg button {
			flex: 1 1 auto;
			justify-content: center;
		}

		.tabs {
			padding-left: 0.6rem;
		}

		.tab {
			flex: 1 1 0;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0 0.4em;
			min-width: 0;
			min-height: 2.75rem;
			padding-inline: 0.4rem;
			font-size: 0.9rem;
			line-height: 1.05;
		}

		.plaque {
			margin-left: 0;
			margin-top: var(--sp-3);
		}

		.link {
			min-height: 2.75rem;
		}

		/* Thumb-sized targets. */
		.clear {
			min-height: 2.75rem;
		}

		:global(.creator) {
			display: inline-block;
			padding-block: var(--sp-2);
		}
	}
</style>
