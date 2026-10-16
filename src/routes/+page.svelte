<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ROOM_ID_PATTERN } from '$lib/game/names';
	import {
		RoomConnection,
		handOff,
		type ConnectionError,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import type { SavedScene } from '$lib/game/protocol';
	import { listSaves } from '$lib/net/saves';
	import { listGames } from '$lib/net/library';
	import type { PublicGame } from '$lib/game/library';
	import { loadGmKey, loadName, saveGmKey, saveName } from '$lib/prefs';
	import { lastPlayed } from '$lib/ui/when';
	import { sharedCode } from '$lib/ui/share';
	import { prefetchRenderer } from '$lib/tabletop/load';
	import { play } from '$lib/audio/engine';
	import { Backdrop, Icon } from '$lib/ui/game';
	import Hero from '$lib/ui/title/Hero.svelte';
	import NameScroll from '$lib/ui/title/NameScroll.svelte';
	import Plaque from '$lib/ui/title/Plaque.svelte';
	import PanelShell from '$lib/ui/title/PanelShell.svelte';
	import GamesList from '$lib/ui/title/GamesList.svelte';
	import SoundToggle from '$lib/ui/title/SoundToggle.svelte';
	import pkg from '../../package.json';

	let name = $state(loadName());
	let code = $state('');
	let pending = $state<RoomConnection | null>(null);
	let error = $state<string | null>(null);

	const busy = $derived(pending !== null);

	/** This browser's GM key, and the saves it holds on the server (newest first). */
	let gmKey = $state(loadGmKey());
	let saves = $state<SavedScene[] | null>(null);
	let savesError = $state<string | null>(null);
	const latest = $derived(saves?.[0] ?? null);

	$effect(() => {
		const key = gmKey;
		if (!key) return;
		saves = null;
		savesError = null;
		listSaves(key).then(
			(list) => gmKey === key && (saves = list),
			(err: Error) => gmKey === key && (savesError = err.message)
		);
	});

	let pastedKey = $state('');
	let showKey = $state(false);
	let copied = $state(false);

	function useKey(event: SubmitEvent) {
		event.preventDefault();
		const key = pastedKey.trim().toLowerCase();
		if (!saveGmKey(key)) {
			error = 'That is not a GM key (64 letters and digits).';
			return;
		}
		error = null;
		pastedKey = '';
		gmKey = key;
	}

	async function copyKey() {
		if (!gmKey) return;
		try {
			await navigator.clipboard.writeText(gmKey);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			showKey = true;
		}
	}

	/** Opens a new table on one of the GM's saves. */
	function continueFrom(scene: SavedScene) {
		if (!canCreate || !gmKey) return;
		enter({ type: 'create', name: name.trim(), gmKey, continueFrom: scene.id });
	}

	/** A shared table this link opens (`?table=<code>`), if any. */
	const sharedTable = $derived(sharedCode(page.url.href));

	/** Opens a new table, as its GM, on a table someone shared. */
	function openShared() {
		if (!canCreate || !sharedTable) return;
		enter({
			type: 'create',
			name: name.trim(),
			...(gmKey ? { gmKey } : {}),
			continueFrom: sharedTable
		});
	}

	const roomId = $derived(code.trim().toUpperCase());
	const canCreate = $derived(name.trim().length > 0 && !busy);
	const canJoin = $derived(canCreate && ROOM_ID_PATTERN.test(roomId));

	async function enter(intent: EnterIntent) {
		error = null;
		saveName(name.trim());
		const conn = new RoomConnection(intent);
		pending = conn;
		try {
			await conn.ready();
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room!.id }));
		} catch (err) {
			conn.close();
			const e = err as ConnectionError;
			if (e.code !== 'closed') error = e.message;
		} finally {
			if (pending === conn) pending = null;
		}
	}

	function create() {
		if (canCreate) enter({ type: 'create', name: name.trim(), ...(gmKey ? { gmKey } : {}) });
	}

	function join(event: SubmitEvent) {
		event.preventDefault();
		if (canJoin) enter({ type: 'join', roomId, name: name.trim(), role: 'player' });
	}

	/** Games their GMs listed for anyone to join. */
	let games = $state<PublicGame[] | null>(null);
	let gamesError = $state<string | null>(null);

	function refreshGames() {
		gamesError = null;
		listGames().then(
			(list) => (games = list),
			(err: Error) => (gamesError = err.message)
		);
	}

	$effect(() => refreshGames());

	function joinGame(game: PublicGame, role: 'player' | 'spectator') {
		if (canCreate) enter({ type: 'join', roomId: game.roomId, name: name.trim(), role });
	}

	// The table's 3D renderer is the biggest download: fetch it while the visitor is still here.
	$effect(() => prefetchRenderer());

	// ---- The menu and its panels ------------------------------------------------------------

	type Panel = 'games' | 'join' | 'key' | 'saves';
	const isWide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 60rem)').matches;

	/** The sub-menu open beside the main menu (a full screen on a phone). */
	let panel = $state<Panel | null>(isWide() ? 'games' : null);
	let opener: HTMLElement | null = null;
	let panelHeading = $state<HTMLElement | null>(null);
	let codeInput = $state<HTMLInputElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);
	let menuRoot = $state<HTMLElement | null>(null);
	let panelRoot = $state<HTMLElement | null>(null);

	async function openPanel(next: Panel, trigger: HTMLElement | null) {
		if (panel === next) return closePanel();
		play([{ kind: 'ui', sound: panel ? 'select' : 'open' }]);
		arriving = false;
		panel = next;
		opener = trigger;
		await tick();
		if (!isWide()) panelHeading?.focus();
		else if (next === 'join') codeInput?.focus();
	}

	function closePanel() {
		if (!panel) return;
		play([{ kind: 'ui', sound: 'close' }]);
		panel = null;
		if (!isWide()) opener?.focus();
	}

	/** The menu's focusable entries in order: the name, then each plaque that can be used. */
	function navItems(): HTMLElement[] {
		if (!menuRoot) return [];
		return [...menuRoot.querySelectorAll<HTMLElement>('[data-nav]')].filter(
			(el) => !(el as HTMLButtonElement).disabled
		);
	}

	function focusFirstPlaque() {
		navItems()
			.find((el) => el !== nameInput)
			?.focus();
	}

	function keys(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const target = event.target as HTMLElement | null;
		if (event.key === 'Escape') {
			if (panel && (!isWide() || panelRoot?.contains(target))) {
				event.preventDefault();
				closePanel();
			}
			return;
		}
		if (event.shiftKey || !menuRoot || !target || !menuRoot.contains(target)) return;
		const field = target instanceof HTMLInputElement;
		if (
			!['ArrowDown', 'ArrowUp'].includes(event.key) &&
			(field || !['Home', 'End'].includes(event.key))
		)
			return;
		const items = navItems();
		const at = items.indexOf(target.closest<HTMLElement>('[data-nav]') ?? target);
		if (at < 0) return;
		event.preventDefault();
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	}

	/** True while the title is still arriving (the first two seconds). */
	let arriving = $state(true);

	$effect(() => {
		const settled = setTimeout(() => (arriving = false), 2000);
		return () => clearTimeout(settled);
	});

	onMount(async () => {
		// Land on the scroll if the name is still to write, else on the first plaque. Not on a
		// touch screen, where focus would raise the keyboard before anyone has seen the title.
		if (typeof matchMedia === 'function' && !matchMedia('(pointer: fine)').matches) return;
		await tick();
		if (!name.trim()) nameInput?.focus();
		else focusFirstPlaque();
	});

	const needsName = $derived(!name.trim());
	const openCount = $derived(games === null || gamesError ? null : games.length);
	const gamesHint = $derived(
		openCount === null
			? gamesError
				? 'The list could not be fetched.'
				: 'Looking for open games…'
			: openCount === 0
				? 'None open right now.'
				: `${openCount} open now.`
	);
	const primary = $derived(sharedTable ? 'shared' : latest ? 'continue' : 'run');

	$effect(() => {
		if (error) play([{ kind: 'ui', sound: 'error' }]);
	});
</script>

<svelte:window onkeydown={keys} />

<Backdrop variant="title" />

<main class="title">
	<div class="crest">
		<Hero />
	</div>

	<div class="stage">
		<div class="menu-col" bind:this={menuRoot}>
			<NameScroll bind:value={name} bind:el={nameInput} onenter={focusFirstPlaque} />

			<nav aria-label="Main menu">
				<ul class="menu g-stagger">
					{#if sharedTable}
						<li style:--i="0">
							<Plaque
								icon="map"
								label="Open the shared table"
								hint="Someone shared a table they built. Open your own copy of it as its Game Master."
								tone={primary === 'shared' ? 'primary' : 'plain'}
								disabled={!canCreate}
								onclick={openShared}
							/>
						</li>
					{/if}
					{#if latest}
						<li style:--i="1">
							<Plaque
								icon="play"
								label="Continue"
								hint={latest.story?.title ?? latest.name}
								detail={[
									`Last played ${lastPlayed(latest.savedAt)}`,
									latest.story ? `${latest.story.chapter} · ${latest.story.location}` : '',
									latest.story?.party.length ? latest.story.party.join(', ') : ''
								]
									.filter(Boolean)
									.join('\n')}
								tone={primary === 'continue' ? 'primary' : 'plain'}
								disabled={!canCreate}
								onclick={() => continueFrom(latest)}
							/>
						</li>
					{/if}
					<li style:--i="2">
						<Plaque
							icon="crown"
							label="Run a game"
							hint="Create room and be its Game Master."
							tone={primary === 'run' ? 'primary' : 'plain'}
							disabled={!canCreate}
							onclick={create}
						/>
					</li>
					<li style:--i="3">
						<Plaque
							icon="door"
							label="Join a game"
							hint="Sit down at a table with its room code."
							expanded={panel === 'join'}
							controls="panel-join"
							onclick={(e) => openPanel('join', e.currentTarget as HTMLElement)}
						/>
					</li>
					<li style:--i="4">
						<Plaque
							icon="users"
							label="Open games"
							hint={gamesHint}
							expanded={panel === 'games'}
							controls="panel-games"
							onclick={(e) => openPanel('games', e.currentTarget as HTMLElement)}
						/>
					</li>
					{#if saves && saves.length > 1}
						<li style:--i="5">
							<Plaque
								icon="save"
								label="Other saves"
								hint="{saves.length - 1} more of yours."
								expanded={panel === 'saves'}
								controls="panel-saves"
								onclick={(e) => openPanel('saves', e.currentTarget as HTMLElement)}
							/>
						</li>
					{/if}
				</ul>
				<ul class="menu more g-stagger" aria-label="More">
					<li style:--i="6">
						<Plaque icon="book" tone="quiet" label="Adventure library" href={resolve('/library')} />
					</li>
					<li style:--i="7">
						<Plaque
							icon="wand"
							tone="quiet"
							label="Build an adventure"
							href={resolve('/builder')}
						/>
					</li>
					<li style:--i="8">
						<Plaque
							icon="key"
							tone="quiet"
							label="Your GM key"
							expanded={panel === 'key'}
							controls="panel-key"
							onclick={(e) => openPanel('key', e.currentTarget as HTMLElement)}
						/>
					</li>
					<li style:--i="9">
						<Plaque
							icon="scroll"
							tone="quiet"
							label="Credits and licences"
							href={resolve('/credits')}
						/>
					</li>
				</ul>
			</nav>

			{#if savesError && !latest}
				<p class="quiet-note">Your saves could not be looked up just now: {savesError}</p>
			{/if}
		</div>

		{#if panel}
			<div class="panel-col" class:arriving bind:this={panelRoot}>
				{#if panel === 'games'}
					<PanelShell
						id="panel-games"
						title="Open games"
						icon="users"
						onback={closePanel}
						bind:heading={panelHeading}
					>
						<GamesList
							{games}
							error={gamesError}
							canEnter={canCreate}
							onjoin={joinGame}
							onrefresh={refreshGames}
						/>
						{#if needsName && games?.length}
							<p class="need-name">
								<Icon name="pencil" size="1.1em" /> Write your name on the scroll to join one.
							</p>
						{/if}
					</PanelShell>
				{:else if panel === 'join'}
					<PanelShell
						id="panel-join"
						title="Join a game"
						icon="door"
						onback={closePanel}
						bind:heading={panelHeading}
					>
						<form class="join" onsubmit={join}>
							<p class="lede">
								Ask your Game Master for the room code. It is six letters and digits.
							</p>
							<input
								class="code"
								bind:this={codeInput}
								bind:value={code}
								placeholder="Room code"
								aria-label="Room code"
								maxlength="6"
								autocapitalize="characters"
								spellcheck="false"
								autocomplete="off"
							/>
							<div class="acts">
								<button class="primary" type="submit" disabled={!canJoin}>Join room</button>
								<button
									type="button"
									class="ghost"
									disabled={!canJoin}
									onclick={() =>
										enter({ type: 'join', roomId, name: name.trim(), role: 'spectator' })}
								>
									<Icon name="eye" size="1.1rem" /> Just watch
								</button>
							</div>
							{#if needsName}
								<p class="need-name">
									<Icon name="pencil" size="1.1em" /> Write your name on the scroll first.
								</p>
							{/if}
						</form>
					</PanelShell>
				{:else if panel === 'saves' && saves}
					<PanelShell
						id="panel-saves"
						title="Other saves"
						icon="save"
						onback={closePanel}
						bind:heading={panelHeading}
					>
						<ul class="saves g-stagger">
							{#each saves.slice(1) as scene, i (scene.id)}
								<li style:--i={i}>
									<span class="what">
										<strong>{scene.story?.title ?? scene.name}</strong>
										<span class="muted">
											{lastPlayed(scene.savedAt)}{scene.story
												? ` · ${scene.story.chapter}`
												: ''}{scene.auto ? ' · autosave' : ''}
										</span>
									</span>
									<button type="button" disabled={!canCreate} onclick={() => continueFrom(scene)}>
										<Icon name="play" size="1.05rem" /> Continue
									</button>
								</li>
							{/each}
						</ul>
						{#if needsName}
							<p class="need-name">
								<Icon name="pencil" size="1.1em" /> Write your name on the scroll to continue.
							</p>
						{/if}
					</PanelShell>
				{:else if panel === 'key'}
					<PanelShell
						id="panel-key"
						title="Your GM key"
						icon="key"
						onback={closePanel}
						bind:heading={panelHeading}
					>
						{#if gmKey}
							<p class="lede">
								Your saves are yours by this key. Use it on another device to reach them there. Keep
								it secret, like a password.
							</p>
							<div class="acts">
								<button type="button" onclick={copyKey}>
									<Icon name={copied ? 'check' : 'copy'} size="1.1rem" />
									{copied ? 'Copied' : 'Copy key'}
								</button>
								<button type="button" class="ghost" onclick={() => (showKey = !showKey)}>
									<Icon name={showKey ? 'eyeoff' : 'eye'} size="1.1rem" />
									{showKey ? 'Hide' : 'Show'}
								</button>
							</div>
							{#if showKey}<code class="shown">{gmKey}</code>{/if}
						{:else}
							<p class="lede">You get one the first time you run a game from this browser.</p>
						{/if}
						<hr class="g-rule" />
						<form class="paste" onsubmit={useKey}>
							<input
								bind:value={pastedKey}
								placeholder="Paste a key from another device"
								aria-label="GM key from another device"
								spellcheck="false"
								autocomplete="off"
							/>
							<button type="submit" disabled={!pastedKey.trim()}>Use key</button>
						</form>
					</PanelShell>
				{/if}
			</div>
		{/if}
	</div>

	<footer class="foot">
		<span>thirdfold {pkg.version}</span>
	</footer>

	<div class="corner"><SoundToggle /></div>

	<div class="notices">
		<div aria-live="polite">
			{#if pending}
				<div class="notice g-pop">
					<span class="spin"><Icon name="d20" size="1.5rem" /></span>
					<span>{pending.error?.message ?? 'Connecting…'}</span>
					<button type="button" onclick={() => pending?.close()}>Cancel</button>
				</div>
			{/if}
		</div>
		{#if error}
			<div class="notice bad g-pop" role="alert">
				<Icon name="warn" size="1.5rem" />
				<span>{error}</span>
				<button type="button" class="ghost" onclick={() => (error = null)}>
					<Icon name="close" size="1rem" label="Dismiss" />
				</button>
			</div>
		{/if}
	</div>
</main>

<style>
	.title {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: clamp(var(--sp-5), 2.5vh, var(--sp-7));
		min-height: 100dvh;
		padding: clamp(var(--sp-6), 3.5vh, 2.5rem) clamp(var(--sp-6), 4vw, var(--sp-8)) var(--sp-6);
	}

	/* The three view-transition names: the front page folds shut into the table (see app.css). */
	.crest {
		view-transition-name: tf-crest;
	}

	.menu-col {
		view-transition-name: tf-play;
	}

	.panel-col {
		view-transition-name: tf-aside;
	}

	.stage {
		display: grid;
		grid-template-columns: minmax(0, 28rem);
		justify-content: center;
		align-content: start;
		gap: var(--sp-8);
	}

	.menu-col {
		display: grid;
		align-content: start;
		gap: var(--sp-6);
		min-width: 0;
		animation: g-rise 700ms var(--ease-out) 700ms both;
	}

	/* A panel you open arrives at once; the one standing there at the start waits for the title. */
	.panel-col {
		min-width: 0;
		animation: g-rise 320ms var(--ease-out) both;
	}

	.panel-col.arriving {
		animation-duration: 700ms;
		animation-delay: 900ms;
	}

	.menu {
		display: grid;
		gap: var(--sp-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.menu > li {
		min-width: 0;
		/* The plaques cascade in after the title has settled. */
		animation-delay: calc(900ms + var(--i, 0) * 70ms);
	}

	.menu.more {
		margin-top: var(--sp-6);
		padding-top: var(--sp-6);
		border-top: 1px solid var(--gilt-line);
		gap: var(--sp-4);
	}

	.quiet-note,
	.need-name {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.need-name {
		display: flex;
		align-items: center;
		gap: 0.4em;
		color: var(--gilt-hi);
	}

	.quiet-note {
		text-align: center;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9);
	}

	/* ---- sub-menus ---- */
	.lede {
		margin: 0;
		color: var(--muted);
	}

	.join {
		display: grid;
		gap: var(--sp-6);
	}

	.code {
		min-height: 3.6rem;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.4em;
		padding-left: 0.4em;
		font-family: var(--font-mono);
		font-size: 1.7rem;
		font-weight: 700;
	}

	.code::placeholder {
		font-family: var(--font-label);
		font-size: 1.1rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0.06em;
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5);
	}

	.acts button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.join .acts .primary {
		flex: 1 1 10rem;
		justify-content: center;
		min-height: 3rem;
	}

	.shown {
		display: block;
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		word-break: break-all;
		user-select: all;
	}

	.paste {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--sp-4);
	}

	.saves {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.saves li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4) var(--sp-6);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(255, 238, 214, 0.05);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.saves .what {
		display: grid;
		gap: var(--sp-1);
		flex: 1 1 10rem;
		min-width: 0;
	}

	.saves .muted {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.saves li button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	/* ---- footer, corner, notices ---- */
	.foot {
		align-self: end;
		text-align: center;
		color: var(--muted);
		font-size: var(--fs-xs);
		letter-spacing: 0.06em;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9);
	}

	.corner {
		position: fixed;
		top: var(--sp-6);
		right: var(--sp-6);
		z-index: 30;
		animation: g-rise 600ms var(--ease-out) 1400ms both;
	}

	.notices {
		position: fixed;
		inset: auto var(--sp-6) var(--sp-7);
		z-index: 40;
		display: grid;
		justify-items: center;
		gap: var(--sp-4);
		pointer-events: none;
	}

	.notice {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		max-width: min(36rem, 100%);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-solid);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			var(--shadow-lg);
		color: var(--text);
	}

	.notice.bad {
		background: #3a1a15;
		box-shadow:
			inset 0 0 0 1px rgba(255, 170, 150, 0.45),
			var(--shadow-lg);
		color: #ffe3dc;
	}

	.notice .spin {
		display: inline-grid;
		color: var(--gilt);
		animation: spin 1.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.menu-col,
		.panel-col,
		.corner,
		.menu > li {
			animation: none;
		}

		.notice .spin {
			animation: none;
		}
	}

	/* ---- wide: the menu with its board beside it ---- */
	@media (min-width: 60rem) {
		.stage {
			grid-template-columns: minmax(0, 28rem) minmax(0, 31rem);
			gap: clamp(var(--sp-8), 4vw, 3.5rem);
		}

		.panel-col {
			align-self: start;
			padding-top: 0.2rem;
		}
	}

	/* ---- phone: the stacked menu; a panel is a full screen of its own ---- */
	@media (max-width: 59.99rem) {
		.panel-col {
			position: fixed;
			inset: 0;
			z-index: 20;
			overflow-y: auto;
			padding: var(--sp-6) var(--sp-6) calc(var(--sp-8) * 2);
			background: rgba(8, 5, 3, 0.88);
			backdrop-filter: blur(6px);
		}

		/* Under a full-screen panel, which has its own Back. */
		.corner {
			top: var(--sp-5);
			right: var(--sp-5);
			z-index: 10;
		}
	}

	@media (max-width: 47.99rem) {
		.title {
			padding-inline: var(--sp-6);
			padding-top: calc(var(--sp-8) * 1.8);
		}

		.notices {
			inset-inline: var(--sp-5);
		}
	}
</style>
