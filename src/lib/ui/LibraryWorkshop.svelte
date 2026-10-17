<script lang="ts">
	import { CONTENT_PACK_MAX_BYTES } from '$lib/game/file-limits';
	import {
		COLLECTION_FORMAT,
		COLLECTION_FORMAT_VERSION,
		COLLECTION_LIMITS,
		type AdventureRef,
		type TableRef
	} from '$lib/game/collection';
	import {
		LIBRARY_LIMITS,
		normalizeCreatorName,
		type BuiltInStory,
		type LibraryKind,
		type LibraryListing,
		type MyAdventure,
		type SharedListing
	} from '$lib/game/library';
	import { libraryHome, manageAdventure, publishAdventure } from '$lib/net/library';
	import { diagnosticsOf } from '$lib/net/ask';
	import Diagnostics from '$lib/ui/Diagnostics.svelte';
	import type { Diagnostic } from '$lib/validation/diagnostics';
	import LibraryAccess from '$lib/ui/LibraryAccess.svelte';
	import { loadCreatorName, loadGmKey, saveCreatorName } from '$lib/prefs';
	import { sharedCode } from '$lib/ui/share';
	import { play } from '$lib/audio/engine';
	import { Banner, Frame, Icon, type IconName } from '$lib/ui/game';

	/**
	 * A creator's corner of the library: publish homebrew packs, gather
	 * adventures, homebrew and tables into a collection, and look after what
	 * they published. Everything is checked by the server; this only gathers.
	 */
	interface Props {
		/** The adventures that come with thirdfold, to put in a collection. */
		builtIn: readonly BuiltInStory[];
		/** A collection was published: the page shows it. */
		onPublished?(id: string): void;
		/** Run something shared with this creator at a new table. */
		onRun?(item: LibraryListing): void;
	}

	let { builtIn, onPublished, onRun }: Props = $props();

	let gmKey = $state(loadGmKey());
	let creator = $state(loadCreatorName());
	let mine = $state<MyAdventure[]>([]);
	/** What other creators shared with this one, and the id they share to. */
	let shared = $state<SharedListing[]>([]);
	let creatorId = $state<string | null>(null);
	/** The item whose sharing is open. */
	let sharing = $state<string | null>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);
	/** What the server found in content it refused to publish. */
	let found = $state<Diagnostic[]>([]);

	// The collection being gathered.
	let title = $state('');
	let about = $state('');
	/** Chosen adventures in the order chosen: built-in ids and library ids. */
	let chosen = $state<string[]>([]);
	let packs = $state<string[]>([]);
	let tables = $state<TableRef[]>([]);
	let tableName = $state('');
	let tableCode = $state('');

	// Their own, and what they collaborate on (theirs to put in a collection too).
	const collaborating = $derived(shared.filter((s) => s.role === 'collaborator'));
	const ownAdventures = $derived([
		...mine.filter((m) => m.kind === 'adventure'),
		...collaborating.filter((m) => m.kind === 'adventure')
	]);
	const ownPacks = $derived([
		...mine.filter((m) => m.kind === 'pack'),
		...collaborating.filter((m) => m.kind === 'pack')
	]);
	const ownCollections = $derived(mine.filter((m) => m.kind === 'collection'));
	const KIND_WORD: Record<LibraryKind, string> = {
		adventure: 'adventure',
		pack: 'homebrew',
		collection: 'collection'
	};
	const KIND_ICON: Record<LibraryKind, IconName> = {
		adventure: 'book',
		pack: 'wand',
		collection: 'scroll'
	};

	/** The file input behind the homebrew plate: the plate is the focusable thing. */
	let packInput = $state<HTMLInputElement | null>(null);

	// What arrives is heard as well as seen.
	$effect(() => {
		if (error) play([{ kind: 'ui', sound: 'error' }]);
	});
	$effect(() => {
		if (message) play([{ kind: 'ui', sound: 'notice' }]);
	});

	function toggleSharing(id: string) {
		play([{ kind: 'ui', sound: sharing === id ? 'close' : 'open' }]);
		sharing = sharing === id ? null : id;
	}

	function home(h: { mine: MyAdventure[]; shared?: SharedListing[]; creatorId?: string }) {
		mine = h.mine;
		if (h.shared) shared = h.shared;
		if (h.creatorId) creatorId = h.creatorId;
	}

	$effect(() => {
		const key = gmKey;
		if (!key) return void ((mine = []), (shared = []), (creatorId = null));
		libraryHome(key).then(home, (err: Error) => (error = err.message));
	});

	async function copyId() {
		if (!creatorId) return;
		try {
			await navigator.clipboard.writeText(creatorId);
			message = 'Copied your creator id.';
		} catch {
			message = `Your creator id: ${creatorId}`;
		}
	}

	function name(): string | null {
		const n = normalizeCreatorName(creator);
		if (!n) error = 'Enter the name to publish under.';
		else saveCreatorName(n);
		return n;
	}

	function toggle(list: string[], id: string, max: number): string[] {
		return list.includes(id)
			? list.filter((x) => x !== id)
			: list.length < max
				? [...list, id]
				: list;
	}

	async function publish(kind: LibraryKind, file: unknown, done: (version: number) => string) {
		const n = name();
		if (!n) return null;
		busy = true;
		error = message = null;
		found = [];
		try {
			const out = await publishAdventure({ gmKey, creator: n, file, kind });
			gmKey = out.gmKey;
			message = done(out.version);
			home(await libraryHome(out.gmKey));
			return out.adventureId;
		} catch (err) {
			error = (err as Error).message;
			found = diagnosticsOf(err);
			return null;
		} finally {
			busy = false;
		}
	}

	async function publishPack(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > CONTENT_PACK_MAX_BYTES)
			return void (error = 'That homebrew file is too large.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return void (error = 'That file is not a homebrew pack (not JSON).');
		}
		await publish('pack', data, (v) =>
			v === 1 ? 'Published your homebrew.' : `Published version ${v} of your homebrew.`
		);
	}

	function addTable() {
		const code = sharedCode(tableCode);
		const label = tableName.trim();
		if (!code)
			return void (error =
				'Paste a shared table’s link or code (Share table, in the Scene panel).');
		if (!label) return void (error = 'Give the table a name.');
		if (tables.some((t) => t.code === code)) return void (error = 'That table is already in it.');
		tables = [...tables, { code, name: label.slice(0, COLLECTION_LIMITS.tableName) }];
		tableName = tableCode = '';
		error = null;
	}

	/** A chosen adventure as the collection names it, at its latest version. */
	function refOf(id: string): AdventureRef {
		const own = ownAdventures.find((a) => a.id === id);
		return own ? { library: own.id, version: own.version } : { builtIn: id };
	}
	const titleOf = (id: string) =>
		ownAdventures.find((a) => a.id === id)?.title ?? builtIn.find((b) => b.id === id)?.title ?? id;

	async function publishCollection() {
		if (!title.trim()) return void (error = 'Give the collection a title.');
		if (!chosen.length) return void (error = 'Choose at least one adventure.');
		const id = await publish(
			'collection',
			{
				format: COLLECTION_FORMAT,
				formatVersion: COLLECTION_FORMAT_VERSION,
				title: title.trim(),
				about: about.trim(),
				adventures: chosen.map(refOf),
				packs: packs.map((p) => ({
					library: p,
					version: ownPacks.find((x) => x.id === p)!.version
				})),
				tables
			},
			() => `Published “${title.trim()}”. GMs can find it among the collections.`
		);
		if (id) {
			title = about = '';
			chosen = packs = [];
			tables = [];
			onPublished?.(id);
		}
	}

	async function remove(item: MyAdventure) {
		if (!gmKey) return;
		if (!confirm(`Remove “${item.title}” and all its versions from the library?`)) return;
		error = message = null;
		try {
			mine = await manageAdventure(gmKey, item.id, 'remove');
		} catch (err) {
			error = (err as Error).message;
		}
	}

	const ACCESS_WORD = {
		public: 'in the library',
		restricted: 'restricted: only those you share it with',
		private: 'private: not in the library'
	} as const;
</script>

<Frame as="section" class="workshop g-rise" aria-labelledby="workshop-title">
	<div class="shelf-head">
		<Banner level={2}><span id="workshop-title">Your homebrew and collections</span></Banner>
		<p class="intro">
			Publish a homebrew pack, then gather adventures, homebrew and shared tables into a collection
			for a whole campaign. Every piece is checked before anyone can run it.
		</p>
	</div>

	<label class="field">
		<span class="cap"><Icon name="pencil" size="1.05em" />Publish as</span>
		<input bind:value={creator} maxlength={LIBRARY_LIMITS.creatorName} placeholder="Your name" />
	</label>

	<div class="columns">
		<Frame variant="iron" class="part">
			<h3><Icon name="wand" />Homebrew</h3>
			<p class="muted small">
				A homebrew pack file (see the format in docs/HOMEBREW.md): weapons, armor, spells and
				monsters for the fifth edition rules.
			</p>
			<button
				type="button"
				class="file-offer"
				class:disabled={busy}
				disabled={busy}
				onclick={() => packInput?.click()}
			>
				<Icon name="upload" />
				Publish homebrew from a file…
			</button>
			<input
				bind:this={packInput}
				type="file"
				accept=".json,application/json"
				hidden
				disabled={busy}
				onchange={publishPack}
			/>
		</Frame>

		<Frame variant="iron" class="part">
			<form
				class="collection-form"
				onsubmit={(e) => {
					e.preventDefault();
					void publishCollection();
				}}
			>
				<h3><Icon name="scroll" />New collection</h3>
				<label class="field">
					<span class="cap">Title</span>
					<input bind:value={title} maxlength={COLLECTION_LIMITS.title} />
				</label>
				<label class="field">
					<span class="cap">About</span>
					<textarea bind:value={about} maxlength={COLLECTION_LIMITS.about} rows="2"></textarea>
				</label>
				<fieldset>
					<legend>Adventures, in the order they are played ({chosen.length})</legend>
					{#each [...builtIn.map( (b) => ({ id: b.id, title: b.title, note: 'comes with thirdfold' }) ), ...ownAdventures.map( (a) => ({ id: a.id, title: a.title, note: 'role' in a ? `${a.creator.name}’s, version ${a.version}` : `yours, version ${a.version}` }) )] as a (a.id)}
						<label class="option" class:on={chosen.includes(a.id)}>
							<input
								type="checkbox"
								checked={chosen.includes(a.id)}
								onchange={() => {
									play([{ kind: 'ui', sound: 'select' }]);
									chosen = toggle(chosen, a.id, COLLECTION_LIMITS.adventures);
								}}
							/>
							{#if chosen.includes(a.id)}<span class="order">{chosen.indexOf(a.id) + 1}</span>{/if}
							<span class="what">{a.title} <span class="muted small">{a.note}</span></span>
						</label>
					{/each}
					{#if chosen.length}
						<p class="muted small">It starts with {titleOf(chosen[0])}, whose rules it plays by.</p>
					{/if}
				</fieldset>
				<fieldset>
					<legend>Homebrew ({packs.length})</legend>
					{#each ownPacks as p (p.id)}
						<label class="option" class:on={packs.includes(p.id)}>
							<input
								type="checkbox"
								checked={packs.includes(p.id)}
								onchange={() => {
									play([{ kind: 'ui', sound: 'select' }]);
									packs = toggle(packs, p.id, COLLECTION_LIMITS.packs);
								}}
							/>
							<span class="what"
								>{p.title}
								<span class="muted small"
									>{'role' in p ? `${p.creator.name}’s, ` : ''}version {p.version}</span
								></span
							>
						</label>
					{:else}
						<p class="muted small">Publish homebrew first to add it here.</p>
					{/each}
				</fieldset>
				<fieldset>
					<legend>Tables ({tables.length})</legend>
					{#each tables as t (t.code)}
						<p class="table-line">
							<span><Icon name="map" size="1.05em" />{t.name}</span>
							<button
								type="button"
								class="ghost link"
								onclick={() => (tables = tables.filter((x) => x.code !== t.code))}
								><Icon name="close" />Remove<span class="visually-hidden"> {t.name}</span></button
							>
						</p>
					{/each}
					<div class="table-add">
						<input
							bind:value={tableName}
							aria-label="Table name"
							placeholder="Name"
							maxlength={COLLECTION_LIMITS.tableName}
						/>
						<input
							bind:value={tableCode}
							aria-label="Shared table link or code"
							placeholder="Shared table link or code"
						/>
						<button type="button" onclick={addTable}><Icon name="plus" />Add</button>
					</div>
				</fieldset>
				<button class="primary publish" type="submit" disabled={busy}>
					<Icon name="upload" />{busy ? 'Publishing…' : 'Publish the collection'}
				</button>
			</form>
		</Frame>
	</div>

	{#if message}<p class="ok g-pop" role="status"><Icon name="check" />{message}</p>{/if}
	{#if error}<p class="error g-pop" role="alert"><Icon name="warn" />{error}</p>{/if}
	<Diagnostics diagnostics={found} />

	{#if creatorId}
		<p class="creator-id small">
			<Icon name="user" />
			<span>
				Your creator id is <code>{creatorId}</code>: give it to a creator who wants to share
				something with you.
			</span>
			<button type="button" class="ghost link" onclick={copyId}><Icon name="copy" />Copy</button>
		</p>
	{/if}

	{#if mine.length}
		<h3 class="plate"><Icon name="book" />Published</h3>
		<ul class="mine g-stagger">
			{#each [...ownCollections, ...mine.filter((m) => m.kind !== 'collection')] as item, n (item.id)}
				<li style:--i={Math.min(n, 8)}>
					<span class="info">
						<Icon name={KIND_ICON[item.kind]} size="1.4em" />
						<span class="text">
							<strong>{item.title}</strong>
							<span class="muted small"
								>{KIND_WORD[item.kind]} · version {item.version} · {ACCESS_WORD[item.access]}{item
									.grants.length
									? ` · shared ${item.grants.filter((g) => g.revoked === null).length}×`
									: ''}</span
							>
						</span>
					</span>
					<span class="actions">
						<button
							type="button"
							aria-expanded={sharing === item.id}
							onclick={() => toggleSharing(item.id)}
						>
							<Icon name="lock" />{sharing === item.id ? 'Done' : 'Access and sharing'}
						</button>
						<button type="button" class="danger" onclick={() => remove(item)}
							><Icon name="trash" />Remove</button
						>
					</span>
					{#if sharing === item.id && gmKey}
						<div class="access-wrap">
							<LibraryAccess {item} {gmKey} onChange={home} />
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if shared.length}
		<h3 class="plate"><Icon name="users" />Shared with you</h3>
		<ul class="mine g-stagger">
			{#each shared as item, n (item.id)}
				<li style:--i={Math.min(n, 8)}>
					<span class="info">
						<Icon name={KIND_ICON[item.kind]} size="1.4em" />
						<span class="text">
							<strong>{item.title}</strong>
							<span class="muted small"
								>{KIND_WORD[item.kind]} by {item.creator.name} · {item.role === 'collaborator'
									? 'you collaborate on it'
									: 'yours to play'}{item.grant.expires
									? ` · until ${new Date(item.grant.expires).toLocaleString()}`
									: ''}</span
							>
						</span>
					</span>
					{#if item.kind !== 'pack' && onRun}
						<span class="actions">
							<button type="button" onclick={() => onRun(item)}
								><Icon name="play" />Run it<span class="visually-hidden">: {item.title}</span
								></button
							>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Frame>

<style>
	/* The creator's corner: a framed workbench below the shelves. */
	:global(.workshop) {
		display: grid;
		gap: var(--sp-6);
		max-width: 68rem;
		margin: var(--sp-8) auto 0;
		padding: var(--sp-8) clamp(var(--sp-6), 3vw, var(--sp-8));
	}

	.shelf-head {
		display: grid;
		justify-items: center;
		gap: var(--sp-5);
		text-align: center;
	}

	.shelf-head :global(.g-banner) {
		max-width: 100%;
		font-size: clamp(1.15rem, 3.4vw, 1.6rem);
		text-align: center;
		text-wrap: balance;
	}

	.intro {
		max-width: 46rem;
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		color: var(--text);
	}

	h3 {
		display: flex;
		align-items: center;
		gap: 0.45em;
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
	}

	/* A plate on the case's edge, naming the list under it. */
	h3.plate {
		justify-self: start;
		padding: 0.4rem 1.1rem 0.5rem;
		border-radius: 12px;
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			0 0 16px rgba(224, 164, 88, 0.18);
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		gap: var(--sp-6);
		align-items: start;
	}

	:global(.workshop .part) {
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
		padding: var(--sp-7) var(--sp-7);
	}

	.collection-form {
		display: grid;
		gap: var(--sp-5);
	}

	.cap {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--gilt);
	}

	.field {
		display: grid;
		gap: var(--sp-3);
		max-width: 28rem;
		justify-self: center;
		width: 100%;
	}

	:global(.part) .field {
		max-width: none;
		justify-self: stretch;
	}

	.field input,
	.field textarea {
		min-height: 2.75rem;
		padding: 0.5rem 0.8rem;
		color: var(--text);
		font-size: var(--fs-md);
	}

	fieldset {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: var(--sp-3);
		padding: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--gilt);
	}

	/* Each choice is a plate to set down; the ones chosen are lit and numbered in play order. */
	.option {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 2.75rem;
		padding: var(--sp-3) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: rgba(255, 238, 214, 0.05);
		box-shadow: inset 0 0 0 1px rgba(240, 212, 158, 0.12);
		cursor: pointer;
		transition:
			background 140ms var(--ease-out),
			box-shadow 140ms var(--ease-out);
	}

	.option:hover {
		background: rgba(255, 238, 214, 0.1);
	}

	.option.on {
		background: linear-gradient(90deg, rgba(224, 164, 88, 0.2), rgba(224, 164, 88, 0.06));
		box-shadow: inset 0 0 0 1px var(--gilt-line-strong);
	}

	.option:has(input:focus-visible) {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.option input {
		flex: none;
		width: 1.15rem;
		height: 1.15rem;
		margin: 0;
	}

	.option .what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--sp-4);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.order {
		flex: none;
		display: inline-grid;
		place-items: center;
		min-width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--gilt-grad);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			0 1px 0 var(--gilt-dark);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		color: var(--accent-text);
	}

	.table-add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}

	.table-add input {
		flex: 1;
		min-width: 9rem;
		min-height: 2.75rem;
		padding: 0.5rem 0.8rem;
		color: var(--text);
	}

	.table-add button,
	.table-line button,
	.actions button,
	.creator-id button,
	.publish {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45em;
	}

	.table-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		margin: 0;
		padding: var(--sp-2) var(--sp-5);
		border-radius: var(--radius-sm);
		background: rgba(255, 238, 214, 0.05);
	}

	.table-line span {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		overflow-wrap: anywhere;
	}

	.link {
		min-height: 2.5rem;
		color: var(--gilt);
		font-size: inherit;
	}

	.publish {
		justify-self: start;
		min-height: 3rem;
		padding-inline: 1.6rem;
		font-size: 1.2rem;
	}

	p {
		margin: 0;
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: var(--fs-sm);
	}

	/* The homebrew file offer: a plate that opens the file chooser, keyboard and all. */
	.file-offer {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		min-height: 3.2rem;
		padding: var(--sp-5) var(--sp-6);
		border: 2px dashed var(--gilt-line-strong);
		border-radius: var(--radius-md);
		background: rgba(224, 164, 88, 0.06);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-align: center;
		color: var(--gilt-hi);
		cursor: pointer;
		transition:
			background 140ms var(--ease-out),
			border-color 140ms var(--ease-out);
	}

	.file-offer:hover {
		background: rgba(224, 164, 88, 0.14);
		border-color: var(--gilt);
	}

	.file-offer:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
		box-shadow: var(--ring);
	}

	.file-offer.disabled {
		opacity: 0.6;
		pointer-events: none;
	}

	.ok,
	.error {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		justify-self: center;
		max-width: 44rem;
		padding: var(--sp-5) var(--sp-6);
		border-radius: var(--radius-md);
	}

	.ok {
		border: 1px solid rgba(127, 196, 122, 0.55);
		background: rgba(26, 48, 24, 0.9);
		color: #d6f2d2;
	}

	.error {
		border: 1px solid rgba(226, 122, 107, 0.55);
		background: rgba(54, 24, 18, 0.9);
		color: #ffd7cf;
	}

	.creator-id {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-4) var(--sp-5);
		padding: var(--sp-4) var(--sp-6);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.25);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.creator-id span {
		flex: 1 1 16rem;
		min-width: 0;
	}

	code {
		font-size: var(--fs-sm);
		color: var(--gilt-hi);
		overflow-wrap: anywhere;
	}

	.mine {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-5);
	}

	.mine li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4) var(--sp-6);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 3px 0 var(--ink-line),
			0 8px 14px rgba(8, 4, 0, 0.35);
	}

	.info {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		min-width: 0;
		color: var(--gilt);
	}

	.text {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.text strong {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.15;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}

	.access-wrap {
		flex-basis: 100%;
	}

	@media (max-width: 48rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}

		:global(.workshop) {
			margin-top: var(--sp-7);
			padding: var(--sp-7) var(--sp-5);
		}

		:global(.workshop .part) {
			padding: var(--sp-6) var(--sp-5);
		}

		.actions button,
		.table-add button,
		.table-line button,
		.creator-id button {
			min-height: 2.75rem;
		}

		.actions {
			width: 100%;
		}

		.actions button {
			flex: 1 1 auto;
		}
	}
</style>
