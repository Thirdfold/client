<script lang="ts">
	import { resolve } from '$app/paths';
	import { play } from '$lib/audio/engine';
	import {
		LIBRARY_LIMITS,
		normalizeCreatorName,
		type MyAdventure,
		type SharedListing
	} from '$lib/game/library';
	import type { LibraryOp } from '$lib/game/protocol';
	import { libraryHome, manageAdventure, publishAdventure } from '$lib/net/library';
	import { diagnosticsOf } from '$lib/net/ask';
	import Diagnostics from '$lib/ui/Diagnostics.svelte';
	import type { Diagnostic } from '$lib/validation/diagnostics';
	import { loadCreatorName, loadGmKey, saveCreatorName } from '$lib/prefs';
	import { Icon } from '$lib/ui/game';
	import { describePlays, describeRating } from '$lib/ui/rating';
	import { lastPlayed } from '$lib/ui/when';
	import Empty from './ui/Empty.svelte';
	import Panel from './ui/Panel.svelte';

	/**
	 * Publishing to the library: the draft as a new adventure, or as the next
	 * version of one of the creator's; and their published adventures, to
	 * list, unlist or remove. They are theirs by this browser's GM key.
	 *
	 * It is a letter to the library, sealed with wax: the seal is the Publish button.
	 */
	let {
		file,
		ready,
		title,
		oncheck
	}: {
		/** The adventure file as it stands. */
		file: () => unknown;
		/** Whether it passes every check (only playable adventures are published). */
		ready: boolean;
		title: string;
		/** Takes the creator to the Check part (when the story is not ready). */
		oncheck?: () => void;
	} = $props();

	const LAST_KEY = 'thirdfold:builder:published';
	const lastPublished = () => {
		try {
			return localStorage.getItem(LAST_KEY);
		} catch {
			return null;
		}
	};

	let gmKey = $state(loadGmKey());
	let creator = $state(loadCreatorName());
	let mine = $state<MyAdventure[] | null>(null);
	/** Adventures other creators made this one a collaborator on: theirs to add versions to too. */
	let collaborating = $state<SharedListing[]>([]);
	/** '' publishes a new adventure; else the id of the one this is a new version of. */
	let target = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);
	/** The wax has just been pressed: the seal stamps down once. */
	let stamped = $state(0);
	/** What the server found in content it refused to publish. */
	let found = $state<Diagnostic[]>([]);

	$effect(() => {
		const key = gmKey;
		if (!key) return void (mine = []);
		libraryHome(key).then(
			(home) => {
				show(home);
				const last = lastPublished();
				if (last && [...mine!, ...collaborating].some((a) => a.id === last)) target = last;
			},
			(err: Error) => (error = err.message)
		);
	});

	function show(home: { mine: MyAdventure[]; shared: SharedListing[] }) {
		mine = home.mine.filter((a) => a.kind === 'adventure');
		collaborating = home.shared.filter((a) => a.kind === 'adventure' && a.role === 'collaborator');
	}

	async function publish() {
		const name = normalizeCreatorName(creator);
		if (!name) return fail('Enter the name to publish under.');
		if (!ready) return fail('Fix the problems first (see Check).');
		busy = true;
		error = message = null;
		found = [];
		saveCreatorName(name);
		try {
			const done = await publishAdventure({
				gmKey,
				creator: name,
				file: file(),
				...(target ? { adventureId: target } : {})
			});
			gmKey = done.gmKey;
			target = done.adventureId;
			try {
				localStorage.setItem(LAST_KEY, done.adventureId);
			} catch {
				// ignore
			}
			message =
				done.version === 1
					? `Published “${title}”. Anyone can find it in the library now.`
					: `Published version ${done.version} of “${title}”. New games get it; games under way keep theirs.`;
			stamped += 1;
			play([{ kind: 'ui', sound: 'fanfare' }]);
			show(await libraryHome(done.gmKey));
		} catch (err) {
			fail((err as Error).message);
			found = diagnosticsOf(err);
		} finally {
			busy = false;
		}
	}

	function fail(text: string) {
		error = text;
		play([{ kind: 'ui', sound: 'error' }]);
	}

	async function manage(a: MyAdventure, op: LibraryOp) {
		if (!gmKey) return;
		if (op === 'remove' && !confirm(`Remove “${a.title}” and all its versions from the library?`)) {
			return;
		}
		error = message = null;
		try {
			mine = await manageAdventure(gmKey, a.id, op, 'adventure');
			if (op === 'remove' && target === a.id) target = '';
		} catch (err) {
			fail((err as Error).message);
		}
	}
</script>

<div class="publish">
	<Panel variant="parchment" title="A letter to the library" icon="scroll" class="letter">
		<p class="hint">
			Put the adventure in the <a href={resolve('/library')}>library</a>, where any GM can find it,
			run it for their table and rate it. Publishing again adds a version: new games get the latest,
			and games already under way keep the one they started with.
		</p>

		<p class="address">
			<span class="to">For the library</span>
			<span class="name">“{title || 'Untitled'}”</span>
		</p>

		<div class="row">
			<label class="field">
				Publish as
				<input
					bind:value={creator}
					maxlength={LIBRARY_LIMITS.creatorName}
					placeholder="Your name as a creator"
					autocomplete="nickname"
				/>
			</label>
			<label class="field">
				Publish
				<select bind:value={target}>
					<option value="">as a new adventure</option>
					{#each mine ?? [] as a (a.id)}
						<option value={a.id}>as version {a.version + 1} of “{a.title}”</option>
					{/each}
					{#each collaborating as a (a.id)}
						<option value={a.id}
							>as version {a.version + 1} of {a.creator.name}’s “{a.title}” (you collaborate)</option
						>
					{/each}
				</select>
			</label>
		</div>

		{#if !ready}
			<div class="unready">
				<Icon name="warn" size="1.4em" />
				<p>
					<strong>The story is not ready.</strong>
					Fix the problems in Check to publish it.
				</p>
				{#if oncheck}
					<button type="button" onclick={oncheck}>
						<Icon name="check" size="1em" />Open Check
					</button>
				{/if}
			</div>
		{/if}

		<div class="sealing">
			<button
				type="button"
				class="seal"
				class:busy
				disabled={busy || !ready}
				aria-label={busy ? 'Publishing…' : 'Publish'}
				onclick={publish}
			>
				{#key stamped}
					<span class="wax" class:stamped={stamped > 0}>
						<Icon name={ready ? 'crown' : 'lock'} size="2rem" />
						<span class="word" aria-hidden="true">{busy ? 'Sealing…' : 'Publish'}</span>
					</span>
				{/key}
			</button>
			<div class="results">
				{#if message}
					<p class="done" role="status"><Icon name="check" size="1.1em" />{message}</p>
				{:else if ready}
					<p class="hint">Press the seal to send it.</p>
				{/if}
				{#if error}
					<p class="error" role="alert"><Icon name="warn" size="1.1em" />{error}</p>
				{/if}
				<Diagnostics diagnostics={found} />
			</div>
		</div>
	</Panel>

	<Panel title="Your adventures" icon="book" class="shelf">
		{#if mine === null}
			<p class="hint">Looking…</p>
		{:else if mine.length === 0}
			<Empty icon="book" title="Nothing on your shelf yet">
				You haven’t published any yet. The first one you seal will stand here.
			</Empty>
		{:else}
			<ul class="mine g-stagger">
				{#each mine as a, i (a.id)}
					<li style:--i={i}>
						<div class="spine">
							<strong>{a.title}</strong>
							<span class="meta">
								<span class="g-tag">version {a.version}</span>
								{#if a.access === 'private'}
									<span class="g-tag ember">not in the library</span>
								{:else if a.access === 'restricted'}
									<span class="g-tag ember">shared with chosen GMs</span>
								{/if}
								<span class="muted">
									{lastPlayed(a.publishedAt)} · {describeRating(a.rating)} · {describePlays(
										a.plays
									)}
								</span>
							</span>
						</div>
						<span class="actions">
							{#if a.listed}
								<button type="button" onclick={() => manage(a, 'unlist')}
									><Icon name="eyeoff" size="1em" />Take out of the library</button
								>
							{:else}
								<button type="button" onclick={() => manage(a, 'list')}
									><Icon name="eye" size="1em" />Put back in the library</button
								>
							{/if}
							<button type="button" class="danger" onclick={() => manage(a, 'remove')}
								><Icon name="trash" size="1em" />Remove</button
							>
						</span>
					</li>
				{/each}
			</ul>
			<p class="hint">
				<a href={resolve(`/library?creator=${mine[0].creator.id}`)}>Your page in the library</a>
				· Adventures taken out of the library can still be run by you. Restrict one, or share it with
				chosen GMs, under “Your homebrew and collections” in the library.
			</p>
		{/if}
		{#if !gmKey}
			<p class="hint">
				Your adventures are yours by this browser’s GM key, which you get when you first publish or
				run a game.
			</p>
		{/if}
	</Panel>
</div>

<style>
	.publish {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		gap: var(--sp-7);
		align-items: start;
	}

	.address {
		display: grid;
		gap: var(--sp-1);
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border-left: 3px solid var(--ink-accent);
		background: rgba(122, 91, 48, 0.1);
	}

	.to {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.08em;
		color: var(--ink-muted);
	}

	.name {
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.15;
		color: var(--ink);
		overflow-wrap: anywhere;
	}

	.row > :global(.field) {
		flex: 1 1 14rem;
	}

	.unready {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-5);
		border: 1px solid #7a2e22;
		border-radius: var(--radius-md);
		background: rgba(138, 59, 59, 0.12);
		color: #6a2218;
	}

	.unready p {
		margin: 0;
		color: var(--ink);
	}

	/* The seal: pressed wax, the one thing to do. */
	.sealing {
		display: flex;
		align-items: center;
		gap: var(--sp-7);
		flex-wrap: wrap;
		padding-top: var(--sp-4);
		border-top: 1px solid rgba(122, 91, 48, 0.4);
	}

	.seal:not(.primary):not(:disabled),
	.seal {
		flex: none;
		display: grid;
		place-items: center;
		width: 7rem;
		height: 7rem;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 52% 48% 55% 45% / 48% 54% 46% 52%;
		background:
			radial-gradient(circle at 34% 28%, #e8745f 0 9%, transparent 32%),
			radial-gradient(circle at 50% 50%, #b3301f 0 52%, #7d1c12 100%);
		box-shadow:
			inset 0 0 0 5px rgba(255, 190, 170, 0.16),
			inset 0 0 0 7px rgba(70, 8, 2, 0.5),
			inset 0 -6px 10px rgba(60, 6, 0, 0.5),
			0 5px 0 #3a0a06,
			0 14px 22px rgba(40, 8, 0, 0.45);
		color: #ffe9e2;
		text-shadow: 0 1px 0 rgba(60, 6, 0, 0.7);
		transform: none;
	}

	.seal:not(.primary):not(:disabled):hover {
		border: 0;
		background:
			radial-gradient(circle at 34% 28%, #f08a74 0 9%, transparent 32%),
			radial-gradient(circle at 50% 50%, #c4392a 0 52%, #8c2216 100%);
		box-shadow:
			inset 0 0 0 5px rgba(255, 200, 180, 0.22),
			inset 0 0 0 7px rgba(70, 8, 2, 0.5),
			inset 0 -6px 10px rgba(60, 6, 0, 0.5),
			0 5px 0 #3a0a06,
			0 14px 26px rgba(40, 8, 0, 0.5),
			0 0 28px rgba(226, 90, 60, 0.4);
		transform: translateY(-2px);
	}

	.seal:not(.primary):not(:disabled):active {
		box-shadow:
			inset 0 0 0 5px rgba(255, 190, 170, 0.16),
			inset 0 0 0 7px rgba(70, 8, 2, 0.5),
			inset 0 6px 12px rgba(60, 6, 0, 0.6),
			0 1px 0 #3a0a06;
		transform: translateY(4px);
	}

	.seal:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 4px;
	}

	.seal:disabled {
		border: 0;
		background: radial-gradient(circle at 50% 50%, #8a7f72 0 52%, #6b6258 100%);
		box-shadow:
			inset 0 0 0 5px rgba(255, 255, 255, 0.1),
			inset 0 0 0 7px rgba(40, 34, 28, 0.4),
			0 4px 0 #3b352e;
		color: #2a241d;
		text-shadow: none;
		filter: none;
		opacity: 0.85;
	}

	.wax {
		display: grid;
		place-items: center;
		gap: var(--sp-1);
	}

	.wax.stamped {
		animation: stamp 520ms var(--spring) both;
	}

	.word {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	@keyframes stamp {
		0% {
			opacity: 0;
			transform: scale(1.7) rotate(-14deg);
		}
		55% {
			opacity: 1;
			transform: scale(0.9) rotate(2deg);
		}
		100% {
			transform: none;
		}
	}

	.results {
		display: grid;
		gap: var(--sp-3);
		flex: 1 1 14rem;
		min-width: 0;
	}

	.results p {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-4);
		margin: 0;
	}

	.results :global(.icon) {
		margin-top: 0.15em;
	}

	.done {
		color: #1f5a2a;
		font-weight: 700;
	}

	.results .error {
		color: #8a2a1e;
		font-weight: 700;
	}

	.mine {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mine li {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--ink-line);
		border-left: 6px solid var(--gilt-mid);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.26);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.spine {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
		font-family: var(--font-ui);
		font-size: var(--fs-sm);
		font-weight: 400;
	}

	.muted {
		color: var(--muted);
	}

	.actions {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}

	.actions button {
		min-height: 2.25rem;
		padding-block: var(--sp-3);
		font-size: var(--fs-sm);
	}

	@media (max-width: 64rem) {
		.publish {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 40rem) {
		.unready {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.unready button {
			grid-column: 1 / -1;
		}

		.sealing {
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wax.stamped {
			animation: none;
		}
	}
</style>
