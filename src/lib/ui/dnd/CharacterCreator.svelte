<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {
		AbilityId,
		CreatorOptions,
		CreatorPreview,
		CreatorSummary
	} from '$lib/rules/dnd55e/creator';
	import { play } from '$lib/audio/engine';
	import type { CreatorReply, RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon, Portrait, type IconName } from '$lib/ui/game';
	import Steps, { type TrackStep } from '../Steps.svelte';
	import {
		ABILITY_IDS,
		complete,
		emptyDraft,
		loadDraft,
		originSkills,
		pointBuyBase,
		pointsSpent,
		saveDraft,
		STEPS,
		todo,
		toChoices,
		toggle,
		unplaced,
		withBackground,
		withClass,
		withSpecies,
		type Draft,
		type StepId
	} from './creator-draft';

	interface Props {
		roomId: string;
		reply: CreatorReply | null;
		send(action: RoomAction): boolean;
		onClose(): void;
	}

	let { roomId, reply, send, onClose }: Props = $props();

	let options = $state<CreatorOptions | null>(null);
	let preview = $state<CreatorPreview | null>(null);
	let draft = $state<Draft>(untrack(() => loadDraft(roomId)) ?? emptyDraft());
	let building = $state(false);
	let lastPreview = '';

	onMount(() => {
		send({ type: 'character_options' });
	});

	$effect(() => {
		if (!reply) return;
		if (reply.type === 'character_options' && reply.rules === 'dnd-5.5e')
			options = reply.options as unknown as CreatorOptions;
		if (reply.type === 'character_preview') preview = reply.preview as CreatorPreview;
	});

	// Keep the draft as the player goes, so a refresh or a dropped connection picks up here.
	$effect(() => {
		saveDraft(roomId, $state.snapshot(draft) as Draft);
	});

	const klass = $derived(options?.classes.find((c) => c.id === draft.classId) ?? null);
	const species = $derived(options?.species.find((s) => s.id === draft.speciesId) ?? null);
	const background = $derived(
		options?.backgrounds.find((b) => b.id === draft.backgroundId) ?? null
	);
	const stepIndex = $derived(STEPS.findIndex((s) => s.id === draft.step));
	const left = $derived(options ? todo(draft, options, draft.step) : []);
	const ready = $derived(!!options && complete(draft, options));
	const known = $derived(options ? originSkills(draft, options) : []);
	const proficient = $derived([...known, ...draft.skills]);
	const skillName = (id: string) => options?.skills.find((s) => s.id === id)?.name ?? id;
	const abilityName = (id: AbilityId) => options?.abilities.find((a) => a.id === id)?.name ?? id;
	const weapon = (id: string) => options?.weapons.find((w) => w.id === id);
	const trained = $derived(
		(klass?.trainedWeapons ?? []).map((id) => weapon(id)!).filter((w) => !!w)
	);
	const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

	// On the review step, ask the server what the finished choices come to.
	$effect(() => {
		if (draft.step !== 'review' || !options || !ready) return;
		const choices = JSON.stringify(toChoices(draft, options));
		if (choices === lastPreview) return;
		lastPreview = choices;
		const timer = setTimeout(
			() => send({ type: 'character_preview', choices: JSON.parse(choices) }),
			250
		);
		return () => clearTimeout(timer);
	});

	const go = (step: StepId) => (draft.step = step);

	/** The quest track across the top: a stop for each step, ticked once nothing is left on it. */
	const track = $derived<TrackStep[]>(
		STEPS.map((s) => ({
			id: s.id,
			label: s.title,
			state: !!options && todo(draft, options, s.id).length === 0 ? 'done' : 'todo'
		}))
	);

	/** A glyph for each class, so the choice reads at a glance. */
	const CLASS_ICON: Record<string, IconName> = {
		barbarian: 'flame',
		bard: 'sound',
		cleric: 'heart',
		druid: 'compass',
		fighter: 'sword',
		monk: 'star',
		paladin: 'shield',
		ranger: 'map',
		rogue: 'key',
		sorcerer: 'sparkle',
		warlock: 'skull',
		wizard: 'wand'
	};
	const ABILITY_ICON: Record<AbilityId, IconName> = {
		str: 'sword',
		dex: 'sparkle',
		con: 'heart',
		int: 'eye',
		wis: 'compass',
		cha: 'star'
	};
	/** A card was picked: a small chime, then the choice itself. */
	const chime = () => play([{ kind: 'ui', sound: 'select' }]);
	const next = () => {
		const n = STEPS[stepIndex + 1];
		if (n) go(n.id);
	};
	const back = () => {
		const p = STEPS[stepIndex - 1];
		if (p) go(p.id);
	};

	function setMethod(method: Draft['method']) {
		if (draft.method === method) return;
		draft.method = method;
		draft.base =
			method === 'point-buy'
				? pointBuyBase()
				: { str: null, dex: null, con: null, int: null, wis: null, cha: null };
	}

	function bump(a: AbilityId, by: number) {
		if (!options) return;
		const next = (draft.base[a] ?? 8) + by;
		if (options.pointCost[String(next)] === undefined) return;
		draft.base = { ...draft.base, [a]: next };
	}

	function create() {
		if (!options || !ready) return;
		building = true;
		send({
			type: 'adventure_build',
			choices: JSON.parse(JSON.stringify(toChoices(draft, options)))
		});
	}

	// Once built, the table takes over: the draft is done with.
	$effect(() => () => {
		if (building) saveDraft(roomId, null);
	});

	const summary = $derived(preview?.ok ? (preview.summary as CreatorSummary) : null);
</script>

<div class="backdrop">
	<section class="creator g-frame" aria-labelledby="creator-title">
		<header>
			<h2 id="creator-title" class="g-banner">Create your character</h2>
			<div class="who">
				<Portrait
					name={draft.name || klass?.name || '?'}
					label={draft.name || klass?.name || 'Your character'}
					color={draft.color || '#8a6a3d'}
					size={64}
				/>
				<p class="help">
					A level 1 character by the fifth edition rules. Choose one thing at a time; the table
					checks every choice and works out the numbers. Your choices are kept if you leave and come
					back.
				</p>
			</div>
			<div class="track">
				<Steps
					steps={track}
					active={draft.step}
					onselect={(id) => go(id as StepId)}
					label="Steps of making a character"
				/>
			</div>
		</header>

		{#if !options}
			<p class="help">Getting the choices from the table…</p>
		{:else if draft.step === 'class'}
			<fieldset>
				<legend>Class</legend>
				<div class="cards">
					{#each options.classes as c (c.id)}
						<label class="card" class:chosen={draft.classId === c.id}>
							<input
								type="radio"
								name="class"
								checked={draft.classId === c.id}
								onchange={() => {
									chime();
									draft = withClass(draft, c.id);
								}}
							/>
							<span class="glyph"
								><Icon name={CLASS_ICON[c.name.toLowerCase()] ?? 'user'} size="1.6rem" /></span
							>
							<span class="name">{c.name}</span>
							<span class="meta">d{c.hitDie} hit die · {c.primary}</span>
							<span class="meta"
								>Saves: {c.saves.map(abilityName).join(', ')} · Armor: {c.armor.length
									? c.armor.join(', ')
									: 'none'}</span
							>
						</label>
					{/each}
				</div>
				{#if klass}
					<div class="details">
						<h3>{klass.name} at level 1</h3>
						<p class="meta">Weapons: {klass.weapons}</p>
						{#each klass.features as f (f.name)}
							<details>
								<summary>{f.name}</summary>
								<p>{f.text}</p>
							</details>
						{/each}
					</div>
				{/if}
			</fieldset>
		{:else if draft.step === 'origin'}
			<fieldset>
				<legend>Species</legend>
				<div class="cards">
					{#each options.species as s (s.id)}
						<label class="card" class:chosen={draft.speciesId === s.id}>
							<input
								type="radio"
								name="species"
								checked={draft.speciesId === s.id}
								onchange={() => {
									chime();
									draft = withSpecies(draft, s.id);
								}}
							/>
							<span class="glyph"><Icon name="user" size="1.6rem" /></span>
							<span class="name">{s.name}</span>
							<span class="meta">Speed {s.speed} ft.</span>
						</label>
					{/each}
				</div>
				{#if species}
					<div class="details">
						{#each species.traits as t (t.name)}
							<details>
								<summary>{t.name}</summary>
								<p>{t.text}</p>
							</details>
						{/each}
						{#each species.options as o (o.key)}
							<label class="field">
								<span>{o.label}</span>
								<select
									value={draft.speciesOptions[o.key] ?? ''}
									onchange={(e) =>
										(draft.speciesOptions = {
											...draft.speciesOptions,
											[o.key]: e.currentTarget.value
										})}
								>
									<option value="" disabled>Choose…</option>
									{#each o.values as v (v.id)}
										<option value={v.id}>{v.name}</option>
									{/each}
								</select>
							</label>
						{/each}
						{#if species.feat}
							<label class="field">
								<span>Origin feat (Versatile)</span>
								<select
									value={draft.speciesFeat ?? ''}
									onchange={(e) => {
										draft.speciesFeat = e.currentTarget.value;
										draft.speciesFeatSkills = [];
									}}
								>
									<option value="" disabled>Choose…</option>
									{#each options.originFeats as f (f.id)}
										<option value={f.id}>{f.name}</option>
									{/each}
								</select>
							</label>
							{@const feat = options.originFeats.find((f) => f.id === draft.speciesFeat)}
							{#if feat}
								<p class="rules">{feat.text}</p>
								{#if feat.skills}
									<div class="checks" role="group" aria-label="{feat.name} skills">
										{#each options.skills as s (s.id)}
											<label
												><input
													type="checkbox"
													checked={draft.speciesFeatSkills.includes(s.id)}
													onchange={() =>
														(draft.speciesFeatSkills = toggle(
															draft.speciesFeatSkills,
															s.id,
															feat.skills
														))}
												/>
												{s.name}</label
											>
										{/each}
									</div>
								{/if}
							{/if}
						{/if}
					</div>
				{/if}
			</fieldset>
			<fieldset>
				<legend>Background</legend>
				<div class="cards">
					{#each options.backgrounds as b (b.id)}
						<label class="card" class:chosen={draft.backgroundId === b.id}>
							<input
								type="radio"
								name="background"
								checked={draft.backgroundId === b.id}
								onchange={() => {
									chime();
									draft = withBackground(draft, b.id);
								}}
							/>
							<span class="glyph"><Icon name="scroll" size="1.6rem" /></span>
							<span class="name">{b.name}</span>
							<span class="meta">Skills: {b.skills.map(skillName).join(', ')}</span>
							<span class="meta">Feat: {b.feat}</span>
						</label>
					{/each}
				</div>
				{#if background}
					<div class="details">
						<p class="rules">{background.featText}</p>
						<div class="checks" role="radiogroup" aria-label="Ability increases">
							<label
								><input
									type="radio"
									name="increase"
									checked={draft.increaseMode === 'two'}
									onchange={() => (draft.increaseMode = 'two')}
								/> +2 to one, +1 to another</label
							>
							<label
								><input
									type="radio"
									name="increase"
									checked={draft.increaseMode === 'three'}
									onchange={() => (draft.increaseMode = 'three')}
								/>
								+1 to all three ({background.abilities.map(abilityName).join(', ')})</label
							>
						</div>
						{#if draft.increaseMode === 'two'}
							<div class="row">
								<label class="field">
									<span>+2</span>
									<select
										value={draft.plusTwo ?? ''}
										onchange={(e) => (draft.plusTwo = e.currentTarget.value as AbilityId)}
									>
										<option value="" disabled>Choose…</option>
										{#each background.abilities as a (a)}
											<option value={a}>{abilityName(a)}</option>
										{/each}
									</select>
								</label>
								<label class="field">
									<span>+1</span>
									<select
										value={draft.plusOne ?? ''}
										onchange={(e) => (draft.plusOne = e.currentTarget.value as AbilityId)}
									>
										<option value="" disabled>Choose…</option>
										{#each background.abilities.filter((a) => a !== draft.plusTwo) as a (a)}
											<option value={a}>{abilityName(a)}</option>
										{/each}
									</select>
								</label>
							</div>
						{/if}
					</div>
				{/if}
			</fieldset>
		{:else if draft.step === 'abilities'}
			<fieldset>
				<legend>Ability scores</legend>
				<div class="checks" role="radiogroup" aria-label="How to set the scores">
					<label
						><input
							type="radio"
							name="method"
							checked={draft.method === 'standard-array'}
							onchange={() => setMethod('standard-array')}
						/>
						Standard array ({options.standardArray.join(', ')})</label
					>
					<label
						><input
							type="radio"
							name="method"
							checked={draft.method === 'point-buy'}
							onchange={() => setMethod('point-buy')}
						/>
						Point buy ({options.points} points)</label
					>
				</div>
				{#if klass}<p class="meta">A {klass.name} relies most on {klass.primary}.</p>{/if}
				<div class="scores">
					{#each ABILITY_IDS as a (a)}
						<div class="score">
							<span class="name"><Icon name={ABILITY_ICON[a]} size="1.1em" />{abilityName(a)}</span>
							{#if draft.method === 'standard-array'}
								<select
									aria-label={abilityName(a)}
									value={draft.base[a] === null ? '' : String(draft.base[a])}
									onchange={(e) =>
										(draft.base = {
											...draft.base,
											[a]: e.currentTarget.value ? Number(e.currentTarget.value) : null
										})}
								>
									<option value="">–</option>
									{#each [...new Set( [...unplaced(draft, options), ...(draft.base[a] === null ? [] : [draft.base[a]])] )].sort((x, y) => (y ?? 0) - (x ?? 0)) as v (v)}
										<option value={String(v)}>{v}</option>
									{/each}
								</select>
							{:else}
								<span class="buy">
									<button
										type="button"
										aria-label="Lower {abilityName(a)}"
										disabled={options.pointCost[String((draft.base[a] ?? 8) - 1)] === undefined}
										onclick={() => bump(a, -1)}>−</button
									>
									<b class="num">{draft.base[a]}</b>
									<button
										type="button"
										aria-label="Raise {abilityName(a)}"
										disabled={options.pointCost[String((draft.base[a] ?? 8) + 1)] === undefined}
										onclick={() => bump(a, 1)}>+</button
									>
								</span>
							{/if}
						</div>
					{/each}
				</div>
				{#if draft.method === 'point-buy'}
					<p class="meta num">
						{options.points - pointsSpent(draft, options)} of {options.points} points left
					</p>
				{/if}
				<p class="meta">
					Your background's increases are added on top; the review shows the totals.
				</p>
			</fieldset>
		{:else if draft.step === 'skills'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else}
				<fieldset>
					<legend>Class skills ({draft.skills.length} of {klass.skills.count})</legend>
					{#if known.length}
						<p class="meta">Already yours: {known.map(skillName).join(', ')}.</p>
					{/if}
					<div class="checks">
						{#each options.skills.filter((s) => !klass.skills.from || klass.skills.from.includes(s.id)) as s (s.id)}
							<label
								><input
									type="checkbox"
									disabled={known.includes(s.id)}
									checked={draft.skills.includes(s.id)}
									onchange={() => {
										draft.skills = toggle(draft.skills, s.id, klass.skills.count);
										draft.expertise = draft.expertise.filter((x) =>
											[...known, ...draft.skills].includes(x)
										);
									}}
								/>
								{s.name}</label
							>
						{/each}
					</div>
				</fieldset>
				{#if klass.expertise}
					<fieldset>
						<legend>Expertise ({draft.expertise.length} of {klass.expertise})</legend>
						<div class="checks">
							{#each proficient as id (id)}
								<label
									><input
										type="checkbox"
										checked={draft.expertise.includes(id)}
										onchange={() =>
											(draft.expertise = toggle(draft.expertise, id, klass.expertise))}
									/>
									{skillName(id)}</label
								>
							{/each}
						</div>
					</fieldset>
				{/if}
				{#if klass.fightingStyle}
					<fieldset>
						<legend>Fighting Style</legend>
						{#each options.fightingStyles as f (f.id)}
							<label class="option"
								><input
									type="radio"
									name="style"
									checked={draft.fightingStyle === f.id}
									onchange={() => (draft.fightingStyle = f.id)}
								/>
								<b>{f.name}</b> <span class="rules">{f.text}</span></label
							>
						{/each}
					</fieldset>
				{/if}
				{#if klass.weaponMastery.count}
					<fieldset>
						<legend>Weapon Mastery ({draft.masteries.length} of {klass.weaponMastery.count})</legend
						>
						<div class="checks">
							{#each trained.filter((w) => !klass.weaponMastery.melee || w.type === 'melee') as w (w.id)}
								<label
									><input
										type="checkbox"
										checked={draft.masteries.includes(w.id)}
										onchange={() =>
											(draft.masteries = toggle(draft.masteries, w.id, klass.weaponMastery.count))}
									/>
									{w.name} <span class="meta">({w.mastery})</span></label
								>
							{/each}
						</div>
					</fieldset>
				{/if}
			{/if}
		{:else if draft.step === 'spells'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else if !klass.spells}
				<p class="help">A {klass.name} casts no spells at level 1. Carry on.</p>
			{:else}
				{@const spells = klass.spells}
				<p class="help">
					Spells marked “not at the table yet” can still be chosen; they are on the sheet, and play
					when the table comes to them.
				</p>
				{#each [{ level: 0, max: spells.cantrips, key: 'cantrips' as const, title: 'Cantrips' }, { level: 1, max: spells.prepared, key: 'prepared' as const, title: 'Prepared spells' }] as group (group.key)}
					{#if group.max}
						<fieldset>
							<legend>{group.title} ({draft[group.key].length} of {group.max})</legend>
							{#each spells.list.filter( (sp) => (group.level === 0 ? sp.level === 0 : sp.level > 0) ) as sp (sp.id)}
								<label class="option"
									><input
										type="checkbox"
										checked={draft[group.key].includes(sp.id)}
										onchange={() => (draft[group.key] = toggle(draft[group.key], sp.id, group.max))}
									/>
									<b>{sp.name}</b>
									<span class="meta"
										>{sp.level ? `Level ${sp.level} ` : ''}{sp.school} · {sp.castingTime} · {sp.range}{sp.concentration
											? ' · Concentration'
											: ''}{sp.why ? ' · not at the table yet' : ''}{sp.homebrew
											? ` · Homebrew: ${sp.homebrew}`
											: sp.licensed
												? ` · Licensed: ${sp.licensed}`
												: ''}</span
									>
									<span class="rules">{sp.text}</span></label
								>
							{/each}
						</fieldset>
					{/if}
				{/each}
			{/if}
		{:else if draft.step === 'gear'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else}
				<fieldset>
					<legend>Armor</legend>
					<label class="field">
						<span>Worn</span>
						<select
							value={draft.armor ?? ''}
							onchange={(e) => (draft.armor = e.currentTarget.value || null)}
						>
							<option value="">No armor</option>
							{#each options.armor.filter((a) => a.category !== 'shield' && klass.armor.includes(a.category)) as a (a.id)}
								<option value={a.id}
									>{a.name} (AC {a.armorClass}{a.strength
										? `, Strength ${a.strength}`
										: ''}){a.homebrew
										? ` · Homebrew: ${a.homebrew}`
										: a.licensed
											? ` · Licensed: ${a.licensed}`
											: ''}</option
								>
							{/each}
						</select>
					</label>
					{#if klass.armor.includes('shield')}
						<label
							><input type="checkbox" bind:checked={draft.shield} /> A Shield (+2 Armor Class)</label
						>
					{/if}
				</fieldset>
				<fieldset>
					<legend>Weapons ({draft.weapons.length} of up to {options.weaponsMax})</legend>
					<div class="checks">
						{#each trained as w (w.id)}
							<label
								><input
									type="checkbox"
									checked={draft.weapons.includes(w.id)}
									onchange={() =>
										(draft.weapons = toggle(draft.weapons, w.id, options!.weaponsMax))}
								/>
								{w.name}
								<span class="meta"
									>{w.damage}
									{w.damageType.toLowerCase()}{w.homebrew
										? ` · Homebrew: ${w.homebrew}`
										: w.licensed
											? ` · Licensed: ${w.licensed}`
											: ''}</span
								></label
							>
						{/each}
					</div>
				</fieldset>
			{/if}
		{:else}
			<fieldset>
				<legend>Name and colour</legend>
				<label class="field">
					<span>Name</span>
					<input type="text" maxlength="40" bind:value={draft.name} />
				</label>
				<div class="swatches" role="radiogroup" aria-label="Colour">
					{#each options.colors as c (c)}
						<button
							type="button"
							class="swatch"
							role="radio"
							aria-checked={draft.color === c}
							aria-label={c}
							style:--swatch={c}
							onclick={() => (draft.color = c)}
						></button>
					{/each}
				</div>
			</fieldset>
			{#if !ready}
				<div class="todo">
					<p class="lead"><Icon name="warn" size="1.1em" />Still to choose:</p>
					<ul>
						{#each STEPS as s (s.id)}
							{#each todo(draft, options, s.id) as t (t)}
								<li>
									<button type="button" class="link" onclick={() => go(s.id)}>{s.title}</button>: {t}
								</li>
							{/each}
						{/each}
					</ul>
				</div>
			{:else if preview && !preview.ok}
				<div class="todo" role="alert">
					<p class="lead"><Icon name="warn" size="1.1em" />The rules don't allow this yet:</p>
					<ul>
						{#each preview.problems as p (p)}<li>{p}</li>{/each}
					</ul>
				</div>
			{:else if summary}
				<div class="summary">
					<h3>{draft.name || 'Your character'}: {summary.title}</h3>
					<dl class="vitals num">
						<div>
							<dt><Icon name="heart" size="1.1em" />HP</dt>
							<dd>{summary.hp}</dd>
						</div>
						<div>
							<dt><Icon name="shield" size="1.1em" />Armor Class</dt>
							<dd>{summary.armorClass}</dd>
						</div>
						<div>
							<dt><Icon name="compass" size="1.1em" />Speed</dt>
							<dd>{summary.speed} ft.</dd>
						</div>
						<div>
							<dt><Icon name="sparkle" size="1.1em" />Initiative</dt>
							<dd>{signed(summary.initiative)}</dd>
						</div>
						<div>
							<dt><Icon name="check" size="1.1em" />Proficiency</dt>
							<dd>{signed(summary.proficiency)}</dd>
						</div>
					</dl>
					<ul class="totals num" aria-label="Ability scores">
						{#each summary.scores as s (s.id)}
							<li>
								<span class="lab"><Icon name={ABILITY_ICON[s.id]} size="1.1em" />{s.name}</span>
								<b>{s.score}</b>
								<small>{signed(s.modifier)}</small>
							</li>
						{/each}
					</ul>
					<p>
						Skills: {summary.skills
							.filter((s) => s.proficient)
							.map((s) => `${s.name} ${signed(s.bonus)}${s.expertise ? ' (Expertise)' : ''}`)
							.join(', ')}
					</p>
					<ul>
						{#each summary.actions as a (a.name)}<li><b>{a.name}</b>: {a.summary}</li>{/each}
					</ul>
					<p class="meta">
						Features: {summary.features.join(', ')}. Feats: {summary.feats.join(', ')}.
					</p>
					{#if summary.spellcasting}
						<p class="meta">
							Spell save DC {summary.spellcasting.saveDc}, spell attack {signed(
								summary.spellcasting.attackBonus
							)}. Spells come to the table later; for now this character fights with its weapons.
						</p>
					{/if}
				</div>
			{:else}
				<p class="help">Asking the table what this comes to…</p>
			{/if}
		{/if}

		{#if options && draft.step !== 'review' && left.length}
			<p class="meta" aria-live="polite">{left.join(' ')}</p>
		{/if}

		<footer>
			<button type="button" class="ghost" onclick={onClose}>
				<Icon name="users" size="1.1em" />Back to the characters
			</button>
			<span class="spacer"></span>
			{#if stepIndex > 0}
				<button type="button" onclick={back}><Icon name="back" size="1.1em" />Back</button>
			{/if}
			{#if draft.step !== 'review'}
				<button type="button" class="primary" disabled={left.length > 0} onclick={next}>
					Next<Icon name="chevron" size="1.1em" />
				</button>
			{:else}
				<button
					type="button"
					class="primary"
					disabled={!ready || !summary || building}
					onclick={create}
				>
					<Icon name="play" size="1.1em" />{building ? 'Creating…' : 'Create and play'}
				</button>
			{/if}
		</footer>
		{#if options}<p class="attribution">{options.attribution}</p>{/if}
	</section>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		padding: 4.5rem var(--sp-6) var(--sp-6);
		background: radial-gradient(90% 80% at 50% 45%, rgba(10, 8, 6, 0.5), rgba(10, 8, 6, 0.88));
		overflow-y: auto;
		z-index: var(--z-panel);
	}

	.creator {
		width: min(56rem, 100%);
		margin: auto;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-5);
		padding: var(--sp-7);
		border-radius: var(--radius-lg);
		animation: g-pop 420ms var(--spring) backwards;
	}

	header {
		display: grid;
		justify-items: center;
		gap: var(--sp-4);
		min-width: 0;
		text-align: center;
	}

	.g-banner {
		max-width: 100%;
		margin-top: calc(-1 * var(--sp-3));
		font-size: var(--fs-xl);
	}

	.who {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		max-width: 100%;
		text-align: left;
	}

	.track {
		width: 100%;
		min-width: 0;
		border-radius: var(--radius-md);
		background: rgba(16, 11, 8, 0.6);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		overflow-x: auto;
	}

	h3 {
		margin: 0 0 var(--sp-2);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		color: var(--text);
	}

	.help,
	.meta,
	.rules,
	.attribution {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
		max-width: 70ch;
	}

	.help {
		font-family: var(--font-display);
		font-style: italic;
		color: #d8c6a4;
	}

	.attribution {
		font-size: var(--fs-xs);
	}

	/* A step is a tray set into the frame; its legend is the plate along the top. */
	fieldset {
		display: grid;
		gap: var(--sp-4);
		min-width: 0;
		margin: 0;
		padding: var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.2);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		animation: g-rise 360ms var(--ease-out) backwards;
	}

	legend {
		padding: 0 var(--sp-4);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--gilt);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
		gap: var(--sp-4);
	}

	/* A choice: a plaque with its glyph. The chosen one is lit in brass. */
	.card {
		position: relative;
		display: grid;
		justify-items: start;
		align-content: start;
		gap: var(--sp-2);
		min-height: 2.75rem;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(255, 220, 160, 0.1), transparent 60%),
			linear-gradient(180deg, #3b2c20, #231911);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 4px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line);
		cursor: pointer;
		transition:
			transform 180ms var(--spring),
			box-shadow 180ms var(--ease-out);
	}

	.card:hover {
		transform: translateY(-2px);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 0 0 4px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line),
			0 0 18px rgba(224, 164, 88, 0.25);
	}

	.card.chosen {
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(255, 220, 160, 0.26), transparent 62%),
			linear-gradient(180deg, #54402b, #2f2218);
		box-shadow:
			inset 0 0 0 2px var(--gilt),
			inset 0 0 0 5px rgba(0, 0, 0, 0.3),
			0 3px 0 var(--ink-line),
			0 0 22px rgba(224, 164, 88, 0.4);
	}

	.card.chosen::after {
		content: '';
		position: absolute;
		top: var(--sp-3);
		right: var(--sp-3);
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23382008' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12.5 4.5 4.5L19 7.5'/%3E%3C/svg%3E")
				center / 72% no-repeat,
			var(--gilt-grad);
		box-shadow: 0 0 0 1px var(--ink-line);
	}

	.card input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.card:focus-within {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--gilt-hi);
	}

	.name {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.card .meta {
		font-size: var(--fs-xs);
	}

	.details {
		display: grid;
		gap: var(--sp-3);
	}

	.details details {
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.details summary {
		min-height: 2.75rem;
		padding: var(--sp-3) var(--sp-5);
		font-family: var(--font-label);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--gilt-hi);
		cursor: pointer;
	}

	.details summary:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: -2px;
	}

	details p {
		margin: 0;
		padding: 0 var(--sp-5) var(--sp-4);
		color: var(--muted);
		font-size: var(--fs-sm);
		white-space: pre-line;
	}

	.field {
		display: grid;
		gap: var(--sp-2);
		max-width: 22rem;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}

	.checks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	/* A tick-box, a plate to press: the whole row is the target. */
	.checks label,
	.option {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.75rem;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		cursor: pointer;
	}

	/* A spell or a style: the tick-box, then its name, its facts and its rules on their own lines. */
	.option {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		column-gap: var(--sp-4);
		row-gap: var(--sp-1);
		padding-block: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.option > input {
		grid-row: 1 / span 3;
		margin-top: 0.2rem;
	}

	.option > :not(input) {
		grid-column: 2;
	}

	.checks label:has(:checked),
	.option:has(:checked) {
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			0 0 12px rgba(224, 164, 88, 0.22);
	}

	.checks label:has(:focus-visible),
	.option:has(:focus-visible) {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	input[type='checkbox'],
	input[type='radio'] {
		accent-color: var(--gilt);
	}

	.option b {
		font-family: var(--font-label);
		letter-spacing: 0.03em;
	}

	/* Ability scores: engraved plates with the number big in the middle. */
	.scores {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--sp-4);
	}

	.score {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-3);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 5px rgba(0, 0, 0, 0.65),
			inset 0 0 0 1px var(--gilt-line),
			0 1px 0 rgba(240, 212, 158, 0.12);
	}

	.score .name {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.score select {
		width: 100%;
		min-height: 2.75rem;
		text-align: center;
	}

	.buy {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
	}

	.buy b {
		min-width: 2ch;
		text-align: center;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		line-height: 1;
		color: var(--gilt-hi);
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
	}

	.buy button {
		width: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
		font-size: var(--fs-lg);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	.swatch {
		width: 2.75rem;
		height: 2.75rem;
		min-height: 0;
		padding: 0;
		border-radius: 50%;
		background: var(--swatch);
		border: 2px solid var(--ink-line);
		box-shadow:
			inset 0 0 0 2px rgba(255, 244, 214, 0.25),
			0 2px 0 var(--ink-line);
	}

	.swatch[aria-checked='true'] {
		border-color: var(--gilt-hi);
		box-shadow:
			inset 0 0 0 2px rgba(255, 244, 214, 0.5),
			0 0 0 3px var(--gilt),
			0 0 16px rgba(224, 164, 88, 0.5);
	}

	/* What is left to choose, or what the rules refuse: a warning plate. */
	.todo {
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(67, 32, 26, 0.35);
		box-shadow: inset 0 0 0 1px rgba(255, 170, 150, 0.25);
		font-size: var(--fs-sm);
		color: #ffd7cf;
	}

	.todo .lead {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-family: var(--font-label);
		letter-spacing: 0.04em;
	}

	.todo ul,
	.summary ul:not(.totals) {
		margin: var(--sp-2) 0 0;
		padding-left: var(--sp-5);
	}

	.todo p,
	.summary p {
		margin: 0 0 var(--sp-1);
	}

	.link {
		min-height: 0;
		padding: 0;
		border: 0;
		background: none;
		box-shadow: none;
		color: var(--gilt-hi);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.summary {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.2);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		animation: g-rise 360ms var(--ease-out) backwards;
	}

	.summary > * {
		margin: 0;
	}

	.summary h3 {
		font-size: var(--fs-xl);
	}

	.vitals {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: var(--sp-4);
		margin: 0;
	}

	.vitals > div,
	.totals li {
		display: grid;
		justify-items: center;
		gap: var(--sp-1);
		padding: var(--sp-4) var(--sp-2);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 5px rgba(0, 0, 0, 0.65),
			inset 0 0 0 1px var(--gilt-line),
			0 1px 0 rgba(240, 212, 158, 0.12);
	}

	.vitals dt,
	.totals .lab {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.vitals dd,
	.totals b {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1;
		color: var(--gilt-hi);
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
	}

	.totals {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.totals small {
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-4);
	}

	footer button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.75rem;
	}

	.spacer {
		flex: 1;
	}

	@media (max-width: 48rem) {
		/* Below the two rows of bars the table keeps along the top on a phone. */
		.backdrop {
			padding: 8.5rem var(--sp-3) var(--sp-3);
		}

		.creator {
			padding: var(--sp-6) var(--sp-5);
		}

		.who {
			flex-direction: column;
			text-align: center;
		}

		.scores {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		footer .spacer {
			display: none;
		}

		footer button {
			flex: 1 1 auto;
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.creator,
		fieldset,
		.summary {
			animation: none;
		}

		.card {
			transition: none;
		}

		.card:hover {
			transform: none;
		}
	}
</style>
