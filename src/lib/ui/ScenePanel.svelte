<script lang="ts">
	import {
		normalizeSceneName,
		SCENE_FILE_MAX_BYTES,
		SCENE_NAME_MAX_LENGTH
	} from '$lib/game/file-limits';
	import type { SavedScene } from '$lib/game/protocol';
	import { sharedCode, sharedLink } from './share';
	import type { RoomAction, SceneReply } from '$lib/net/room-connection.svelte';
	import { loadSavedScenes, storeSavedScenes, type SavedSceneRef } from '$lib/prefs';
	import { lastPlayed } from './when';
	import { Icon } from '$lib/ui/game';
	import PanelTitle from './room/PanelTitle.svelte';
	import ToolSlot from './room/ToolSlot.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		/** The room's current scene name; the name box follows it. */
		sceneName: string;
		reply: SceneReply | null;
		send(action: RoomAction): boolean;
		onError(message: string): void;
	}

	let { sceneName, reply, send, onError }: Props = $props();

	// Follows the table's scene (after a load, import or reconnect) but stays editable in between.
	let name = $derived(sceneName);
	/** The GM's saves, kept on the server under their GM key (any device). */
	let saves = $state<SavedScene[] | null>(null);
	/** Older saves this browser remembers, from before saves had owners; still loadable by id. */
	let saved = $state<SavedSceneRef[]>(loadSavedScenes());
	const older = $derived(saved.filter((s) => !saves?.some((x) => x.id === s.sceneId)));

	// Ask for the list once the panel is shown (and again after each save).
	$effect(() => {
		send({ type: 'scene_list' });
	});
	/** Scene waiting for a second click to confirm replacing the table. */
	let confirming = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let lastHandled = 0;

	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	// Replies from the server: remember a save; download an export.
	$effect(() => {
		if (!reply || reply.seq === lastHandled) return;
		lastHandled = reply.seq;
		if (reply.type === 'scene_saved') {
			send({ type: 'scene_list' });
		} else if (reply.type === 'scene_list') {
			saves = reply.scenes;
		} else if (reply.type === 'scene_shared') {
			shared = { name: reply.name, link: sharedLink(location.origin, reply.code) };
			copied = false;
		} else {
			download(reply.file.name, JSON.stringify(reply.file, null, 2));
		}
	});

	function download(sceneName: string, json: string) {
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${sceneName.replace(/[^\w.-]+/g, '_') || 'scene'}.thirdfold.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function currentName(): string | null {
		const n = normalizeSceneName(name);
		if (!n) onError(`Scene names are 1-${SCENE_NAME_MAX_LENGTH} characters.`);
		return n;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const n = currentName();
		if (n) send({ type: 'scene_save', name: n });
	}

	function exportFile() {
		const n = currentName();
		if (n) send({ type: 'scene_export', name: n });
	}

	function load(sceneId: string) {
		if (confirming !== sceneId) {
			confirming = sceneId;
			return;
		}
		confirming = null;
		send({ type: 'scene_load', sceneId });
	}

	function forget(scene: SavedSceneRef) {
		saved = saved.filter((s) => s.sceneId !== scene.sceneId);
		storeSavedScenes(saved);
	}

	/** Deletes one of the GM's saves for good (a second click confirms). */
	let deleting = $state<string | null>(null);
	function remove(scene: SavedScene) {
		if (deleting !== scene.id) {
			deleting = scene.id;
			return;
		}
		deleting = null;
		send({ type: 'scene_delete', sceneId: scene.id });
	}

	/** The table last shared: its name and the link that opens it. */
	let shared = $state<{ name: string; link: string } | null>(null);
	let copied = $state(false);

	function share() {
		const n = currentName();
		if (n) send({ type: 'scene_share', name: n });
	}

	async function copyLink() {
		if (!shared) return;
		try {
			await navigator.clipboard.writeText(shared.link);
			copied = true;
		} catch {
			onError('Copying failed: select the link and copy it.');
		}
	}

	/** A shared table's link or code, pasted to open it here. */
	let openCode = $state('');
	function openShared(event: SubmitEvent) {
		event.preventDefault();
		const code = sharedCode(openCode);
		if (!code) return onError('That is not a shared table link or code.');
		openCode = '';
		send({ type: 'scene_load', sceneId: code });
	}

	let creating = $state(false);

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > SCENE_FILE_MAX_BYTES) return onError('That file is too large to be a scene.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return onError('That file is not a thirdfold scene (not JSON).');
		}
		if (typeof data !== 'object' || data === null) {
			return onError('That file is not a thirdfold scene.');
		}
		// The server validates every field; this only ships the data, once the GM confirms.
		pendingImport = { name: file.name, data };
	}

	/** An imported file waiting for the GM to confirm it replaces the table. */
	let pendingImport = $state<{ name: string; data: object } | null>(null);
	function confirmImport() {
		if (!pendingImport) return;
		send({ type: 'scene_import', file: pendingImport.data });
		pendingImport = null;
	}
</script>

<section class="scene" aria-label="Scene">
	<PanelTitle icon="save">Scene</PanelTitle>

	<Tray title="Save slots" icon="save">
		<form class="save" onsubmit={save}>
			<input bind:value={name} maxlength={SCENE_NAME_MAX_LENGTH} aria-label="Scene name" />
			<button class="primary" type="submit"><Icon name="save" /> Save</button>
		</form>

		{#if saves === null}
			<!-- Looking: three empty slots breathe while the server answers. -->
			<ul class="saved loading" aria-hidden="true">
				<li><span class="slot-art"></span><span class="bar"></span></li>
				<li><span class="slot-art"></span><span class="bar short"></span></li>
			</ul>
			<p class="muted" role="status">Looking up your saves…</p>
		{:else if saves.length === 0 && older.length === 0}
			<ul class="saved empty" aria-hidden="true">
				<li><span class="slot-art"></span><span class="hollow">Empty slot</span></li>
			</ul>
			<p class="muted">Your saves appear here, on any device with your GM key.</p>
		{/if}
		{#if saves?.length}
			<ul class="saved" aria-label="Your saves">
				{#each saves as scene, i (scene.id)}
					<li style:--i={i}>
						<span class="slot-art"
							><Icon name={scene.auto ? 'refresh' : 'save'} size="1.1em" /></span
						>
						<span class="info">
							<span class="name">
								{scene.auto ? (scene.story?.title ?? scene.name) : scene.name}{#if scene.auto}<span
										class="auto"
									>
										· autosave</span
									>{/if}
							</span>
							<span class="when">
								{lastPlayed(scene.savedAt)}{scene.story
									? ` · ${scene.story.chapter}, ${scene.story.location}`
									: ''}
							</span>
						</span>
						<button
							type="button"
							class:danger={confirming === scene.id}
							onclick={() => load(scene.id)}
							onblur={() => confirming === scene.id && (confirming = null)}
						>
							{confirming === scene.id ? 'Replace table?' : 'Load'}
						</button>
						<button
							type="button"
							class="ghost forget"
							class:danger={deleting === scene.id}
							aria-label={`Delete ${scene.name}`}
							title={deleting === scene.id ? 'Click again to delete for good' : 'Delete this save'}
							onclick={() => remove(scene)}
							onblur={() => deleting === scene.id && (deleting = null)}
							><Icon name="trash" size="1.1em" /></button
						>
					</li>
				{/each}
			</ul>
		{/if}
		{#if older.length > 0}
			<p class="muted">Older saves in this browser</p>
			<ul class="saved" aria-label="Older saves in this browser">
				{#each older as scene (scene.sceneId)}
					<li>
						<span class="slot-art"><Icon name="save" size="1.1em" /></span>
						<span class="info">
							<span class="name">{scene.name}</span>
							<span class="when">{date.format(new Date(scene.savedAt))}</span>
						</span>
						<button
							type="button"
							class:danger={confirming === scene.sceneId}
							onclick={() => load(scene.sceneId)}
							onblur={() => confirming === scene.sceneId && (confirming = null)}
						>
							{confirming === scene.sceneId ? 'Replace table?' : 'Load'}
						</button>
						<button
							type="button"
							class="ghost forget"
							aria-label={`Forget ${scene.name}`}
							title="Forget (the save stays on the server)"
							onclick={() => forget(scene)}><Icon name="close" size="1.1em" /></button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</Tray>

	<Tray title="Tables and files" icon="map">
		<div class="files">
			<ToolSlot icon="save" label="Export file" onclick={exportFile} />
			<ToolSlot icon="upload" label="Import file" onclick={() => fileInput.click()} />
			<ToolSlot icon="link" label="Share table" onclick={share} />
			<ToolSlot
				icon="plus"
				label="New table"
				expanded={creating}
				onclick={() => (creating = !creating)}
			/>
			<input
				bind:this={fileInput}
				type="file"
				accept=".json,application/json"
				hidden
				onchange={importFile}
			/>
		</div>

		{#if pendingImport}
			<div class="confirm" role="alert">
				<p>
					<Icon name="warn" size="1.1em" /> Replace this table with “{pendingImport.name}”? Save
					first to keep what’s here.
				</p>
				<div class="row">
					<button type="button" class="danger" onclick={confirmImport}>Replace table</button>
					<button type="button" class="ghost" onclick={() => (pendingImport = null)}>Cancel</button>
				</div>
			</div>
		{/if}

		{#if shared}
			<div class="shared" role="status">
				<p class="muted">
					Anyone with this link opens a copy of “{shared.name}” (the table, not the story or who
					played whom):
				</p>
				<div class="row">
					<input
						readonly
						value={shared.link}
						aria-label="Shared table link"
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button type="button" onclick={copyLink}
						><Icon name="copy" /> {copied ? 'Copied' : 'Copy'}</button
					>
				</div>
			</div>
		{/if}

		{#if creating}
			{#await import('./NewTable.svelte') then { default: NewTable }}
				<NewTable {send} {onError} onDone={() => (creating = false)} />
			{/await}
		{/if}

		<form class="open" onsubmit={openShared}>
			<input
				bind:value={openCode}
				placeholder="Shared table link or code"
				aria-label="Shared table link or code"
			/>
			<button type="submit" title="Opens a copy of the shared table in place of this one">
				Open
			</button>
		</form>
	</Tray>
</section>

<style>
	.scene {
		display: grid;
		gap: var(--sp-5);
	}

	.confirm {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid rgba(226, 122, 107, 0.55);
		border-radius: var(--radius-md);
		background: rgba(67, 32, 26, 0.35);
	}

	.confirm p {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-3);
		margin: 0;
		font-size: var(--fs-sm);
		color: #ffd7cf;
	}

	.save {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-4);
	}

	.save button,
	.shared button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}

	/* A save is a slot: a little plate with an icon, its name and when, and what you can do. */
	.saved {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
		max-height: 12rem;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: var(--sp-3) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.6),
			inset 0 0 0 1px var(--gilt-line);
	}

	.saved:not(.loading):not(.empty) li {
		animation: g-rise 380ms var(--ease-out) calc(var(--i, 0) * 60ms) backwards;
	}

	.slot-art {
		flex: none;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--wood-grad);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--gilt);
	}

	.loading li .bar {
		flex: 1;
		height: 0.7rem;
		border-radius: 999px;
		background: linear-gradient(
				90deg,
				rgba(255, 238, 214, 0.06),
				rgba(255, 238, 214, 0.16),
				rgba(255, 238, 214, 0.06)
			)
			0 0 / 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}

	.loading li .bar.short {
		flex: 0 0 55%;
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	.empty li {
		border-style: dashed;
		background: transparent;
		box-shadow: none;
		opacity: 0.8;
	}

	.hollow {
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.info {
		flex: 1;
		min-width: 0;
		display: grid;
	}

	.name,
	.when {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name {
		font-size: var(--fs-sm);
	}

	.auto {
		color: var(--muted);
		font-size: var(--fs-2xs);
	}

	.when {
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	li button {
		min-height: 2rem;
		padding: var(--sp-2) var(--sp-4);
		font-size: var(--fs-xs);
	}

	li button.forget {
		padding-inline: var(--sp-3);
	}

	.muted {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.files {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--sp-3);
	}

	.shared .row,
	.confirm .row,
	.open {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-4);
	}

	.shared {
		display: grid;
		gap: var(--sp-3);
	}

	.shared input,
	.open input {
		min-width: 0;
		font-size: var(--fs-xs);
	}

	@media (max-width: 48rem) {
		li button {
			min-height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading li .bar,
		.saved li {
			animation: none;
		}
	}
</style>
