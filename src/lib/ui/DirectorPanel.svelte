<script lang="ts">
	import type { AdventureView, MonsterListing } from '$lib/adventure/adventure';
	import { parseDice } from '$lib/game/dice';
	import { lightKindName, type Ambient, type Light } from '$lib/game/lights';
	import type { WorldLook } from '$lib/game/world';
	import type { Direction } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import type { BuildTool } from './BuildPanel.svelte';
	import { Icon, Meter, Portrait, type IconName } from '$lib/ui/game';
	import Field from './room/Field.svelte';
	import Fold from './room/Fold.svelte';
	import PanelTitle from './room/PanelTitle.svelte';
	import Toggle from './room/Toggle.svelte';
	import ToolSlot from './room/ToolSlot.svelte';
	import Tray from './room/Tray.svelte';

	/**
	 * The GM's controls for running the story as it is played: pause, skip
	 * ahead, fights, enemies, people, story events, the environment, what the
	 * players see, and dice. Everything here directs; nothing builds.
	 */
	interface Props {
		adventure: AdventureView;
		paused: boolean;
		ambient: Ambient;
		world: WorldLook;
		/** The hour the clock shows now (it moves while the clock runs). */
		hour?: number;
		/** The table's environment id (which sky it falls back to). */
		environment: string | null;
		lights: Light[];
		fogEnabled: boolean;
		fogShared: boolean;
		tool: BuildTool;
		/** The enemy kind the GM is placing, if any. */
		spawning: string | null;
		/** The latest monster search's results, under rules with a bestiary. */
		monsters?: MonsterListing[] | null;
		send(action: RoomAction): boolean;
		onTool(tool: BuildTool): void;
		/** Place an enemy: `hold` keeps it for the GM's own fight; `name` names a monster not yet in the story. */
		onSpawn(kind: string | null, hold?: boolean, name?: string | null): void;
		onSelectToken(tokenId: string): void;
		/** Selects a light for the light inspector. */
		onEditLight(lightId: string): void;
		onFogAll(reveal: boolean): void;
		onError(message: string): void;
	}

	let {
		adventure,
		paused,
		ambient,
		world,
		hour,
		environment,
		lights,
		fogEnabled,
		fogShared,
		tool,
		spawning,
		monsters = null,
		send,
		onTool,
		onSpawn,
		onSelectToken,
		onEditLight,
		onFogAll,
		onError
	}: Props = $props();

	const director = $derived(adventure.director);
	const playing = $derived(adventure.stage === 'playing');
	const encounter = $derived(adventure.encounter);

	let eventId = $state('');
	let encounterId = $state('');
	let enemyKind = $state('');
	let dice = $state('1d20');
	let monsterQuery = $state('');
	/** Placed monsters wait for the GM's fight instead of spotting the party. */
	let hold = $state(true);
	const bestiary = $derived(director?.bestiary ?? null);
	const summary = $derived(bestiary?.summary ?? null);
	const gmFight = $derived(director?.encounters.find((e) => e.id === 'ambush'));
	function searchMonsters(event: SubmitEvent) {
		event.preventDefault();
		send({ type: 'monster_search', query: monsterQuery.trim() });
	}
	let bearer = $state('');
	let conditionId = $state('');
	/** Rounds of the bearer's own turns, or empty for until removed. */
	let rounds = $state('');
	/** Every condition held at the table, with whom it is on. */
	const held = $derived([
		...adventure.characters.flatMap((c) => c.conditions.map((m) => ({ ...m, on: c.def.name }))),
		...(encounter?.enemies ?? []).flatMap((e) => e.conditions.map((m) => ({ ...m, on: e.name })))
	]);
	function putCondition() {
		const n = rounds.trim() === '' ? null : Number(rounds);
		if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100))
			return onError('Rounds: a whole number from 1 to 100, or empty for until removed.');
		send({
			type: 'adventure_effect',
			op: { kind: 'apply', target: bearer, condition: conditionId, rounds: n }
		});
	}

	const VIEW_TOOLS: { tool: BuildTool; label: string; icon: IconName }[] = [
		{ tool: 'reveal', label: 'Reveal area', icon: 'eye' },
		{ tool: 'hide', label: 'Hide area', icon: 'eyeoff' },
		{ tool: 'reveal-room', label: 'Reveal room', icon: 'door' },
		{ tool: 'hide-room', label: 'Hide room', icon: 'lock' }
	];

	// Keep the pickers on something that is still offered.
	$effect(() => {
		const events = director?.events ?? [];
		if (!events.some((e) => e.id === eventId)) eventId = events[0]?.id ?? '';
		const fights = director?.encounters ?? [];
		if (!fights.some((e) => e.id === encounterId)) encounterId = fights[0]?.id ?? '';
		const kinds = director?.enemies ?? [];
		if (!kinds.some((e) => e.kind === enemyKind)) enemyKind = kinds[0]?.kind ?? '';
		const bearers = director?.bearers ?? [];
		if (!bearers.some((b) => b.tokenId === bearer)) bearer = bearers[0]?.tokenId ?? '';
		const conditions = director?.conditions ?? [];
		if (!conditions.some((c) => c.id === conditionId)) conditionId = conditions[0]?.id ?? '';
	});

	const direct = (direction: Direction) => send({ type: 'adventure_direct', direction });

	function roll(secret: boolean) {
		const parsed = parseDice(dice);
		if (!parsed.ok) return onError(parsed.error);
		send(
			secret
				? { type: 'dice_roll', expression: dice, secret: true }
				: { type: 'dice_roll', expression: dice }
		);
	}

	const lightName = (l: Light) =>
		`${lightKindName(l.kind ?? 'torch')} at ${l.pos.x + 1}, ${l.pos.y + 1}`;
	const fightState = (state: string | null) =>
		state === 'won' ? ' (won)' : state === 'lost' ? ' (lost)' : state === 'active' ? ' (on)' : '';
</script>

<div class="director">
	<PanelTitle icon="crown">Direct</PanelTitle>

	<Tray title="The game" icon="play">
		<div class="pair">
			<ToolSlot
				icon={paused ? 'play' : 'hourglass'}
				label={paused ? 'Carry on' : 'Pause game'}
				pressed={paused}
				onclick={() => send({ type: 'pause_set', paused: !paused })}
			/>
			<ToolSlot
				icon="chevron"
				label="Skip scene"
				disabled={!playing || !director?.skip}
				title={director?.skip ? `Skip to: ${director.skip}` : 'Nothing to skip to now'}
				onclick={() => direct({ op: 'skip' })}
			/>
		</div>
		{#if director?.skip && playing}
			<p class="note">Next: {director.skip}</p>
		{:else if adventure.decision}
			<p class="note">Waiting on the party’s choice.</p>
		{/if}
	</Tray>

	{#if director && playing}
		<Tray title="Fight" icon="sword">
			{#if encounter}
				<p class="note round num">Round {encounter.round} is on.</p>
				<div class="pair">
					<button type="button" onclick={() => direct({ op: 'encounter_end', result: 'won' })}>
						<Icon name="crown" /> End: party wins
					</button>
					<button
						type="button"
						onclick={() => direct({ op: 'encounter_end', result: 'called_off' })}
					>
						<Icon name="close" /> Call it off
					</button>
				</div>
			{:else}
				<label>
					<span class="visually-hidden">Fight to start</span>
					<select bind:value={encounterId}>
						{#each director.encounters as e (e.id)}
							<option value={e.id}>{e.name}{fightState(e.state)}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					class="go"
					disabled={!encounterId}
					onclick={() => direct({ op: 'encounter_start', encounter: encounterId })}
				>
					<Icon name="sword" /> Start fight
				</button>
			{/if}
		</Tray>

		<Tray
			title="Enemies"
			icon="skull"
			aside={director.foes.length ? `${director.foes.length} on the map` : undefined}
		>
			<div class="pick">
				<label>
					<span class="visually-hidden">Enemy to bring on</span>
					<select bind:value={enemyKind}>
						{#each director.enemies as e (e.kind)}
							<option value={e.kind}>{e.name}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					aria-pressed={spawning !== null}
					onclick={() => onSpawn(spawning ? null : enemyKind)}
				>
					{spawning ? 'Cancel' : 'Place'}
				</button>
			</div>
			{#if director.foes.length}
				<ul class="foes">
					{#each director.foes as f (f.tokenId)}
						<li>
							<Portrait name={f.name} foe size={34} />
							<button type="button" class="ghost link" onclick={() => onSelectToken(f.tokenId)}>
								{f.name}
							</button>
							{#if f.hp === null}
								<span class="muted">on watch</span>
							{:else}
								<span class="hp num">
									<Meter
										value={f.hp}
										max={f.maxHp ?? f.hp}
										tone="foe"
										label="{f.name} hit points"
									/>
									{f.hp}/{f.maxHp} HP
								</span>
							{/if}
							<button
								type="button"
								class="small danger"
								aria-label="Remove {f.name}"
								onclick={() => send({ type: 'token_delete', tokenId: f.tokenId })}
							>
								<Icon name="trash" size="1.1em" />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="note">No enemies on the map.</p>
			{/if}
		</Tray>

		{#if bestiary}
			<Tray title="Monsters" icon="book">
				<form class="pick" onsubmit={searchMonsters} role="search">
					<label>
						<span class="visually-hidden">Find a monster</span>
						<input
							type="search"
							maxlength="40"
							placeholder="Name, type or challenge"
							bind:value={monsterQuery}
						/>
					</label>
					<button type="submit"><Icon name="search" size="1.1em" /> Find</button>
				</form>
				<Toggle
					label="Hold them for my fight (they spot nobody until it starts)"
					checked={hold}
					onchange={(v) => (hold = v)}
				/>
				{#if monsters}
					{#if monsters.length === 0}
						<p class="note">No monster the table plays matches that.</p>
					{:else}
						<ul class="monsters">
							{#each monsters as m (m.kind)}
								<li>
									<details>
										<summary>
											<span class="mname">{m.name}</span>
											<span class="muted num">CR {m.challenge} · {m.xp} XP</span>
										</summary>
										<div class="stat">
											<p class="note">
												{m.type} · AC {m.armorClass} · {m.hitPoints} HP
											</p>
											<ul class="lines">
												{#each m.attacks as a (a)}<li>{a}</li>{/each}
											</ul>
											{#if m.notPlayed.length}
												<p class="note">Not played yet: {m.notPlayed.join(', ')}</p>
											{/if}
											<p class="note source">{m.source}</p>
										</div>
									</details>
									<button
										type="button"
										class="small"
										aria-pressed={spawning === m.kind}
										onclick={() => onSpawn(spawning === m.kind ? null : m.kind, hold, m.name)}
									>
										{spawning === m.kind ? 'Cancel' : 'Place'}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
				{#if summary}
					<div class="summary" role="group" aria-label="How the fight looks">
						<p class="num head">
							<strong class="g-tag brass">{summary.band}</strong>
							<span
								>{summary.xp} XP for {summary.party.characters}
								{summary.party.characters === 1 ? 'character' : 'characters'}</span
							>
						</p>
						<p class="note num">
							{summary.monsters.map((m) => `${m.count} × ${m.name} (${m.xp} XP)`).join(', ')}
						</p>
						<p class="note num">
							Budgets: {summary.budgets.map((b) => `${b.name} ${b.xp}`).join(' · ')}
						</p>
						<ul class="lines">
							{#each summary.notes as n (n)}<li class="note">{n}</li>{/each}
						</ul>
						{#if !encounter && gmFight}
							<button
								type="button"
								class="go"
								onclick={() => direct({ op: 'encounter_start', encounter: gmFight.id })}
							>
								<Icon name="sword" /> Start my fight
							</button>
						{/if}
					</div>
				{/if}
			</Tray>
		{/if}

		{#if director.people.length}
			<Tray title="People here" icon="users">
				<p class="note">Pick someone, then click a cell to move them.</p>
				<ul class="chips">
					{#each director.people as p (p.tokenId)}
						<li>
							<button type="button" class="chip" onclick={() => onSelectToken(p.tokenId)}>
								<Portrait name={p.name} size={24} />
								{p.name}
							</button>
						</li>
					{/each}
				</ul>
			</Tray>
		{/if}

		{#if director.conditions.length}
			<Tray title="Conditions" icon="hourglass">
				<div class="two">
					<label>
						<span class="visually-hidden">Who</span>
						<select bind:value={bearer} disabled={director.bearers.length === 0}>
							{#each director.bearers as b (b.tokenId)}
								<option value={b.tokenId}>{b.name}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="visually-hidden">Condition</span>
						<select bind:value={conditionId}>
							{#each director.conditions as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="pick rounds">
					<Field label="Rounds (empty: until removed)">
						<input type="number" min="1" max="100" bind:value={rounds} />
					</Field>
					<button type="button" class="go" disabled={!bearer} onclick={putCondition}>
						<Icon name="check" /> Apply
					</button>
				</div>
				{#if held.length}
					<ul class="held">
						{#each held as m (m.effect + m.id)}
							<li>
								<span class="what" title={m.until}
									>{m.on}: {m.name}{m.level ? ` ${m.level}` : ''}</span
								>
								<span class="muted">{m.from}</span>
								<button
									type="button"
									class="small danger"
									onclick={() =>
										send({ type: 'adventure_effect', op: { kind: 'remove', effect: m.effect } })}
								>
									End
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</Tray>
		{/if}

		<Tray title="Story" icon="scroll">
			<label>
				<span class="visually-hidden">Event to trigger</span>
				<select bind:value={eventId} disabled={director.events.length === 0}>
					{#each director.events as e (e.id)}
						<option value={e.id}>{e.label}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="go"
				disabled={!eventId}
				onclick={() => direct({ op: 'event', event: eventId })}
			>
				<Icon name="wand" /> Make it happen
			</button>
		</Tray>
	{/if}

	<Tray title="Environment" icon="compass">
		<!-- GM only: loaded on its own so the players' room page stays small. -->
		{#await import('./TimeOfDay.svelte') then { default: TimeOfDay }}
			<TimeOfDay {world} {hour} {ambient} {environment} {send} />
		{/await}
		{#if lights.length}
			<Fold
				title="Lights"
				icon="flame"
				aside="{lights.filter((l) => l.on).length} of {lights.length} on"
			>
				<ul class="lights">
					{#each lights as l (l.id)}
						<li>
							<span class="swatch" style:background={l.color}></span>
							<span class="lamp">{lightName(l)}</span>
							<button
								type="button"
								class="small"
								aria-pressed={l.on}
								onclick={() => send({ type: 'light_update', lightId: l.id, patch: { on: !l.on } })}
							>
								{l.on ? 'On' : 'Off'}
							</button>
							<button
								type="button"
								class="small"
								aria-label="Edit {lightName(l)}"
								onclick={() => onEditLight(l.id)}>Edit</button
							>
						</li>
					{/each}
				</ul>
			</Fold>
		{/if}
	</Tray>

	<Tray title="What players see" icon="eye">
		{#if fogEnabled}
			<div class="grid2">
				{#each VIEW_TOOLS as t (t.tool)}
					<ToolSlot
						icon={t.icon}
						label={t.label}
						wide
						pressed={tool === t.tool}
						onclick={() => onTool(tool === t.tool ? 'select' : t.tool)}
					/>
				{/each}
				<button type="button" onclick={() => onFogAll(true)}>Reveal all</button>
				<button type="button" onclick={() => onFogAll(false)}>Hide all</button>
			</div>
			<Toggle
				label="The party shares its sight"
				checked={fogShared}
				onchange={(shared) => send({ type: 'fog_share', shared })}
			/>
		{:else}
			<p class="note">Fog is off: players see the whole table.</p>
		{/if}
	</Tray>

	<Tray title="Dice" icon="d20">
		<div class="dice">
			<label>
				<span class="visually-hidden">Dice to roll</span>
				<input bind:value={dice} maxlength="40" spellcheck="false" />
			</label>
			<button type="button" class="go" onclick={() => roll(false)}>
				<Icon name="d20" /> Roll
			</button>
			<button type="button" title="Only you see the result" onclick={() => roll(true)}>
				<Icon name="eyeoff" /> Secret
			</button>
		</div>
	</Tray>
</div>

<style>
	.director {
		display: grid;
		gap: var(--sp-5);
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--sp-4);
	}

	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--sp-4);
	}

	.pick {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-4);
	}

	.dice {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: var(--sp-4);
	}

	button {
		padding: var(--sp-3) var(--sp-4);
		font-size: var(--fs-sm);
	}

	.pair > button,
	.go,
	.dice button,
	.grid2 > button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}

	select,
	input:not([type='checkbox']) {
		width: 100%;
		min-width: 0;
		font-size: var(--fs-sm);
	}

	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.round {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.05em;
		color: var(--gilt-hi);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.foes {
		display: grid;
		gap: var(--sp-4);
	}

	.foes li {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: var(--sp-4);
		font-size: var(--fs-sm);
	}

	.hp {
		display: grid;
		grid-column: 2 / 4;
		grid-row: 2;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--sp-4);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.hp :global(.g-meter) {
		height: 0.55rem;
	}

	.foes li > .muted {
		grid-column: 2 / 4;
		grid-row: 2;
	}

	.foes .small {
		grid-row: 1 / span 2;
		grid-column: 4;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2rem;
		padding: var(--sp-1) var(--sp-4) var(--sp-1) var(--sp-2);
		font-size: var(--fs-sm);
	}

	.small {
		min-height: 2rem;
		padding: var(--sp-1) var(--sp-4);
		font-size: var(--fs-xs);
	}

	.link {
		padding: 0;
		min-height: 0;
		text-align: left;
		font-size: var(--fs-md);
		color: var(--text);
	}

	.link:hover {
		text-decoration: underline;
	}

	.muted {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.lights {
		display: grid;
		gap: var(--sp-3);
		font-size: var(--fs-xs);
	}

	.lights li {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: var(--sp-3);
	}

	.swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		box-shadow:
			inset 0 0 0 1px rgba(0, 0, 0, 0.4),
			0 0 8px currentColor;
	}

	.lamp {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}

	.rounds {
		align-items: end;
	}

	/* Monsters the search found: a name and its challenge, opening onto a stat block. */
	.monsters {
		display: grid;
		gap: var(--sp-3);
	}

	.monsters li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--sp-3);
		padding: var(--sp-2) var(--sp-3);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-sunk);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.monsters summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--sp-4);
		min-height: 2rem;
		padding-block: var(--sp-2);
		font-size: var(--fs-sm);
		cursor: pointer;
		list-style: none;
	}

	.monsters summary::-webkit-details-marker {
		display: none;
	}

	.monsters summary:hover .mname {
		color: var(--gilt-hi);
	}

	.monsters details[open] summary {
		border-bottom: 1px solid var(--ink-line);
	}

	.mname {
		font-family: var(--font-label);
		letter-spacing: 0.04em;
		color: var(--gilt);
	}

	.stat {
		display: grid;
		gap: var(--sp-2);
		padding-block: var(--sp-3);
	}

	.lines {
		display: grid;
		gap: var(--sp-1);
		padding-left: var(--sp-6);
		font-size: var(--fs-xs);
		list-style: disc;
	}

	.source {
		font-style: italic;
	}

	/* How the fight looks: a small ledger plate. */
	.summary {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 6px rgba(0, 0, 0, 0.5),
			inset 0 0 0 1px var(--gilt-line);
	}

	.summary p {
		margin: 0;
	}

	.summary .head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.summary .go {
		justify-self: start;
	}

	/* Conditions at the table, each with its bearer and an End. */
	.held {
		display: grid;
		gap: var(--sp-3);
	}

	.held li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-1) var(--sp-4);
		font-size: var(--fs-sm);
	}

	.held .what {
		overflow-wrap: anywhere;
	}

	.held .muted {
		grid-column: 1;
		grid-row: 2;
	}

	.held .small {
		grid-column: 2;
		grid-row: 1 / span 2;
	}

	@media (max-width: 48rem) {
		.small,
		.chip,
		.link {
			min-height: 2.75rem;
		}
	}
</style>
