<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { EVIDENCE_KINDS, OBJECT_STATES, type ObjectState } from '$lib/adventure/adventure';
	import { CHARACTERS, CHARACTER_IDS, STATS } from '$lib/adventure/characters';
	import type { ObjectDef } from '$lib/adventure/define';
	import { exampleAdventure } from '$lib/adventure/example';
	import {
		ADVENTURE_FILE_FORMAT,
		ADVENTURE_FILE_MAX_BYTES,
		ADVENTURE_FILE_VERSION,
		loadAdventureFile,
		parseAdventureFile
	} from '$lib/adventure/file';
	import { play as playSound } from '$lib/audio/engine';
	import { loadManifest } from '$lib/assets/load';
	import { NAME_MAX_LENGTH } from '$lib/game/names';
	import { parseSceneFile, SCENE_FILE_MAX_BYTES } from '$lib/game/scene-file';
	import CellsInput from '$lib/builder/CellsInput.svelte';
	import Diagnostics from '$lib/ui/Diagnostics.svelte';
	import { validateOnServer } from '$lib/net/library';
	import type { Diagnostic, Validation } from '$lib/validation/diagnostics';
	import type { AdventurePreview } from '$lib/adventure/preview';
	import {
		flowOf,
		formatArea,
		formatCell,
		idFrom,
		idsOf,
		loadDraft,
		toDraft,
		type Draft,
		newTable,
		parseArea,
		parseCell,
		renameKey,
		storeDraft
	} from '$lib/builder/draft';
	import EffectsEditor from '$lib/builder/EffectsEditor.svelte';
	import { DND_ABILITIES, DND_SKILLS } from '$lib/rules/dnd55e/terms';
	import { FATE_SKILLS } from '$lib/rules/fate/core';
	import ListInput from '$lib/builder/ListInput.svelte';
	import RulesEditor from '$lib/builder/RulesEditor.svelte';
	import WhenEditor from '$lib/builder/WhenEditor.svelte';
	import PublishPanel from '$lib/builder/PublishPanel.svelte';
	import { handOff, RoomConnection } from '$lib/net/room-connection.svelte';
	import { loadGmKey, loadName, saveName } from '$lib/prefs';
	import Drawers from '$lib/builder/ui/Drawers.svelte';
	import Empty from '$lib/builder/ui/Empty.svelte';
	import FileButton from '$lib/builder/ui/FileButton.svelte';
	import Panel from '$lib/builder/ui/Panel.svelte';
	import Roster, { type RosterItem } from '$lib/builder/ui/Roster.svelte';
	import TableMap from '$lib/builder/ui/TableMap.svelte';
	import { Backdrop, Banner, Frame, Icon, Portrait } from '$lib/ui/game';
	import Steps, { type TrackStep } from '$lib/ui/Steps.svelte';

	let draft = $state<Draft>(loadDraft());
	/** The draft plays by Fate Condensed (milestone 60): checks are overcomes with its skills. */
	const fate = $derived(draft.rules?.id === 'fate-condensed');

	// Kept in this browser as it is edited (a moment after each change).
	$effect(() => {
		const snapshot = $state.snapshot(draft) as Draft;
		const timer = setTimeout(() => storeDraft(snapshot), 400);
		return () => clearTimeout(timer);
	});

	/** Everything wrong with the draft, checked the way the server will check it. */
	const checked = $derived(loadAdventureFile($state.snapshot(draft), 'draft'));
	const problems = $derived(checked.ok ? [] : checked.diagnostics);

	/** The server's own check of the draft (milestone 56), asked for by the creator. */
	let serverCheck = $state<
		| { state: 'asking' }
		| { state: 'done'; validation: Validation; preview: AdventurePreview | null; of: string }
		| { state: 'failed'; error: string }
		| null
	>(null);
	async function checkOnServer() {
		serverCheck = { state: 'asking' };
		const file = $state.snapshot(draft);
		try {
			const { validation, preview } = await validateOnServer('adventure', file, loadGmKey());
			serverCheck = { state: 'done', validation, preview, of: JSON.stringify(file) };
		} catch (err) {
			serverCheck = { state: 'failed', error: (err as Error).message };
		}
	}
	/** Whether the server's answer is about the draft as it is now. */
	const serverCurrent = $derived(
		serverCheck?.state === 'done' && serverCheck.of === JSON.stringify($state.snapshot(draft))
	);
	const ids = $derived(idsOf(draft));
	const flow = $derived(flowOf(draft));
	const rewards = $derived.by(() => {
		const found: string[] = [];
		JSON.stringify(draft, (k, v) => {
			if (k === 'reward' && typeof v === 'string' && v && !found.includes(v)) found.push(v);
			return v;
		});
		return found;
	});

	const SECTIONS = [
		['overview', 'Overview'],
		['rules', 'Rules & party'],
		['scenes', 'Scenes'],
		['flow', 'Flow'],
		['people', 'People'],
		['fights', 'Fights'],
		['things', 'Things & triggers'],
		['choices', 'Choices & endings'],
		['check', 'Check'],
		['publish', 'Publish'],
		['json', 'File']
	] as const;
	let section = $state<(typeof SECTIONS)[number][0]>('overview');

	/** Which of its drawers each part has open, and which plate is chosen on each shelf. */
	let drawer = $state({
		flow: 'chapters',
		people: 'people',
		fights: 'enemies',
		things: 'things',
		choices: 'choices'
	});
	let pick = $state<Record<string, string | undefined>>({});

	function go(id: string) {
		section = id as typeof section;
		document.querySelector('.rail')?.scrollIntoView({ block: 'nearest' });
	}

	const endingsReady = $derived.by(() => {
		const answers = draft.decisions[draft.endings.decision]?.options ?? [];
		return answers.length > 0 && answers.every((o) => draft.endings.byAnswer[o.id]);
	});

	/** What the story needs before it can be played, ticked off as it is met. */
	const checklist = $derived([
		{ done: draft.title.trim().length > 0, text: 'The adventure has a title' },
		{ done: draft.characters.length > 0, text: 'Players can choose at least one character' },
		{ done: ids.locations.length > 0, text: 'There is a place to start in' },
		{ done: ids.chapters.length > 0, text: 'There is a chapter to play' },
		{
			done: draft.start.location in draft.locations && draft.start.chapter in draft.chapters,
			text: 'It starts at a real place, in a real chapter'
		},
		{
			done: endingsReady,
			text: 'Every answer to the choice that decides the ending has an ending'
		},
		{ done: problems.length === 0, text: 'The table’s own check finds nothing wrong' }
	]);

	/** The quest track: a stop is done once something is written in it. */
	const rail = $derived.by<TrackStep[]>(() => {
		const filled: Record<string, boolean> = {
			overview: !!draft.title.trim() && !!draft.about.trim() && draft.characters.length > 0,
			rules: Object.keys(draft.party ?? {}).length > 0,
			scenes: ids.locations.length > 0,
			flow: ids.chapters.length > 0 && ids.events.length > 0,
			people: ids.npcs.length > 0,
			fights: ids.encounters.length > 0,
			things: draft.objects.length > 0 || ids.clues.length > 0,
			choices: ids.decisions.length > 0 && Object.keys(draft.endings.names).length > 0,
			check: problems.length === 0,
			json: false
		};
		return SECTIONS.map(([id, label]) => {
			if (id === 'publish') {
				return problems.length
					? { id, label, state: 'sealed', hint: 'sealed until the story is ready' }
					: { id, label, state: 'todo', hint: 'ready to seal' };
			}
			if (id === 'check') {
				return problems.length
					? { id, label, state: 'todo', hint: `${problems.length} to fix`, flag: problems.length }
					: { id, label, state: 'done', hint: 'nothing wrong' };
			}
			return filled[id]
				? { id, label, state: 'done', hint: 'filled in' }
				: { id, label, state: 'todo', hint: 'nothing here yet' };
		});
	});

	let models = $state<{ npc: string[]; enemy: string[]; environments: [string, string][] }>({
		npc: [],
		enemy: [],
		environments: []
	});
	$effect(() => {
		void loadManifest().then((m) => {
			const of = (kind: string) =>
				Object.entries(m.models)
					.filter(([, x]) => x.kind === kind)
					.map(([id]) => id);
			models = {
				npc: of('npc'),
				enemy: of('enemy'),
				environments: Object.entries(m.environments).map(([id, e]) => [id, e.name])
			};
		});
	});

	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	$effect(() => {
		if (error) playSound([{ kind: 'ui', sound: 'error' }]);
		else if (notice) playSound([{ kind: 'ui', sound: 'notice' }]);
	});

	// ---------------------------------------------------------------------
	// Files

	function exportFile() {
		const blob = new Blob([JSON.stringify($state.snapshot(draft), null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${idFrom(draft.title)}.thirdfold-adventure.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function readJson(file: File, max: number): Promise<unknown> {
		if (file.size > max) throw new Error('That file is too large.');
		try {
			return JSON.parse(await file.text());
		} catch {
			throw new Error('That file is not JSON.');
		}
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const parsed = parseAdventureFile(await readJson(file, ADVENTURE_FILE_MAX_BYTES));
			if (!parsed.ok) throw new Error(`That is not a thirdfold adventure: ${parsed.error}.`);
			draft = toDraft(parsed.file);
			error = null;
			notice = `Opened “${parsed.file.title}”.`;
		} catch (err) {
			error = (err as Error).message;
		}
	}

	/** Brings a table built and exported at a table (Scene panel → Export file) into a location. */
	async function importTable(location: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const parsed = parseSceneFile(await readJson(file, SCENE_FILE_MAX_BYTES));
			if (!parsed.ok) throw new Error(`That is not a thirdfold table: ${parsed.error}`);
			draft.locations[location].scene = { ...parsed.scene, adventure: null, discovery: {} };
			error = null;
			notice = `The ${draft.locations[location].name} table is now “${parsed.scene.name}”.`;
		} catch (err) {
			error = (err as Error).message;
		}
	}

	function startOver() {
		if (!confirm('Start over from the example adventure? This draft will be replaced.')) return;
		draft = toDraft(exampleAdventure());
	}

	async function dndTemplate() {
		if (!confirm('Start from the fifth edition template? This draft will be replaced.')) return;
		// Loaded when asked for: the template and its party's choices stay out of the page.
		const { dndExampleAdventure } = await import('$lib/adventure/dnd-example');
		draft = toDraft(dndExampleAdventure());
		section = 'rules';
	}

	async function fateTemplate() {
		if (!confirm('Start from the Fate Condensed template? This draft will be replaced.')) return;
		const { fateExampleAdventure } = await import('$lib/adventure/fate-example');
		draft = toDraft(fateExampleAdventure());
		section = 'rules';
	}

	/** The tray of starting points: it opens under its button and closes when one is chosen. */
	let templates = $state<HTMLDetailsElement>();
	function templatesToggled() {
		playSound([{ kind: 'ui', sound: templates?.open ? 'open' : 'close' }]);
	}
	function fromTemplate(start: () => unknown) {
		if (templates) templates.open = false;
		void start();
	}

	function blank() {
		if (!confirm('Start a new, empty adventure? This draft will be replaced.')) return;
		draft = {
			format: ADVENTURE_FILE_FORMAT,
			version: ADVENTURE_FILE_VERSION,
			title: 'A new adventure',
			about: '',
			characters: [...CHARACTER_IDS],
			start: { location: 'start', chapter: 'beginning', arrival: [] },
			locations: {
				start: {
					name: 'The start',
					welcome: 'Where it begins.',
					spawn: [
						{ x: 1, y: 1 },
						{ x: 2, y: 1 }
					],
					scene: newTable('The start')
				}
			},
			areas: [],
			chapters: {
				beginning: {
					title: 'The beginning',
					location: 'start',
					objectives: [{ id: 'finish', text: 'See it through', done: 'finished' }],
					next: { on: 'finished', to: null }
				}
			},
			events: { finished: { label: 'It is finished' } },
			decisions: {
				end: {
					prompt: 'How does it end?',
					options: [{ id: 'well', label: 'Well', does: [{ event: 'finished' }] }]
				}
			},
			endings: {
				decision: 'end',
				fallback: 'well',
				names: { good: { title: 'The End' } },
				byAnswer: {
					well: {
						ending: 'good',
						subtitle: 'It ended well',
						headline: 'It ended well',
						text: 'And so it ended.',
						scene: 'The table, quiet.',
						cue: 'flash',
						result: []
					}
				}
			},
			npcs: {},
			peoplePlaces: [],
			reactions: [],
			objects: [],
			signs: [],
			clues: {},
			mechanisms: {},
			enemies: {},
			encounters: {},
			cues: []
		};
	}

	// ---------------------------------------------------------------------
	// Play it

	let playName = $state(loadName());
	let playing = $state(false);

	/** What the server found when it refused to play the draft. */
	let playFound = $state<Diagnostic[]>([]);

	/** Opens a new table as its GM and starts this adventure there. */
	async function play() {
		const name = playName.trim();
		if (!name) return (error = 'Enter your name to play it.');
		if (!checked.ok) return (error = 'Fix the problems first (see Check).');
		error = null;
		playFound = [];
		playing = true;
		saveName(name);
		const gmKey = loadGmKey();
		const conn = new RoomConnection({ type: 'create', name, ...(gmKey ? { gmKey } : {}) });
		try {
			await conn.ready();
			conn.send({ type: 'adventure_start', file: $state.snapshot(draft) });
			for (let i = 0; i < 100 && !conn.room?.adventure && !conn.actionError; i++) {
				await new Promise((r) => setTimeout(r, 50));
			}
			if (conn.actionError) {
				// The server checked it again before play: show what it found, with Check.
				playFound = conn.actionError.diagnostics ?? [];
				throw new Error(conn.actionError.message);
			}
			if (!conn.room?.adventure) throw new Error('The table did not start the adventure.');
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room.id }));
		} catch (err) {
			conn.close();
			error = (err as Error).message;
		} finally {
			playing = false;
		}
	}

	// ---------------------------------------------------------------------
	// Editing helpers

	function rename<K extends keyof Draft>(part: K, from: string, raw: string) {
		const to = raw.trim();
		if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(to)) {
			error = 'Ids are lower case letters, digits, - and _.';
			return;
		}
		draft[part] = renameKey(draft[part] as Record<string, unknown>, from, to) as Draft[K];
		if (pick[part] === from) pick[part] = to;
	}

	function remove<K extends keyof Draft>(part: K, key: string) {
		const next = { ...(draft[part] as Record<string, unknown>) };
		delete next[key];
		draft[part] = next as Draft[K];
	}

	/** Puts a new entry in a record and returns its id (so its plate can be chosen). */
	function add<R extends Record<string, unknown>>(record: R, name: string, value: R[string]) {
		const key = idFrom(name, Object.keys(record));
		(record as Record<string, unknown>)[key] = value;
		return key;
	}

	function moveChapter(key: string, by: number) {
		const entries = Object.entries(draft.chapters);
		const i = entries.findIndex(([k]) => k === key);
		const [item] = entries.splice(i, 1);
		entries.splice(Math.max(0, Math.min(entries.length, i + by)), 0, item);
		draft.chapters = Object.fromEntries(entries);
	}

	const cellValue = (c: { x: number; y: number }) => formatCell(c);
	const setCell = (raw: string, apply: (c: { x: number; y: number }) => void) => {
		const c = parseCell(raw);
		if (c) apply(c);
	};
	const setArea = (
		raw: string,
		apply: (a: { from: { x: number; y: number }; to: { x: number; y: number } }) => void
	) => {
		const a = parseArea(raw);
		if (a) apply(a);
	};
	const propsOf = (location: string) =>
		draft.locations[location]?.scene.props.map((p) => p.id) ?? [];
	const thingOf = (o: ObjectDef) =>
		'prop' in o.thing ? 'prop' : 'door' in o.thing ? 'door' : 'token';
	const toggle = (list: string[], item: string, on: boolean) =>
		on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

	// The whole file, as text, for what the forms don't cover.
	let jsonText = $state('');
	$effect(() => {
		if (section === 'json') jsonText = JSON.stringify($state.snapshot(draft), null, 2);
	});

	function applyJson() {
		let raw: unknown;
		try {
			raw = JSON.parse(jsonText);
		} catch {
			error = 'That is not valid JSON.';
			return;
		}
		const parsed = parseAdventureFile(raw);
		if (!parsed.ok) {
			error = `That is not a valid adventure file: ${parsed.error}.`;
			return;
		}
		draft = toDraft(parsed.file);
		error = null;
		notice = 'Applied.';
	}

	// ---------------------------------------------------------------------
	// The shelves: what each drawer lists

	const placeName = (l: string) => draft.locations[l]?.name ?? l;
	const locationShelf = $derived<RosterItem[]>(
		Object.entries(draft.locations).map(([key, l]) => ({
			key,
			label: l.name,
			sub: `${l.scene.grid.width}×${l.scene.grid.height} table`
		}))
	);
	const chapterShelf = $derived<RosterItem[]>(
		Object.entries(draft.chapters).map(([key, c], n) => ({
			key,
			label: c.title,
			sub: `at ${placeName(c.location)}`,
			order: n + 1
		}))
	);
	const eventShelf = $derived<RosterItem[]>(
		Object.entries(draft.events).map(([key, e]) => ({ key, label: e.label, sub: key }))
	);
	const npcShelf = $derived<RosterItem[]>(
		Object.entries(draft.npcs).map(([key, n]) => ({
			key,
			label: n.name,
			sub: n.role,
			color: n.color
		}))
	);
	const enemyShelf = $derived<RosterItem[]>(
		Object.entries(draft.enemies).map(([key, e]) => ({
			key,
			label: e.name,
			sub: e.behavior,
			color: e.color,
			foe: true
		}))
	);
	const encounterShelf = $derived<RosterItem[]>(
		Object.entries(draft.encounters).map(([key, e]) => ({
			key,
			label: e.name,
			sub: e.foes.map((f) => draft.enemies[f.kind]?.name ?? f.kind).join(', ') || 'no foes yet'
		}))
	);
	const objectShelf = $derived<RosterItem[]>(
		draft.objects.map((o, i) => ({
			key: String(i),
			label: o.name,
			sub: `${o.kind} at ${placeName(o.location)}`
		}))
	);
	const clueShelf = $derived<RosterItem[]>(
		Object.entries(draft.clues).map(([key, c]) => ({
			key,
			label: c.title,
			sub: EVIDENCE_KINDS[c.kind]
		}))
	);
	const decisionShelf = $derived<RosterItem[]>(
		Object.entries(draft.decisions).map(([key, d]) => ({ key, label: d.prompt, sub: key }))
	);

	/** The count of each thing, for the Check part's glance. */
	const glance = $derived([
		['map', ids.locations.length, 'places'],
		['flag', ids.chapters.length, 'chapters'],
		['bell', ids.events.length, 'events'],
		['user', ids.npcs.length, 'people'],
		['key', draft.objects.length, 'things'],
		['eye', ids.clues.length, 'clues'],
		['sword', ids.encounters.length, 'fights'],
		['scroll', ids.decisions.length, 'choices'],
		['crown', Object.keys(draft.endings.names).length, 'endings']
	] as const);
</script>

<svelte:head>
	<title>Adventure builder · thirdfold</title>
</svelte:head>

{#snippet datalist(id: string, items: readonly string[])}
	<datalist {id}>
		{#each items as item (item)}<option value={item}></option>{/each}
	</datalist>
{/snippet}
{@render datalist('ids-events', ids.events)}
{@render datalist('ids-clues', ids.clues)}
{@render datalist('ids-chapters', ids.chapters)}
{@render datalist('ids-objects', ids.objects)}
{@render datalist('ids-npcs', ids.npcs)}
{@render datalist('ids-decisions', ids.decisions)}
{@render datalist('ids-encounters', ids.encounters)}
{@render datalist('ids-locations', ids.locations)}
{@render datalist('ids-enemies', ids.enemies)}
{@render datalist('ids-lights', ids.lights)}
{@render datalist('ids-props', ids.props)}

{#snippet head(title: string, lede: string)}
	<div class="sect-head">
		<Banner level={2} class="sect-banner">{title}</Banner>
		<p class="lede">{lede}</p>
	</div>
{/snippet}

<svelte:window
	onpointerdown={(e) => {
		if (templates?.open && !templates.contains(e.target as Node)) templates.open = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && templates?.open) {
			templates.open = false;
			templates.querySelector('summary')?.focus();
		}
	}}
/>

<Backdrop variant="workshop" />

<div class="builder">
	<header class="bar">
		<Frame variant="iron" as="div">
			<div class="bar-in">
				<div class="who">
					<a class="home" href={resolve('/')}><Icon name="home" size="1.1em" />thirdfold</a>
					<div class="titles">
						<h1>Adventure builder</h1>
						<p class="working">
							<Icon name="pencil" size="0.95em" /><span>{draft.title || 'Untitled'}</span>
						</p>
						<div class="status">
							{#if problems.length}
								<button type="button" class="fix" onclick={() => go('check')}>
									<Icon name="warn" size="1.05em" />{problems.length} to fix
								</button>
							{:else}
								<span class="g-tag"><Icon name="check" size="1em" />Ready to play</span>
							{/if}
						</div>
					</div>
				</div>
				<div class="hotbar" role="group" aria-label="Your draft">
					<button type="button" onclick={blank}><Icon name="plus" size="1em" />New</button>
					<details class="templates" bind:this={templates} ontoggle={templatesToggled}>
						<summary><Icon name="book" size="1em" />Start from</summary>
						<div class="tray" role="group" aria-label="Start from a template">
							<button type="button" onclick={() => fromTemplate(startOver)}
								><Icon name="book" size="1em" />Example</button
							>
							<button type="button" onclick={() => fromTemplate(dndTemplate)}
								><Icon name="d20" size="1em" />D&amp;D template</button
							>
							<button type="button" onclick={() => fromTemplate(fateTemplate)}
								><Icon name="dice" size="1em" />Fate template</button
							>
						</div>
					</details>
					<FileButton label="Open file" onchange={importFile} />
					<button type="button" onclick={exportFile}
						><Icon name="save" size="1em" />Save file</button
					>
				</div>
				<div class="play-slot">
					<input
						class="name"
						aria-label="Your name"
						placeholder="Your name"
						maxlength={NAME_MAX_LENGTH}
						bind:value={playName}
					/>
					<button class="primary" type="button" disabled={playing} onclick={play}>
						<Icon name="play" size="1em" />{playing ? 'Opening…' : 'Play it'}
					</button>
				</div>
			</div>
		</Frame>
	</header>

	{#if error}
		<div class="note bad g-pop" role="alert">
			<Icon name="warn" size="1.3em" />
			<p>{error}</p>
			<button type="button" class="ghost" aria-label="Dismiss" onclick={() => (error = null)}
				><Icon name="close" size="1em" /></button
			>
			{#if playFound.length}
				<div class="found"><Diagnostics diagnostics={playFound} /></div>
			{/if}
		</div>
	{/if}
	{#if notice && !error}
		<div class="note good g-pop" role="status">
			<Icon name="check" size="1.3em" />
			<p>{notice}</p>
			<button type="button" class="ghost" aria-label="Dismiss" onclick={() => (notice = null)}
				><Icon name="close" size="1em" /></button
			>
		</div>
	{/if}

	<div class="rail">
		<Frame variant="iron" as="div">
			<Steps steps={rail} active={section} onselect={go} />
		</Frame>
	</div>

	<main class="stage">
		{#key section}
			<div class="sect g-rise">
				{#if section === 'rules'}
					{@render head(
						'Rules & party',
						'The rules it plays by, the party they build and the monsters it can use.'
					)}
					{#await import('$lib/builder/RulesSection.svelte') then { default: RulesSection }}
						<RulesSection
							bind:draft
							preview={serverCheck?.state === 'done' ? serverCheck.preview : null}
							current={serverCurrent}
							checking={serverCheck?.state === 'asking'}
							onCheck={checkOnServer}
						/>
					{/await}
				{:else if section === 'overview'}
					{@render head('Overview', 'The title page, who may play, and where it begins.')}
					<div class="split">
						<Panel variant="parchment" title="The title page" icon="book" class="title-page">
							<label class="field">
								<span>Title</span>
								<input class="big" bind:value={draft.title} maxlength="80" />
							</label>
							<label class="field">
								<span>About (for whoever picks it)</span>
								<textarea rows="4" bind:value={draft.about} maxlength="600"></textarea>
							</label>
						</Panel>
						<Panel title="Who may play" icon="users">
							{#if draft.rules}
								<Empty icon="users" title="The rules build the party">
									The party is built by the rules: see Rules &amp; party.
									{#snippet action()}
										<button type="button" onclick={() => go('rules')}>
											<Icon name="wand" size="1em" />Open Rules &amp; party
										</button>
									{/snippet}
								</Empty>
							{:else}
								<fieldset class="cast">
									<legend class="sub">Characters players choose from</legend>
									{#each CHARACTER_IDS as c (c)}
										<label class="tile" class:on={draft.characters.includes(c)}>
											<input
												type="checkbox"
												checked={draft.characters.includes(c)}
												onchange={(e) =>
													(draft.characters = toggle(draft.characters, c, e.currentTarget.checked))}
											/>
											<Portrait name={CHARACTERS[c].name} color={CHARACTERS[c].color} size={40} />
											<span class="words">
												<strong>{CHARACTERS[c].name}</strong>
												<span class="muted">{CHARACTERS[c].tagline}</span>
											</span>
										</label>
									{/each}
								</fieldset>
							{/if}
						</Panel>
					</div>
					<Panel title="Where it begins" icon="flag">
						<div class="grid2">
							<label class="field">
								<span>It starts at</span>
								<select bind:value={draft.start.location}>
									{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
										>{/each}
								</select>
							</label>
							<label class="field">
								<span>In the chapter</span>
								<select bind:value={draft.start.chapter}>
									{#each ids.chapters as c (c)}<option value={c}>{draft.chapters[c].title}</option
										>{/each}
								</select>
							</label>
						</div>
						<h3 class="sub">When the GM begins</h3>
						<EffectsEditor bind:effects={draft.start.arrival} label="Arrival" />
					</Panel>
					<Panel variant="parchment" title="Read-aloud passages for the GM" icon="scroll">
						{#if draft.cues.length === 0}
							<Empty icon="scroll" title="Nothing to read aloud yet">
								A passage is a few lines the GM can read to the table at the right moment.
							</Empty>
						{/if}
						{#each draft.cues as cue, i (i)}
							<div class="well">
								<div class="grid2">
									<input aria-label="Passage id" bind:value={cue.id} />
									<input aria-label="Passage title" bind:value={cue.title} />
								</div>
								<textarea aria-label="Passage text" rows="3" bind:value={cue.text}></textarea>
								<div class="row">
									<button
										type="button"
										onclick={() => (draft.cues = draft.cues.filter((_, j) => j !== i))}
										><Icon name="trash" size="1em" />Remove</button
									>
								</div>
							</div>
						{/each}
						<div class="foot">
							<button
								type="button"
								onclick={() =>
									draft.cues.push({
										id: idFrom(
											'passage',
											draft.cues.map((c) => c.id)
										),
										title: 'A passage',
										text: '…'
									})}
							>
								<Icon name="plus" size="1em" />Add a passage
							</button>
						</div>
					</Panel>
				{:else if section === 'scenes'}
					{@render head('Scenes', 'Each place is a table the party will stand at.')}
					<p class="hint-line">
						Build one at a table (Scene panel: New table, floors, walls, props, lights), export it
						with Export file, and bring it in here.
					</p>
					<Roster
						items={locationShelf}
						bind:selected={pick.locations}
						icon="map"
						label="Places"
						addLabel="Add a place"
						emptyTitle="No places yet"
						onadd={() =>
							(pick.locations = add(draft.locations, 'place', {
								name: 'A new place',
								welcome: 'A new place.',
								spawn: [{ x: 1, y: 1 }],
								scene: newTable('A new place')
							}))}
					>
						{#snippet empty()}
							Every adventure starts somewhere. A place is a table: the party stands on it, and the
							story happens there.
						{/snippet}
						{#snippet editor(key)}
							{@const loc = draft.locations[key]}
							<Panel title={loc.name} icon="map">
								{#snippet aside()}<code class="idtag">{key}</code>{/snippet}
								<div class="grid3">
									<label class="field">
										<span>Id</span>
										<input
											value={key}
											onchange={(e) => rename('locations', key, e.currentTarget.value)}
										/>
									</label>
									<label class="field">
										<span>Name</span>
										<input bind:value={loc.name} />
									</label>
									<label class="field">
										<span>Party appears at</span>
										<CellsInput label="Spawn cells" bind:value={loc.spawn} />
									</label>
								</div>
								<label class="field">
									<span>Welcome (for a player joining here)</span>
									<input bind:value={loc.welcome} />
								</label>
							</Panel>
							<Panel title="The table" icon="grid">
								<div class="table-card">
									<TableMap
										name={loc.name}
										width={loc.scene.grid.width}
										height={loc.scene.grid.height}
										spawn={loc.spawn}
										props={loc.scene.props}
									/>
									<div class="table-info">
										<p class="table-name">
											Table: <strong>{loc.scene.name}</strong>
										</p>
										<ul class="tokens">
											<li class="g-tag">
												<Icon name="grid" size="1em" />{loc.scene.grid.width}×{loc.scene.grid
													.height}
											</li>
											<li class="g-tag">
												<Icon name="cube" size="1em" />{loc.scene.props.length} props
											</li>
											<li class="g-tag">
												<Icon name="door" size="1em" />{loc.scene.objects.length} walls and doors
											</li>
											<li class="g-tag">
												<Icon name="flame" size="1em" />{loc.scene.lights.length} lights
											</li>
											{#if loc.scene.environment}
												<li class="g-tag">
													<Icon name="compass" size="1em" />{loc.scene.environment}
												</li>
											{/if}
										</ul>
										{#if loc.scene.props.length}
											<p class="hint">Props: {loc.scene.props.map((p) => p.id).join(', ')}</p>
										{/if}
									</div>
								</div>
								<div class="foot">
									<FileButton label="Bring in a table file" onchange={(e) => importTable(key, e)} />
									<button
										type="button"
										onclick={() =>
											(loc.scene = newTable(
												loc.name,
												loc.scene.grid.width,
												loc.scene.grid.height,
												loc.scene.environment
											))}
									>
										<Icon name="refresh" size="1em" />Empty table
									</button>
									<button type="button" class="danger" onclick={() => remove('locations', key)}
										><Icon name="trash" size="1em" />Remove place</button
									>
								</div>
							</Panel>
						{/snippet}
					</Roster>
				{:else if section === 'flow'}
					{@render head('Flow', 'How the story moves from one chapter to the next.')}
					<div class="flow-layout">
						<Panel title="The story’s road" icon="compass" class="road">
							{#if flow.length === 0}
								<p class="hint">No chapters yet. Add one and it will appear here.</p>
							{/if}
							<ol class="flow" aria-label="How the story moves">
								{#each flow as step, i (i)}
									<li class:branch={step.kind === 'branch'}>
										<strong class="node">{draft.chapters[step.from]?.title ?? step.from}</strong>
										<span class="edge"
											><Icon name="chevron" size="0.95em" /> <em>{step.by}</em>
											<Icon name="chevron" size="0.95em" /></span
										>
										<strong class="node"
											>{step.to === null
												? 'the ending'
												: (draft.chapters[step.to]?.title ?? step.to)}</strong
										>
									</li>
								{/each}
							</ol>
						</Panel>
						<Drawers
							label="Parts of the flow"
							bind:active={drawer.flow}
							drawers={[
								{ id: 'chapters', label: 'Chapters', icon: 'flag', count: ids.chapters.length },
								{ id: 'events', label: 'Events', icon: 'bell', count: ids.events.length }
							]}
						>
							{#snippet children(id)}
								{#if id === 'chapters'}
									<p class="hint-line">Chapters, in the order the story plays them.</p>
									<Roster
										items={chapterShelf}
										bind:selected={pick.chapters}
										icon="flag"
										label="Chapters"
										addLabel="Add a chapter"
										emptyTitle="No chapters yet"
										onadd={() =>
											(pick.chapters = add(draft.chapters, 'chapter', {
												title: 'A new chapter',
												location: ids.locations[0] ?? '',
												objectives: [],
												next: { on: ids.events[0] ?? '', to: null }
											}))}
									>
										{#snippet empty()}
											A chapter is one stretch of the story at one place, with things to do and a
											way on.
										{/snippet}
										{#snippet editor(key)}
											{@const ch = draft.chapters[key]}
											{@const n = ids.chapters.indexOf(key)}
											<Panel title="{n + 1}. {ch.title}" icon="flag">
												{#snippet aside()}
													<span class="tools">
														<button type="button" onclick={() => moveChapter(key, -1)}
															>Earlier</button
														>
														<button type="button" onclick={() => moveChapter(key, 1)}>Later</button>
													</span>
												{/snippet}
												<div class="grid3">
													<label class="field">
														<span>Id</span>
														<input
															value={key}
															onchange={(e) => rename('chapters', key, e.currentTarget.value)}
														/>
													</label>
													<label class="field">
														<span>Title</span>
														<input bind:value={ch.title} />
													</label>
													<label class="field">
														<span>Played at</span>
														<select bind:value={ch.location}>
															{#each ids.locations as l (l)}<option value={l}
																	>{draft.locations[l].name}</option
																>{/each}
														</select>
													</label>
												</div>
											</Panel>
											<Panel title="Objectives" icon="check">
												{#if ch.objectives.length === 0}
													<p class="hint">No objectives: the party has nothing to do here yet.</p>
												{/if}
												{#each ch.objectives as o, i (i)}
													<div class="objective well">
														<input aria-label="Objective" bind:value={o.text} />
														<input
															aria-label="Done when (event)"
															list="ids-events"
															placeholder="done when (event)"
															bind:value={o.done}
														/>
														<input
															aria-label="Shown after (event)"
															list="ids-events"
															placeholder="shown after (event)"
															value={o.after ?? ''}
															onchange={(e) => {
																const v = e.currentTarget.value.trim();
																if (v) o.after = v;
																else delete o.after;
															}}
														/>
														<label class="check">
															<input
																type="checkbox"
																checked={!!o.optional}
																onchange={(e) => {
																	if (e.currentTarget.checked) o.optional = true;
																	else delete o.optional;
																}}
															/> optional
														</label>
														<button
															type="button"
															class="ghost icon-only"
															aria-label="Remove objective"
															onclick={() => ch.objectives.splice(i, 1)}
															><Icon name="close" size="1em" /></button
														>
													</div>
												{/each}
												<div class="foot">
													<button
														type="button"
														onclick={() =>
															ch.objectives.push({
																id: idFrom(
																	'objective',
																	ch.objectives.map((o) => o.id)
																),
																text: 'Something to do',
																done: ids.events[0] ?? ''
															})}
													>
														<Icon name="plus" size="1em" />Add an objective
													</button>
												</div>
											</Panel>
											<Panel title="Moves on" icon="chevron">
												<div class="grid2">
													<label class="field">
														<span>When this happens</span>
														<input list="ids-events" bind:value={ch.next.on} />
													</label>
													<label class="field">
														<span>To</span>
														<select
															value={ch.next.to ?? ''}
															onchange={(e) => (ch.next.to = e.currentTarget.value || null)}
														>
															<option value="">The ending</option>
															{#each ids.chapters as c (c)}<option value={c}
																	>{draft.chapters[c].title}</option
																>{/each}
														</select>
													</label>
												</div>
												<h3 class="sub">As the party enters it</h3>
												<EffectsEditor
													bind:effects={() => ch.opening ?? [], (e) => (ch.opening = e)}
													label="Opening"
												/>
												<div class="foot">
													<button
														type="button"
														class="danger"
														onclick={() => remove('chapters', key)}
														><Icon name="trash" size="1em" />Remove chapter</button
													>
												</div>
											</Panel>
										{/snippet}
									</Roster>
								{:else}
									<p class="hint-line">
										What can happen in the story; each can change the table when it does.
									</p>
									<Roster
										items={eventShelf}
										bind:selected={pick.events}
										icon="bell"
										label="Events"
										addLabel="Add an event"
										emptyTitle="No events yet"
										onadd={() =>
											(pick.events = add(draft.events, 'event', { label: 'Something happened' }))}
									>
										{#snippet empty()}
											An event is something that can happen: a door opened, a name spoken. Chapters
											end on events.
										{/snippet}
										{#snippet editor(key)}
											{@const ev = draft.events[key]}
											<Panel title={ev.label} icon="bell">
												{#snippet aside()}<code class="idtag">{key}</code>{/snippet}
												<div class="grid2">
													<label class="field">
														<span>Id</span>
														<input
															value={key}
															onchange={(e) => rename('events', key, e.currentTarget.value)}
														/>
													</label>
													<label class="field">
														<span>Label (for the GM)</span>
														<input bind:value={ev.label} />
													</label>
												</div>
												<h3 class="sub">When it happens</h3>
												<EffectsEditor
													bind:effects={() => ev.does ?? [], (e) => (ev.does = e)}
													label="When it happens"
												/>
												<div class="foot">
													<button type="button" class="danger" onclick={() => remove('events', key)}
														><Icon name="trash" size="1em" />Remove event</button
													>
												</div>
											</Panel>
										{/snippet}
									</Roster>
								{/if}
							{/snippet}
						</Drawers>
					</div>
				{:else if section === 'people'}
					{@render head('People', 'Who lives in the story, what they say, and how they react.')}
					<Drawers
						label="Parts of the cast"
						bind:active={drawer.people}
						drawers={[
							{ id: 'people', label: 'People', icon: 'user', count: ids.npcs.length },
							{ id: 'reactions', label: 'Reactions', icon: 'chat', count: draft.reactions.length }
						]}
					>
						{#snippet children(id)}
							{#if id === 'people'}
								<Roster
									items={npcShelf}
									bind:selected={pick.npcs}
									icon="user"
									label="People"
									addLabel="Add a person"
									emptyTitle="Nobody lives here yet"
									onadd={() =>
										(pick.npcs = add(draft.npcs, 'person', {
											name: 'Someone',
											role: 'Someone who lives here',
											speaker: 'Someone',
											color: '#b08850',
											model: models.npc[0] ?? 'villager',
											location: ids.locations[0] ?? '',
											home: 'Here',
											places: { calm: { x: 2, y: 2 } },
											states: ['calm'],
											lines: [{ id: 'hello', text: 'Hello.' }]
										}))}
								>
									{#snippet empty()}
										People give the party someone to talk to: a miller, a keeper, a stranger with a
										secret.
									{/snippet}
									{#snippet editor(key)}
										{@const npc = draft.npcs[key]}
										<Panel title={npc.name} icon="user">
											{#snippet aside()}
												<Portrait name={npc.name} color={npc.color} size={44} />
											{/snippet}
											<div class="grid3">
												<label class="field"
													><span>Id</span><input
														value={key}
														onchange={(e) => rename('npcs', key, e.currentTarget.value)}
													/></label
												>
												<label class="field"><span>Name</span><input bind:value={npc.name} /></label
												>
												<label class="field"
													><span>Speaker label</span><input bind:value={npc.speaker} /></label
												>
												<label class="field"
													><span>Who they are (for the GM)</span><input
														bind:value={npc.role}
													/></label
												>
												<label class="field">
													<span>Where</span>
													<select bind:value={npc.location}>
														{#each ids.locations as l (l)}<option value={l}
																>{draft.locations[l].name}</option
															>{/each}
													</select>
												</label>
												<label class="field">
													<span>Stands at</span>
													<input
														value={cellValue(npc.places.calm)}
														onchange={(e) =>
															setCell(e.currentTarget.value, (c) => (npc.places.calm = c))}
													/>
												</label>
												<label class="field">
													<span>Figure</span>
													<select bind:value={npc.model}>
														{#each models.npc as m (m)}<option value={m}>{m}</option>{/each}
													</select>
												</label>
												<label class="field"
													><span>Colour</span><input type="color" bind:value={npc.color} /></label
												>
												<label class="field">
													<span>States (the first is where they start)</span>
													<ListInput
														label="States"
														bind:value={() => npc.states, (v) => (npc.states = [...(v ?? [])])}
													/>
												</label>
											</div>
										</Panel>
										<Panel variant="parchment" title="What they say" icon="chat">
											<p class="hint">Dialogue: the first line that applies is said.</p>
											{#each npc.lines as line, i (i)}
												<div class="well">
													<div class="grid3">
														<input aria-label="Line id" bind:value={line.id} />
														<label class="check">
															<input
																type="checkbox"
																checked={!!line.once}
																onchange={(e) =>
																	e.currentTarget.checked ? (line.once = true) : delete line.once}
															/> once
														</label>
														<label class="check">
															<input
																type="checkbox"
																checked={!!line.narrated}
																onchange={(e) =>
																	e.currentTarget.checked
																		? (line.narrated = true)
																		: delete line.narrated}
															/> told by the narrator
														</label>
													</div>
													<textarea aria-label="What they say" rows="3" bind:value={line.text}
													></textarea>
													<details class="when">
														<summary><Icon name="wand" size="1.05em" />When</summary>
														<WhenEditor bind:when={line.if} />
													</details>
													<div class="grid3">
														<input
															aria-label="Gives the clue"
															list="ids-clues"
															placeholder="gives the clue"
															value={line.clue ?? ''}
															onchange={(e) =>
																e.currentTarget.value.trim()
																	? (line.clue = e.currentTarget.value.trim())
																	: delete line.clue}
														/>
														<input
															aria-label="Makes happen"
															list="ids-events"
															placeholder="makes an event happen"
															value={line.event ?? ''}
															onchange={(e) =>
																e.currentTarget.value.trim()
																	? (line.event = e.currentTarget.value.trim())
																	: delete line.event}
														/>
														<input
															aria-label="Becomes"
															placeholder="they become (a state)"
															value={line.becomes ?? ''}
															onchange={(e) =>
																e.currentTarget.value.trim()
																	? (line.becomes = e.currentTarget.value.trim())
																	: delete line.becomes}
														/>
													</div>
													<div class="row">
														<button type="button" onclick={() => npc.lines.splice(i, 1)}
															><Icon name="trash" size="1em" />Remove line</button
														>
													</div>
												</div>
											{/each}
											<div class="foot">
												<button
													type="button"
													onclick={() =>
														npc.lines.push({
															id: idFrom(
																'line',
																npc.lines.map((l) => l.id)
															),
															text: '…'
														})}><Icon name="plus" size="1em" />Add a line</button
												>
												<button type="button" class="danger" onclick={() => remove('npcs', key)}
													><Icon name="trash" size="1em" />Remove person</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{:else}
								<Panel title="Reactions" icon="chat">
									<p class="hint">
										A line someone calls out once, when something is done nearby (<code
											>object:verb</code
										>) or happens (<code>event:id</code>).
									</p>
									{#if draft.reactions.length === 0}
										<Empty icon="chat" title="Nobody reacts yet">
											A reaction makes the world answer: a cry when the sack is searched, a gasp
											when the bell rings.
										</Empty>
									{/if}
									{#each draft.reactions as r, i (i)}
										<div class="reaction well">
											<input aria-label="Who" list="ids-npcs" bind:value={r.npc} />
											<input
												aria-label="On"
												placeholder="sack:search or event:asked"
												bind:value={r.on}
											/>
											<input aria-label="What they call out" bind:value={r.text} />
											<button
												type="button"
												class="ghost icon-only"
												aria-label="Remove reaction"
												onclick={() => draft.reactions.splice(i, 1)}
												><Icon name="close" size="1em" /></button
											>
										</div>
									{/each}
									<div class="foot">
										<button
											type="button"
											onclick={() =>
												draft.reactions.push({
													id: idFrom(
														'reaction',
														draft.reactions.map((r) => r.id)
													),
													npc: ids.npcs[0] ?? '',
													on: `event:${ids.events[0] ?? ''}`,
													text: '…'
												})}
										>
											<Icon name="plus" size="1em" />Add a reaction
										</button>
									</div>
								</Panel>
							{/if}
						{/snippet}
					</Drawers>
				{:else if section === 'fights'}
					{@render head('Fights', 'The foes, and the encounters where the party meets them.')}
					<Drawers
						label="Parts of the fights"
						bind:active={drawer.fights}
						drawers={[
							{ id: 'enemies', label: 'Enemies', icon: 'skull', count: ids.enemies.length },
							{ id: 'encounters', label: 'Encounters', icon: 'sword', count: ids.encounters.length }
						]}
					>
						{#snippet children(id)}
							{#if id === 'enemies'}
								<Roster
									items={enemyShelf}
									bind:selected={pick.enemies}
									icon="skull"
									label="Enemies"
									addLabel="Add an enemy"
									emptyTitle="No foes yet"
									onadd={() =>
										(pick.enemies = add(draft.enemies, 'enemy', {
											name: 'A foe',
											model: models.enemy[0] ?? 'hound',
											color: '#8a3b3b',
											armor: 1,
											speed: 5,
											vision: 6,
											light: 0,
											initiative: 0,
											hp: { base: 6, perCharacter: 2 },
											attacks: [{ name: 'Strike', range: 1, toHit: 3, damage: '1d6' }],
											behavior: 'rush'
										}))}
								>
									{#snippet empty()}
										An enemy is a kind of foe: how tough it is, how it fights, what it hits with.
									{/snippet}
									{#snippet editor(key)}
										{@const en = draft.enemies[key]}
										<Panel title={en.name} icon="skull">
											{#snippet aside()}
												<Portrait name={en.name} color={en.color} size={44} foe />
											{/snippet}
											<div class="grid3">
												<label class="field"
													><span>Id</span><input
														value={key}
														onchange={(e) => rename('enemies', key, e.currentTarget.value)}
													/></label
												>
												<label class="field"><span>Name</span><input bind:value={en.name} /></label>
												<label class="field">
													<span>Figure</span>
													<select bind:value={en.model}
														>{#each models.enemy as m (m)}<option value={m}>{m}</option
															>{/each}</select
													>
												</label>
												<label class="field">
													<span>Fights by</span>
													<select bind:value={en.behavior}>
														<option value="rush">Rushing in</option>
														<option value="skirmish">Skirmishing (ranged second attack)</option>
														<option value="guardian">Guarding a post</option>
														<option value="grasp">Grasping (rooted)</option>
													</select>
												</label>
												<label class="field"
													><span>Size on the table</span><input
														type="number"
														min="0.5"
														max="3"
														step="0.1"
														title="1 is a person; 1.5 and up stands on a larger base (one cell all the same)"
														bind:value={
															() => en.scale ?? 1,
															(v) => (en.scale = typeof v === 'number' && v !== 1 ? v : undefined)
														}
													/></label
												>
												<label class="field"
													><span>Colour</span><input type="color" bind:value={en.color} /></label
												>
											</div>
										</Panel>
										<Panel title="Strength" icon="shield">
											<div class="stats">
												<label class="field stat"
													><span><Icon name="heart" size="1em" />Hit points</span><input
														type="number"
														min="1"
														bind:value={en.hp.base}
													/></label
												>
												<label class="field stat"
													><span><Icon name="users" size="1em" />+ per character</span><input
														type="number"
														min="0"
														bind:value={en.hp.perCharacter}
													/></label
												>
												<label class="field stat"
													><span><Icon name="shield" size="1em" />Armor</span><input
														type="number"
														min="0"
														bind:value={en.armor}
													/></label
												>
												<label class="field stat"
													><span><Icon name="chevron" size="1em" />Speed</span><input
														type="number"
														min="0"
														bind:value={en.speed}
													/></label
												>
												<label class="field stat"
													><span><Icon name="eye" size="1em" />Vision</span><input
														type="number"
														min="1"
														bind:value={en.vision}
													/></label
												>
												<label class="field stat"
													><span><Icon name="hourglass" size="1em" />Initiative bonus</span><input
														type="number"
														bind:value={en.initiative}
													/></label
												>
												<label class="field stat"
													><span><Icon name="flame" size="1em" />Light carried</span><input
														type="number"
														min="0"
														bind:value={en.light}
													/></label
												>
											</div>
										</Panel>
										<Panel title="Attacks" icon="sword">
											<p class="hint">The first up close, a second from range.</p>
											{#each en.attacks as a, i (i)}
												<div class="attack well">
													<label class="field"
														><span>Attack</span><input
															aria-label="Attack"
															bind:value={a.name}
														/></label
													>
													<label class="field"
														><span>Range</span><input
															type="number"
															min="1"
															bind:value={a.range}
														/></label
													>
													<label class="field"
														><span>To hit</span><input type="number" bind:value={a.toHit} /></label
													>
													<label class="field"
														><span>Damage</span><input bind:value={a.damage} /></label
													>
													<button
														type="button"
														class="ghost icon-only"
														aria-label="Remove attack"
														onclick={() => en.attacks.splice(i, 1)}
														><Icon name="close" size="1em" /></button
													>
												</div>
											{/each}
											<div class="foot">
												{#if en.attacks.length < 2}
													<button
														type="button"
														onclick={() =>
															en.attacks.push({
																name: 'Strike',
																range: 1,
																toHit: 3,
																damage: '1d6'
															})}><Icon name="plus" size="1em" />Add an attack</button
													>
												{/if}
												<button type="button" class="danger" onclick={() => remove('enemies', key)}
													><Icon name="trash" size="1em" />Remove enemy</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{:else}
								<Roster
									items={encounterShelf}
									bind:selected={pick.encounters}
									icon="sword"
									label="Encounters"
									addLabel="Add an encounter"
									emptyTitle="No fights yet"
									onadd={() =>
										(pick.encounters = add(draft.encounters, 'fight', {
											name: 'A fight',
											location: ids.locations[0] ?? null,
											ring: [{ x: 5, y: 5 }],
											foes: ids.enemies[0] ? [{ kind: ids.enemies[0] }] : []
										}))}
								>
									{#snippet empty()}
										An encounter is a fight: which foes come, where they come up, and what follows
										when it is won.
									{/snippet}
									{#snippet editor(key)}
										{@const enc = draft.encounters[key]}
										<Panel title={enc.name} icon="sword">
											{#snippet aside()}<code class="idtag">{key}</code>{/snippet}
											<div class="grid3">
												<label class="field"
													><span>Id</span><input
														value={key}
														onchange={(e) => rename('encounters', key, e.currentTarget.value)}
													/></label
												>
												<label class="field"><span>Name</span><input bind:value={enc.name} /></label
												>
												<label class="field">
													<span>Fought at</span>
													<select
														value={enc.location ?? ''}
														onchange={(e) => (enc.location = e.currentTarget.value || null)}
													>
														<option value="">Anywhere</option>
														{#each ids.locations as l (l)}<option value={l}
																>{draft.locations[l].name}</option
															>{/each}
													</select>
												</label>
												<label class="field">
													<span>Foes (enemy ids)</span>
													<ListInput
														label="Foes"
														options="ids-enemies"
														bind:value={
															() => enc.foes.map((f) => f.kind),
															(v) => (enc.foes = (v ?? []).map((kind) => ({ kind })))
														}
													/>
												</label>
												<label class="field"
													><span>They come up at</span><CellsInput
														label="Where foes appear"
														bind:value={enc.ring}
													/></label
												>
												<label class="field">
													<span>Shown to all (area)</span>
													<input
														placeholder="x,y to x,y"
														value={enc.reveal ? formatArea(enc.reveal) : ''}
														onchange={(e) =>
															e.currentTarget.value.trim()
																? setArea(e.currentTarget.value, (a) => (enc.reveal = a))
																: delete enc.reveal}
													/>
												</label>
											</div>
										</Panel>
										<Panel
											variant="parchment"
											title="As it begins, and when it is won"
											icon="scroll"
										>
											<label class="field"
												><span>Said as it begins</span><input
													value={enc.opening ?? ''}
													onchange={(e) =>
														e.currentTarget.value.trim()
															? (enc.opening = e.currentTarget.value)
															: delete enc.opening}
												/></label
											>
											<h3 class="sub">When it is won</h3>
											<div class="grid2">
												<label class="field"
													><span>Said</span><input
														value={enc.won?.text ?? ''}
														onchange={(e) =>
															(enc.won = { ...enc.won, text: e.currentTarget.value || undefined })}
													/></label
												>
												<label class="field"
													><span>Makes happen</span><input
														list="ids-events"
														value={enc.won?.event ?? ''}
														onchange={(e) =>
															(enc.won = {
																...enc.won,
																event: e.currentTarget.value.trim() || undefined
															})}
													/></label
												>
											</div>
										</Panel>
										<Panel title="The table changes" icon="flame">
											<EffectsEditor
												bind:effects={
													() => enc.won?.does ?? [], (d) => (enc.won = { ...enc.won, does: d })
												}
												label="Also"
											/>
											<div class="foot">
												<button
													type="button"
													class="danger"
													onclick={() => remove('encounters', key)}
													><Icon name="trash" size="1em" />Remove encounter</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{/if}
						{/snippet}
					</Drawers>
				{:else if section === 'things'}
					{@render head(
						'Things & triggers',
						'What the party can use, where they trip things, what they learn.'
					)}
					<Drawers
						label="Parts of the world"
						bind:active={drawer.things}
						drawers={[
							{ id: 'things', label: 'Things', icon: 'key', count: draft.objects.length },
							{ id: 'areas', label: 'Trigger areas', icon: 'grid', count: draft.areas.length },
							{ id: 'clues', label: 'Clues', icon: 'eye', count: ids.clues.length }
						]}
					>
						{#snippet children(id)}
							{#if id === 'things'}
								<p class="hint-line">
									A thing is a prop on a table (or a door) with states, and verbs characters do to
									it. What a verb does is its rules.
								</p>
								<Roster
									items={objectShelf}
									bind:selected={pick.objects}
									icon="key"
									label="Things to use"
									addLabel="Add a thing"
									emptyTitle="Nothing to use yet"
									onadd={() => {
										draft.objects.push({
											id: idFrom('thing', ids.objects),
											name: 'A thing',
											kind: 'container',
											location: ids.locations[0] ?? '',
											thing: { prop: propsOf(ids.locations[0] ?? '')[0] ?? '' },
											initial: 'interactable',
											states: ['interactable', 'used'],
											verbs: [
												{
													id: 'examine',
													label: 'Examine',
													from: ['interactable'],
													does: [{ do: [{ say: '…' }] }]
												}
											]
										});
										pick.objects = String(draft.objects.length - 1);
									}}
								>
									{#snippet empty()}
										Things make the table playable: a chest to open, a book to read, a door to
										unlock.
									{/snippet}
									{#snippet editor(key)}
										{@const o = draft.objects[Number(key)]}
										{@const i = Number(key)}
										<Panel title={o.name} icon="key">
											{#snippet aside()}<code class="idtag">{o.id}</code>{/snippet}
											<div class="grid3">
												<label class="field"><span>Id</span><input bind:value={o.id} /></label>
												<label class="field"><span>Name</span><input bind:value={o.name} /></label>
												<label class="field">
													<span>Kind</span>
													<select bind:value={o.kind}>
														{#each ['container', 'chest', 'book', 'table', 'torch', 'landmark', 'mechanism', 'item', 'door', 'secret', 'corpse', 'ritual'] as k (k)}<option
																value={k}>{k}</option
															>{/each}
													</select>
												</label>
												<label class="field">
													<span>Where</span>
													<select bind:value={o.location}>
														{#each ids.locations as l (l)}<option value={l}
																>{draft.locations[l].name}</option
															>{/each}
													</select>
												</label>
												<label class="field">
													<span>Which {thingOf(o)} on the map</span>
													{#if thingOf(o) === 'prop'}
														<select
															value={(o.thing as { prop: string }).prop}
															onchange={(e) => (o.thing = { prop: e.currentTarget.value })}
														>
															{#each propsOf(o.location) as p (p)}<option value={p}>{p}</option
																>{/each}
														</select>
													{:else}
														<input
															value={Object.values(o.thing)[0]}
															onchange={(e) =>
																(o.thing = {
																	[thingOf(o)]: e.currentTarget.value.trim()
																} as ObjectDef['thing'])}
														/>
													{/if}
												</label>
												<label class="field">
													<span>Starts</span>
													<select bind:value={o.initial}
														>{#each OBJECT_STATES as s (s)}<option value={s}>{s}</option
															>{/each}</select
													>
												</label>
												<label class="field">
													<span>States the GM may set</span>
													<ListInput
														label="States"
														bind:value={
															() => o.states,
															(v) =>
																(o.states = (v ?? []).filter((s) =>
																	(OBJECT_STATES as readonly string[]).includes(s)
																) as ObjectState[])
														}
													/>
												</label>
											</div>
										</Panel>
										<Panel title="Verbs" icon="wand">
											{#if o.verbs.length === 0}
												<p class="hint">No verbs: nobody can do anything with it yet.</p>
											{/if}
											{#each o.verbs as verb, vi (vi)}
												<div class="well">
													<div class="grid3">
														<label class="field"
															><span>Verb id</span><input bind:value={verb.id} /></label
														>
														<label class="field"
															><span>Label</span><input bind:value={verb.label} /></label
														>
														<label class="field">
															<span>Leaves it</span>
															<select
																value={verb.to ?? ''}
																onchange={(e) =>
																	e.currentTarget.value
																		? (verb.to = e.currentTarget.value as ObjectState)
																		: delete verb.to}
															>
																<option value="">as it was</option>
																{#each OBJECT_STATES as s (s)}<option value={s}>{s}</option>{/each}
															</select>
														</label>
														<label class="field">
															<span>Can be done when it is</span>
															<ListInput
																label="From states"
																bind:value={
																	() => verb.from,
																	(v) =>
																		(verb.from = (v ?? []).filter((s) =>
																			(OBJECT_STATES as readonly string[]).includes(s)
																		) as ObjectState[])
																}
															/>
														</label>
														<label class="field">
															<span
																>{fate
																	? 'Overcome (skill)'
																	: draft.rules
																		? 'Check or saving throw'
																		: 'Check (stat)'}</span
															>
															<select
																value={verb.check?.stat ?? ''}
																onchange={(e) =>
																	e.currentTarget.value
																		? (verb.check = {
																				stat: e.currentTarget.value as never,
																				dc: verb.check?.dc ?? 12,
																				...(verb.check?.save ? { save: true } : {})
																			})
																		: delete verb.check}
															>
																<option value="">none</option>
																{#if fate}
																	{#each FATE_SKILLS as sk (sk.id)}<option value={sk.id}
																			>{sk.name}</option
																		>{/each}
																{:else if draft.rules}
																	<optgroup label="Abilities (a check or a saving throw)">
																		{#each DND_ABILITIES as a (a.id)}<option value={a.id}
																				>{a.name}</option
																			>{/each}
																	</optgroup>
																	<optgroup label="Skills (a check)">
																		{#each DND_SKILLS as sk (sk.id)}<option value={sk.id}
																				>{sk.name}</option
																			>{/each}
																	</optgroup>
																{:else}
																	{#each STATS as st (st.id)}<option value={st.id}>{st.name}</option
																		>{/each}
																{/if}
															</select>
														</label>
														{#if verb.check && draft.rules && !fate && DND_ABILITIES.some((a) => a.id === verb.check?.stat)}
															<label class="check">
																<input
																	type="checkbox"
																	checked={!!verb.check.save}
																	onchange={(e) => {
																		if (e.currentTarget.checked) verb.check!.save = true;
																		else delete verb.check!.save;
																	}}
																/>
																A saving throw
															</label>
														{/if}
														{#if verb.check}
															<label class="field"
																><span>Difficulty</span><input
																	type="number"
																	min="1"
																	max="40"
																	bind:value={verb.check.dc}
																/></label
															>
														{/if}
													</div>
													<RulesEditor
														bind:rules={() => [...(verb.does ?? [])], (r) => (verb.does = r)}
													/>
													<div class="row">
														<button type="button" onclick={() => o.verbs.splice(vi, 1)}
															><Icon name="trash" size="1em" />Remove verb</button
														>
													</div>
												</div>
											{/each}
											<div class="foot">
												<button
													type="button"
													onclick={() =>
														o.verbs.push({
															id: idFrom(
																'use',
																o.verbs.map((v) => v.id)
															),
															label: 'Use',
															from: ['interactable']
														})}><Icon name="plus" size="1em" />Add a verb</button
												>
												<button
													type="button"
													class="danger"
													onclick={() => draft.objects.splice(i, 1)}
													><Icon name="trash" size="1em" />Remove thing</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{:else if id === 'areas'}
								<Panel title="Trigger areas" icon="grid">
									<p class="hint">Walking into an area during a chapter makes an event happen.</p>
									{#if draft.areas.length === 0}
										<Empty icon="grid" title="No trigger areas yet">
											Mark a stretch of the table so that walking into it sets something going.
										</Empty>
									{/if}
									{#each draft.areas as a, i (i)}
										<div class="area well">
											<input
												aria-label="Area"
												placeholder="x,y to x,y"
												value={formatArea(a)}
												onchange={(e) => setArea(e.currentTarget.value, (r) => Object.assign(a, r))}
											/>
											<select aria-label="On the table" bind:value={a.location}
												>{#each ids.locations as l (l)}<option value={l}
														>{draft.locations[l].name}</option
													>{/each}</select
											>
											<select aria-label="During the chapter" bind:value={a.during}
												>{#each ids.chapters as c (c)}<option value={c}
														>{draft.chapters[c].title}</option
													>{/each}</select
											>
											<input aria-label="Makes happen" list="ids-events" bind:value={a.event} />
											<button
												type="button"
												class="ghost icon-only"
												aria-label="Remove area"
												onclick={() => draft.areas.splice(i, 1)}
												><Icon name="close" size="1em" /></button
											>
										</div>
									{/each}
									<div class="foot">
										<button
											type="button"
											onclick={() =>
												draft.areas.push({
													from: { x: 0, y: 0 },
													to: { x: 1, y: 1 },
													location: ids.locations[0] ?? '',
													during: ids.chapters[0] ?? '',
													event: ids.events[0] ?? ''
												})}
										>
											<Icon name="plus" size="1em" />Add an area
										</button>
									</div>
								</Panel>
							{:else}
								<Roster
									items={clueShelf}
									bind:selected={pick.clues}
									icon="eye"
									label="Clues"
									addLabel="Add a clue"
									emptyTitle="No clues yet"
									onadd={() =>
										(pick.clues = add(draft.clues, 'clue', {
											title: 'A clue',
											text: '…',
											kind: 'object'
										}))}
								>
									{#snippet empty()}
										A clue is something the party can find out. Finding one can make an event
										happen.
									{/snippet}
									{#snippet editor(key)}
										{@const clue = draft.clues[key]}
										<Panel title={clue.title} icon="eye">
											{#snippet aside()}<code class="idtag">{key}</code>{/snippet}
											<div class="grid3">
												<label class="field"
													><span>Id</span><input
														value={key}
														onchange={(e) => rename('clues', key, e.currentTarget.value)}
													/></label
												>
												<label class="field"
													><span>Title</span><input bind:value={clue.title} /></label
												>
												<label class="field">
													<span>Kind</span>
													<select bind:value={clue.kind}
														>{#each Object.entries(EVIDENCE_KINDS) as [k, label] (k)}<option
																value={k}>{label}</option
															>{/each}</select
													>
												</label>
											</div>
										</Panel>
										<Panel variant="parchment" title="What it says" icon="scroll">
											<textarea aria-label="What it says" rows="3" bind:value={clue.text}
											></textarea>
											<label class="field">
												<span>Once the party knows it, makes happen</span>
												<input
													list="ids-events"
													value={clue.unlocks ?? ''}
													onchange={(e) =>
														e.currentTarget.value.trim()
															? (clue.unlocks = e.currentTarget.value.trim())
															: delete clue.unlocks}
												/>
											</label>
											<div class="foot">
												<button type="button" class="danger" onclick={() => remove('clues', key)}
													><Icon name="trash" size="1em" />Remove clue</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{/if}
						{/snippet}
					</Drawers>
				{:else if section === 'choices'}
					{@render head('Choices & endings', 'What the party is asked, and how the story ends.')}
					<Drawers
						label="Parts of the ending"
						bind:active={drawer.choices}
						drawers={[
							{ id: 'choices', label: 'Choices', icon: 'scroll', count: ids.decisions.length },
							{
								id: 'endings',
								label: 'Endings',
								icon: 'flag',
								count: Object.keys(draft.endings.names).length
							}
						]}
					>
						{#snippet children(id)}
							{#if id === 'choices'}
								<p class="hint-line">
									A choice is put to the party by an Offer effect; each answer does something (make
									an event happen, go to a chapter, give a reward).
								</p>
								<Roster
									items={decisionShelf}
									bind:selected={pick.decisions}
									icon="scroll"
									label="Choices"
									addLabel="Add a choice"
									emptyTitle="No choices yet"
									onadd={() =>
										(pick.decisions = add(draft.decisions, 'choice', {
											prompt: 'What now?',
											options: []
										}))}
								>
									{#snippet empty()}
										A choice is a question put to the party, with answers that change the story and
										decide how it ends.
									{/snippet}
									{#snippet editor(key)}
										{@const d = draft.decisions[key]}
										<Panel variant="parchment" title="The question" icon="scroll">
											{#snippet aside()}<code class="idtag">{key}</code>{/snippet}
											<div class="grid2 asking">
												<label class="field"
													><span>Id</span><input
														value={key}
														onchange={(e) => rename('decisions', key, e.currentTarget.value)}
													/></label
												>
												<label class="field"
													><span>Question</span><input bind:value={d.prompt} /></label
												>
											</div>
										</Panel>
										<Panel title="The answers" icon="check">
											{#if d.options.length === 0}
												<p class="hint">No answers yet: the party has nothing to choose between.</p>
											{/if}
											{#each d.options as o, i (i)}
												<div class="well">
													<div class="grid2">
														<label class="field"
															><span>Answer id</span><input bind:value={o.id} /></label
														>
														<label class="field"
															><span>Answer</span><input bind:value={o.label} /></label
														>
													</div>
													<EffectsEditor bind:effects={o.does} label="Choosing it" />
													<div class="row">
														<button type="button" onclick={() => d.options.splice(i, 1)}
															><Icon name="trash" size="1em" />Remove answer</button
														>
													</div>
												</div>
											{/each}
											<div class="foot">
												<button
													type="button"
													onclick={() =>
														d.options.push({
															id: idFrom(
																'answer',
																d.options.map((o) => o.id)
															),
															label: 'An answer',
															does: []
														})}><Icon name="plus" size="1em" />Add an answer</button
												>
												<button
													type="button"
													class="danger"
													onclick={() => remove('decisions', key)}
													><Icon name="trash" size="1em" />Remove choice</button
												>
											</div>
										</Panel>
									{/snippet}
								</Roster>
							{:else}
								<Panel title="Which choice ends it" icon="flag">
									<div class="grid2">
										<label class="field">
											<span>The choice that decides the ending</span>
											<select bind:value={draft.endings.decision}
												>{#each ids.decisions as d (d)}<option value={d}>{d}</option>{/each}</select
											>
										</label>
										<label class="field">
											<span>If it was never answered</span>
											<select bind:value={draft.endings.fallback}>
												{#each draft.decisions[draft.endings.decision]?.options ?? [] as o (o.id)}<option
														value={o.id}>{o.label}</option
													>{/each}
											</select>
										</label>
									</div>
								</Panel>
								{#if (draft.decisions[draft.endings.decision]?.options ?? []).length === 0}
									<Empty icon="flag" title="No answers to end on yet">
										Endings follow the answers to the choice that decides them. Give that choice
										some answers in the Choices drawer first.
									</Empty>
								{/if}
								{#each draft.decisions[draft.endings.decision]?.options ?? [] as o (o.id)}
									{@const e = draft.endings.byAnswer[o.id]}
									<Panel
										variant={e ? 'parchment' : 'iron'}
										title="If they answer “{o.label}”"
										icon="flag"
									>
										{#if !e}
											<p class="hint">There is no ending written for this answer yet.</p>
											<div class="foot">
												<button
													type="button"
													class="primary"
													onclick={() =>
														(draft.endings.byAnswer[o.id] = {
															ending: o.id,
															subtitle: '…',
															headline: '…',
															text: '…',
															scene: '…',
															cue: 'flash',
															result: []
														})}
												>
													<Icon name="pencil" size="1em" />Write this ending
												</button>
											</div>
										{:else}
											<div class="grid3">
												<label class="field">
													<span>Ending id</span>
													<input
														value={e.ending}
														onchange={(ev) => {
															const id = ev.currentTarget.value.trim();
															e.ending = id;
															draft.endings.names[id] ??= { title: id };
														}}
													/>
												</label>
												<label class="field">
													<span>Ending’s name</span>
													<input
														value={draft.endings.names[e.ending]?.title ?? ''}
														onchange={(ev) =>
															(draft.endings.names[e.ending] = { title: ev.currentTarget.value })}
													/>
												</label>
												<label class="field"
													><span>Headline</span><input bind:value={e.headline} /></label
												>
												<label class="field"
													><span>Subtitle</span><input bind:value={e.subtitle} /></label
												>
												<label class="field">
													<span>Last moment</span>
													<select bind:value={e.cue}
														><option value="flash">A flash of light</option><option value="toll"
															>A bell tolls</option
														></select
													>
												</label>
											</div>
											<label class="field"
												><span>What happens</span><textarea rows="3" bind:value={e.text}
												></textarea></label
											>
											<label class="field"
												><span>The table, at the last</span><textarea rows="2" bind:value={e.scene}
												></textarea></label
											>
											<h3 class="sub">What came of it</h3>
											{#each e.result as row, i (i)}
												<div class="result well">
													<input aria-label="What" bind:value={row.label} />
													<input aria-label="Became" bind:value={row.value} />
													<button
														type="button"
														class="ghost icon-only"
														aria-label="Remove row"
														onclick={() => e.result.splice(i, 1)}
														><Icon name="close" size="1em" /></button
													>
												</div>
											{/each}
											<div class="row">
												<button
													type="button"
													onclick={() => e.result.push({ label: 'The village', value: '…' })}
													><Icon name="plus" size="1em" />Add a row</button
												>
											</div>
											<h3 class="sub">And the table changes</h3>
											<EffectsEditor
												bind:effects={() => e.does ?? [], (d) => (e.does = d)}
												label="Final changes"
											/>
										{/if}
									</Panel>
								{/each}
							{/if}
						{/snippet}
					</Drawers>
				{:else if section === 'check'}
					{@render head('Check', 'Whether the story can be played, as the table will judge it.')}
					<div class="split">
						{#if problems.length === 0}
							<Panel title="The story is ready" icon="shield" class="verdict ready">
								<p class="ok verdict-line">
									<Icon name="check" size="1.4em" />Nothing wrong: it is ready to play.
								</p>
								<div class="row">
									<button type="button" class="primary" onclick={() => go('publish')}
										><Icon name="crown" size="1em" />On to Publish</button
									>
								</div>
							</Panel>
						{:else}
							<Panel title="The story is not ready" icon="warn" class="verdict unready">
								<p class="verdict-line">
									{problems.length}
									{problems.length === 1 ? 'thing needs' : 'things need'} fixing before it can be played:
								</p>
								<Diagnostics diagnostics={problems} />
							</Panel>
						{/if}
						<Panel title="Before it can be played" icon="check">
							<ul class="checklist">
								{#each checklist as item (item.text)}
									<li class:done={item.done}>
										<span class="box" aria-hidden="true">
											{#if item.done}<Icon name="check" size="1em" />{/if}
										</span>
										<span class="visually-hidden">{item.done ? 'Done:' : 'Not yet:'}</span>
										{item.text}
									</li>
								{/each}
							</ul>
						</Panel>
					</div>
					<Panel title="The game server’s reading" icon="search" class="server-check">
						<p class="hint">
							The server checks it again before any game is played. Ask it now to see what it makes
							of this draft.
						</p>
						<div class="row">
							<button
								type="button"
								disabled={serverCheck?.state === 'asking'}
								onclick={checkOnServer}
							>
								<Icon name="search" size="1em" />Check on the server
							</button>
							{#if serverCheck?.state === 'asking'}
								<span class="muted" role="status">Asking the game server…</span>
							{/if}
						</div>
						{#if serverCheck?.state === 'failed'}
							<p class="verdict-line bad" role="alert">
								<Icon name="warn" size="1.3em" />{serverCheck.error}
							</p>
						{:else if serverCheck?.state === 'done'}
							{@const v = serverCheck.validation}
							<p class="verdict-line" class:ok={v.ok} role="status">
								<Icon name={v.ok ? 'check' : 'warn'} size="1.3em" />
								<span>
									{v.ok
										? 'The server reads it and would play it.'
										: `The server found ${v.diagnostics.length} ${v.diagnostics.length === 1 ? 'problem' : 'problems'}.`}
									<span class="muted small"
										>({v.validator.id} v{v.validator.version}{v.validator.format !== null
											? `, format ${v.validator.format}`
											: ''}){serverCurrent ? '' : ' · the draft has changed since'}</span
									>
								</span>
							</p>
							<Diagnostics diagnostics={v.diagnostics} />
						{/if}
					</Panel>
					<div class="split">
						<Panel title="Rewards the party can earn" icon="crown">
							{#if rewards.length}
								<ul class="tokens">
									{#each rewards as r (r)}<li class="g-tag brass">
											<Icon name="crown" size="1em" />{r}
										</li>{/each}
								</ul>
							{:else}
								<p class="hint">None yet: add a “Give a reward” effect anywhere.</p>
							{/if}
						</Panel>
						<Panel title="At a glance" icon="compass">
							<ul class="glance g-stagger">
								{#each glance as [icon, n, name], i (name)}
									<li style:--i={i}>
										<Icon name={icon} size="1.2em" />
										<span class="n num">{n}</span>
										<span class="what">{name}</span>
									</li>
								{/each}
							</ul>
						</Panel>
					</div>
				{:else if section === 'publish'}
					{@render head('Publish', 'Seal the adventure and send it to the library.')}
					<PublishPanel
						file={() => $state.snapshot(draft)}
						ready={checked.ok}
						title={draft.title}
						oncheck={() => go('check')}
					/>
				{:else if section === 'json'}
					{@render head('File', 'The whole adventure as the file it saves to.')}
					<Panel title="The adventure file" icon="save">
						<p class="hint">
							Everything above, as the file it saves to. Edit it here for what the forms don’t cover
							(mechanisms, signs, phases of a fight, the rules’ own words), then apply.
						</p>
						<textarea class="json" aria-label="Adventure file" rows="28" bind:value={jsonText}
						></textarea>
						<div class="foot">
							<button
								type="button"
								onclick={() => (jsonText = JSON.stringify($state.snapshot(draft), null, 2))}
								><Icon name="refresh" size="1em" />Reload from the forms</button
							>
							<button class="primary" type="button" onclick={applyJson}
								><Icon name="check" size="1em" />Apply</button
							>
						</div>
					</Panel>
				{/if}
			</div>
		{/key}
	</main>
</div>

<style>
	.builder {
		position: relative;
		z-index: 1;
		max-width: 76rem;
		margin: 0 auto;
		padding: var(--sp-6) var(--sp-6) calc(var(--sp-8) * 2);
	}

	/* ---- The bench: title, tools, and the way in ---- */

	.bar {
		position: relative;
		z-index: 8;
	}

	.bar-in {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--sp-5) var(--sp-7);
		padding: var(--sp-5) var(--sp-7);
	}

	.who {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--sp-6);
		min-width: 0;
	}

	.home {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--radius-sm);
		font-family: var(--font-label);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--muted);
		text-decoration: none;
	}

	.home:hover {
		color: var(--gilt-hi);
	}

	.titles h1 {
		margin: 0;
		white-space: nowrap;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		letter-spacing: 0.06em;
		line-height: 1.05;
		color: var(--gilt);
	}

	.working {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: var(--sp-2) 0 0;
		min-width: 0;
		font-family: var(--font-display);
		font-size: var(--fs-sm);
		font-style: italic;
		color: var(--muted);
	}

	.working span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hotbar,
	.play-slot {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}

	.hotbar {
		justify-content: center;
		flex-wrap: nowrap;
	}

	.hotbar button,
	.hotbar :global(.file-button) {
		min-height: 2.4rem;
		padding: 0.3rem 0.85rem;
		font-size: 0.95rem;
		white-space: nowrap;
	}

	.hotbar button,
	.play-slot button {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
	}

	.play-slot {
		justify-content: flex-end;
	}

	/* The tray of starting points drops from its plate. */
	.templates {
		position: relative;
	}

	.templates > summary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35em;
		min-height: 2.4rem;
		padding: 0.3rem 0.85rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 3px 0 var(--ink-line),
			0 7px 12px rgba(8, 4, 0, 0.4);
		font-family: var(--font-label);
		font-size: 0.95rem;
		letter-spacing: 0.04em;
		white-space: nowrap;
		color: var(--text);
		cursor: pointer;
		list-style: none;
	}

	.templates > summary::-webkit-details-marker {
		display: none;
	}

	.templates > summary:hover {
		color: var(--gilt-hi);
	}

	.templates > summary:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.templates[open] > summary {
		transform: translateY(2px);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 3px 6px rgba(0, 0, 0, 0.5);
	}

	.tray {
		position: absolute;
		top: calc(100% + var(--sp-3));
		left: 50%;
		z-index: 20;
		display: grid;
		gap: var(--sp-3);
		min-width: 14rem;
		padding: var(--sp-4);
		translate: -50% 0;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-solid);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			var(--shadow-md);
		animation: tray-in var(--dur-med, 0.22s) var(--spring, ease-out);
	}

	.tray button {
		justify-content: flex-start;
		min-height: 2.75rem;
	}

	@keyframes tray-in {
		from {
			opacity: 0;
			translate: -50% -0.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tray {
			animation: none;
		}
	}

	.name {
		width: 9rem;
	}

	.fix {
		border-color: #7a2e22;
		color: #ffd7cf;
	}

	.fix :global(.icon) {
		color: #ff9d8c;
	}

	/* ---- Notes: error and notice slide in under the bench ---- */

	.note {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-5);
		margin-top: var(--sp-5);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-solid);
		box-shadow: var(--shadow-md);
	}

	.note p {
		margin: 0;
	}

	.note.bad {
		border-left: 6px solid #c0392b;
		box-shadow:
			inset 0 0 0 1px rgba(226, 122, 107, 0.45),
			var(--shadow-md);
		color: #ffd7cf;
	}

	.note.bad :global(.icon) {
		color: #ff9d8c;
	}

	.note.good {
		border-left: 6px solid #4b8f45;
		box-shadow:
			inset 0 0 0 1px rgba(127, 196, 122, 0.4),
			var(--shadow-md);
	}

	.note.good :global(.icon) {
		color: var(--ok);
	}

	/* ---- The rail: the quest track across the top ---- */

	.rail {
		position: sticky;
		top: var(--sp-4);
		z-index: 5;
		margin-top: var(--sp-6);
	}

	.stage {
		margin-top: var(--sp-7);
	}

	.sect {
		display: grid;
		gap: var(--sp-6);
		min-width: 0;
	}

	.sect-head {
		display: flex;
		align-items: center;
		gap: var(--sp-6);
		flex-wrap: wrap;
	}

	.sect-head :global(.g-banner.sect-banner) {
		font-size: var(--fs-lg);
	}

	.lede {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-md);
		font-style: italic;
		color: var(--muted);
		max-width: 52ch;
	}

	.hint-line {
		margin: 0;
		max-width: 70ch;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.split {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-6);
		align-items: start;
	}

	.flow-layout {
		display: grid;
		gap: var(--sp-7);
	}

	.idtag {
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--muted) 16%, transparent);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	/* ---- Overview ---- */

	.big {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 700;
	}

	.asking {
		grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
	}

	.cast {
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

	.muted {
		color: var(--muted);
	}

	/* ---- Rows of fields that sit on one line ---- */

	.objective {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
		align-items: center;
	}

	.objective > input:first-child {
		grid-column: 1 / -1;
	}

	.reaction {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 2fr) auto;
		align-items: center;
	}

	.area {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
		align-items: center;
	}

	.result {
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
		align-items: center;
	}

	.attack {
		grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)) auto;
		align-items: end;
	}

	.icon-only {
		display: grid;
		place-items: center;
		min-width: 2.5rem;
		padding: 0;
	}

	.stats {
		display: grid;
		gap: var(--sp-4);
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
	}

	.stat span {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.stat :global(.icon) {
		color: var(--gilt);
	}

	.tools {
		display: inline-flex;
		gap: var(--sp-3);
	}

	.when summary {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin-bottom: var(--sp-4);
		font-family: var(--font-label);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent);
		cursor: pointer;
	}

	.when:not([open]) summary {
		margin-bottom: 0;
	}

	textarea {
		width: 100%;
	}

	.json {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: 1.5;
		tab-size: 2;
	}

	/* ---- Scenes ---- */

	.table-card {
		display: grid;
		grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
		gap: var(--sp-6);
		align-items: start;
	}

	.table-info {
		display: grid;
		gap: var(--sp-4);
		align-content: start;
	}

	.table-name {
		margin: 0;
		font-size: var(--fs-md);
	}

	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tokens :global(.g-tag) {
		min-height: 1.9rem;
		padding-inline: var(--sp-4);
		font-size: var(--fs-sm);
	}

	/* ---- Flow ---- */

	.flow {
		display: flex;
		gap: var(--sp-4);
		margin: 0;
		padding: 0 0 var(--sp-3);
		list-style: none;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.flow li {
		flex: 0 0 13rem;
	}

	.status {
		margin-top: var(--sp-3);
	}

	.flow li {
		display: grid;
		justify-items: start;
		gap: var(--sp-2);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-left: 4px solid var(--gilt-mid);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		box-shadow: inset 0 0 0 1px var(--border);
	}

	.flow li.branch {
		border-left-style: dashed;
		border-left-color: var(--rune);
	}

	.node {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.03em;
	}

	.edge {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.edge em {
		color: var(--gilt-hi);
	}

	.flow li.branch .edge em {
		color: var(--rune);
	}

	/* ---- Check ---- */

	.verdict-line {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin: 0;
		font-size: var(--fs-md);
	}

	.ok {
		color: var(--ok);
		font-weight: 700;
	}

	.verdict-line.bad {
		color: #ffd7cf;
	}

	.verdict-line.bad :global(.icon) {
		flex: none;
		color: #ff9d8c;
	}

	.verdict-line .small {
		display: block;
		font-size: var(--fs-xs);
		font-weight: 400;
	}

	.found {
		grid-column: 1 / -1;
	}

	.checklist {
		display: grid;
		gap: var(--sp-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.checklist li {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		color: var(--muted);
	}

	.checklist li.done {
		color: var(--text);
	}

	.box {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.6),
			inset 0 0 0 1px var(--gilt-line);
		color: var(--accent-text);
	}

	.done .box {
		background: var(--gilt-grad);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			0 0 12px rgba(224, 164, 88, 0.35);
	}

	.glance {
		display: grid;
		gap: var(--sp-4);
		grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.glance li {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		padding: var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.26);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--gilt);
	}

	.glance .n {
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1;
		color: var(--text);
	}

	.glance .what {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	/* ---- Narrow screens ---- */

	@media (max-width: 64rem) {
		.bar-in {
			grid-template-columns: 1fr;
			justify-items: start;
		}

		.hotbar,
		.play-slot {
			justify-content: flex-start;
			flex-wrap: wrap;
		}

		.split {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 40rem) {
		.builder {
			padding-inline: var(--sp-5);
		}

		.bar-in {
			padding: var(--sp-5);
		}

		.rail {
			position: static;
		}

		.hotbar > :global(*),
		.play-slot > :global(*) {
			flex: 1 1 auto;
		}

		.hotbar button,
		.hotbar :global(.file-button),
		.play-slot button {
			min-height: 2.75rem;
			justify-content: center;
		}

		.name {
			flex: 1 1 8rem;
			min-height: 2.75rem;
		}

		.who {
			flex: 1 1 auto;
			min-width: 0;
		}

		.titles h1 {
			white-space: normal;
			font-size: var(--fs-lg);
		}

		.icon-only {
			min-height: 2.75rem;
			min-width: 2.75rem;
		}

		.objective {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.objective > :global(*) {
			grid-column: 1 / -1;
		}

		.objective > .check {
			grid-column: 1;
		}

		.objective > button {
			grid-column: 2;
		}

		.reaction,
		.area,
		.result,
		.attack,
		.table-card {
			grid-template-columns: minmax(0, 1fr);
		}

		.asking {
			grid-template-columns: minmax(0, 1fr);
		}

		.tile {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.tile .words {
			grid-column: 1 / -1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tile {
			transition: none;
		}
	}
</style>
