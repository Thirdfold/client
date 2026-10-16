<script lang="ts" module>
	import type { AssetId, Rotation } from '$lib/game/props';
	import type { LightKind } from '$lib/game/lights';
	import { loadManifest } from '$lib/assets/load';
	import { ART_STYLES, type ArtStyle } from '$lib/assets/manifest';

	export type BuildTool =
		| 'select'
		| 'wall'
		| 'door'
		| 'erase'
		| 'reveal'
		| 'hide'
		| 'reveal-room'
		| 'hide-room'
		| 'light'
		| 'prop'
		| 'height'
		| 'floor'
		| 'dark'
		| 'roof';

	/** The prop the GM is about to place. */
	export interface PropDraft {
		assetId: AssetId;
		rotation: Rotation;
	}

	/** Settings for the next light the GM places. */
	export interface LightDraft {
		kind: LightKind;
		radius: number;
		color: string;
	}
</script>

<script lang="ts">
	import {
		LIGHT_COLORS,
		LIGHT_KINDS,
		lightKindName,
		MAX_LIGHT_RADIUS,
		type Ambient
	} from '$lib/game/lights';
	import type { WorldLook } from '$lib/game/world';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { ASSET_IDS, ASSETS, PROP_CATEGORIES } from '$lib/game/props';
	import { FLOORS, type FloorId } from '$lib/game/floor';
	import GrassPaint, { type GrassDraft } from './GrassPaint.svelte';
	import { MAX_LEVEL } from '$lib/game/terrain';
	import { FLOOR_LOOKS } from '$lib/tabletop/floor-looks';
	import { keysOfTool } from './keys';
	import { WALL_LEVELS } from '$lib/game/visibility';
	import { Icon, type IconName } from '$lib/ui/game';
	import Field from './room/Field.svelte';
	import PanelTitle from './room/PanelTitle.svelte';
	import Swatch from './room/Swatch.svelte';
	import Toggle from './room/Toggle.svelte';
	import ToolSlot from './room/ToolSlot.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		tool: BuildTool;
		fogEnabled: boolean;
		/** Whether players see through the whole party's eyes. */
		fogShared: boolean;
		ambient: Ambient;
		world: WorldLook;
		/** The hour the clock shows now (it moves while the clock runs). */
		hour?: number;
		send(action: RoomAction): boolean;
		lightDraft: LightDraft;
		propDraft: PropDraft;
		onTool(tool: BuildTool): void;
		onFog(enabled: boolean): void;
		onFogAll(reveal: boolean): void;
		onFogShared(shared: boolean): void;
		/** How the table looks: an environment asset's id, or null for the plain table. */
		environment: string | null;
		onEnvironment(environment: string | null): void;
		onLightDraft(draft: LightDraft): void;
		onPropDraft(draft: PropDraft): void;
		/** The level the height tool sets cells to. */
		heightLevel: number;
		onHeightLevel(level: number): void;
		/** The floor the floor tool paints. */
		floorDraft: FloorId;
		onFloorDraft(floor: FloorId): void;
		/** The grass the floor tool paints instead, or null to paint floors. */
		grassDraft: GrassDraft | null;
		onGrassDraft(grass: GrassDraft | null): void;
	}

	let {
		tool,
		fogEnabled,
		fogShared,
		ambient,
		world,
		hour,
		send,
		lightDraft,
		propDraft,
		onTool,
		onFog,
		onFogAll,
		onFogShared,
		environment,
		onEnvironment,
		onLightDraft,
		onPropDraft,
		heightLevel,
		onHeightLevel,
		floorDraft,
		onFloorDraft,
		grassDraft,
		onGrassDraft
	}: Props = $props();

	const floorSwatch = (id: FloorId) =>
		id === 'plain' ? 'transparent' : `#${FLOOR_LOOKS[id].color.toString(16).padStart(6, '0')}`;

	// Off the map last, after the floors appended behind it (#248).
	const FLOOR_CHOICES = [
		...FLOORS.filter((f) => f.id !== 'void'),
		...FLOORS.filter((f) => f.id === 'void')
	];

	const BLOCKS_HINT = { none: 'walk over', movement: 'blocks movement', sight: 'blocks sight' };

	// The palette in the catalogue's groups, empty ones left out, by art style when the GM picks one.
	let styles = $state<Record<string, ArtStyle | undefined>>({});
	let style = $state<ArtStyle | ''>('');
	const PROP_GROUPS = $derived(
		PROP_CATEGORIES.map(
			(category) =>
				[
					category,
					ASSET_IDS.filter(
						(id) => ASSETS[id].category === category && (!style || styles[id] === style)
					)
				] as const
		).filter(([, ids]) => ids.length > 0)
	);

	let environments = $state<[string, string][]>([]);
	$effect(() => {
		void loadManifest().then((m) => {
			environments = Object.entries(m.environments).map(([id, e]) => [id, e.name]);
			styles = Object.fromEntries(Object.entries(m.models).map(([id, e]) => [id, e.style]));
		});
	});

	interface ToolDef {
		id: BuildTool;
		label: string;
		icon: IconName;
	}

	const BUILD: ToolDef[] = [
		{ id: 'select', label: 'Select', icon: 'compass' },
		{ id: 'wall', label: 'Wall', icon: 'grid' },
		{ id: 'door', label: 'Door', icon: 'door' },
		{ id: 'erase', label: 'Erase', icon: 'trash' }
	];
	const FOG: ToolDef[] = [
		{ id: 'reveal', label: 'Reveal', icon: 'eye' },
		{ id: 'hide', label: 'Hide', icon: 'eyeoff' },
		{ id: 'reveal-room', label: 'Reveal room', icon: 'door' },
		{ id: 'hide-room', label: 'Hide room', icon: 'lock' }
	];
	const GROUND: ToolDef[] = [
		{ id: 'floor', label: 'Paint floor', icon: 'pencil' },
		{ id: 'height', label: 'Shape ground', icon: 'map' },
		{ id: 'dark', label: 'Dark area', icon: 'eyeoff' },
		{ id: 'roof', label: 'Roof', icon: 'home' },
		{ id: 'light', label: 'Place light', icon: 'flame' }
	];
</script>

{#snippet toolButton(t: ToolDef, wide = false)}
	<ToolSlot
		icon={t.icon}
		label={t.label}
		kbd={keysOfTool(t.id)[0]}
		{wide}
		pressed={tool === t.id}
		title={`${t.label} (${keysOfTool(t.id).join(' or ')})`}
		onclick={() => onTool(t.id)}
	/>
{/snippet}

<section class="build" aria-label="Build tools">
	<PanelTitle icon="cube">Build</PanelTitle>

	<Tray title="Walls and doors" icon="grid">
		<div class="tools four" role="toolbar" aria-label="Build tools">
			{#each BUILD as t (t.id)}{@render toolButton(t)}{/each}
		</div>
	</Tray>

	<Tray title="Props" icon="cube">
		{@render toolButton({ id: 'prop', label: 'Place prop', icon: 'cube' }, true)}
		{#if tool === 'prop'}
			{#if ART_STYLES.some((a) => Object.values(styles).includes(a))}
				<Field label="Style">
					<select bind:value={style} aria-label="Prop style">
						<option value="">Any style</option>
						{#each ART_STYLES as a (a)}<option value={a}>{a}</option>{/each}
					</select>
				</Field>
			{/if}
			<div class="palette" role="radiogroup" aria-label="Prop">
				{#each PROP_GROUPS as [category, ids] (category)}
					<h4 class="group">{category.replace('-', ' ')}</h4>
					{#if category === 'effects'}
						<!-- A floor fire is a fire-kind light: it burns and lights cells for the rules. -->
						<button
							type="button"
							class="fire"
							title="A fire on the floor: also lights the cells round it"
							onclick={() => (onLightDraft({ ...lightDraft, kind: 'fire' }), onTool('light'))}
							><Icon name="flame" size="1.1em" /> Floor fire</button
						>
					{/if}
					{#each ids as id (id)}
						<button
							type="button"
							role="radio"
							aria-checked={propDraft.assetId === id}
							title={`${ASSETS[id].name}: ${BLOCKS_HINT[ASSETS[id].blocks]}`}
							onclick={() => onPropDraft({ ...propDraft, assetId: id })}>{ASSETS[id].name}</button
						>
					{/each}
				{/each}
			</div>
			<button
				type="button"
				class="rotate"
				title="Rotate ( [ or ] )"
				onclick={() =>
					onPropDraft({ ...propDraft, rotation: ((propDraft.rotation + 1) % 4) as Rotation })}
				><Icon name="refresh" /> Rotate ({propDraft.rotation * 90}°)</button
			>
		{/if}
	</Tray>

	<Tray title="Ground and light" icon="map">
		<div class="tools three">
			{#each GROUND as t (t.id)}{@render toolButton(t)}{/each}
		</div>
		{#if tool === 'dark'}
			<p class="hint">
				Click two corners. Only light lets anyone see in a dark area, even by day. Start on a dark
				cell to lift the dark instead.
			</p>
		{:else if tool === 'roof'}
			<p class="hint">
				Click two corners to roof an area; roofed cells show green while the tool is out. A roof
				only changes the look, never sight or light. Start on a roofed cell to lift the roof.
			</p>
		{:else if tool === 'floor'}
			<GrassPaint draft={grassDraft} onDraft={onGrassDraft} />
			{#if !grassDraft}
				<div class="floors" role="group" aria-label="Floor">
					{#each FLOOR_CHOICES as f (f.id)}
						<button
							type="button"
							class="floor-choice"
							aria-pressed={floorDraft === f.id}
							onclick={() => onFloorDraft(f.id)}
						>
							<span class="chip" class:plain={f.id === 'plain'} style:background={floorSwatch(f.id)}
							></span>
							{f.name}
						</button>
					{/each}
				</div>
				<p class="hint">
					Click two corners of an area. Off the map: nobody can stand there. Default ground clears
					the paint.
				</p>
			{/if}
		{:else if tool === 'height'}
			<Field label="Level (0 floor, {WALL_LEVELS} a wall high)" inline>
				<input
					type="number"
					min="0"
					max={MAX_LEVEL}
					value={heightLevel}
					aria-label="Ground level"
					onchange={(e) => {
						const level = Math.round(e.currentTarget.valueAsNumber);
						if (level >= 0 && level <= MAX_LEVEL) onHeightLevel(level);
					}}
				/>
			</Field>
			<p class="hint">Click two corners of an area. Stairs rise one level a cell.</p>
		{:else if tool === 'light'}
			<Field label="Kind">
				<select
					value={lightDraft.kind}
					aria-label="Light kind"
					onchange={(e) =>
						onLightDraft({ ...lightDraft, kind: e.currentTarget.value as LightKind })}
				>
					{#each LIGHT_KINDS as kind (kind)}
						<option value={kind}>{lightKindName(kind)}</option>
					{/each}
				</select>
			</Field>
			<Field label="Radius (cells)" inline>
				<input
					type="number"
					min="1"
					max={MAX_LIGHT_RADIUS}
					value={lightDraft.radius}
					aria-label="Light radius"
					onchange={(e) => {
						const radius = Math.round(e.currentTarget.valueAsNumber);
						if (radius >= 1 && radius <= MAX_LIGHT_RADIUS) onLightDraft({ ...lightDraft, radius });
					}}
				/>
			</Field>
			<div class="swatches" role="group" aria-label="Light colour">
				{#each LIGHT_COLORS as c (c.color)}
					<Swatch
						color={c.color}
						title={c.name}
						label={c.name}
						pressed={lightDraft.color === c.color}
						onclick={() => onLightDraft({ ...lightDraft, color: c.color })}
					/>
				{/each}
			</div>
		{/if}
	</Tray>

	<Tray title="The sky" icon="sparkle">
		<!-- GM only: loaded on its own so the players' room page stays small. -->
		{#await import('./TimeOfDay.svelte') then { default: TimeOfDay }}
			<TimeOfDay {world} {hour} {ambient} {environment} {send} />
		{/await}
		<Field label="Looks like">
			<select
				value={environment ?? ''}
				aria-label="How the world looks"
				onchange={(e) => onEnvironment(e.currentTarget.value || null)}
			>
				<option value="">Plain ground</option>
				{#each environments as [id, name] (id)}
					<option value={id}>{name}</option>
				{/each}
			</select>
		</Field>
	</Tray>

	<Tray title="Fog of war" icon="eye">
		<Toggle label="Fog of war" checked={fogEnabled} onchange={onFog} />
		{#if fogEnabled}
			<div class="tools two" role="toolbar" aria-label="Fog tools">
				{#each FOG as t (t.id)}{@render toolButton(t, true)}{/each}
			</div>
			<div class="all">
				<button type="button" onclick={() => onFogAll(true)}>Reveal all</button>
				<button type="button" onclick={() => onFogAll(false)}>Hide all</button>
			</div>
			<Toggle
				label="Shared party sight"
				title="Off: each player sees only through their own tokens."
				checked={fogShared}
				onchange={onFogShared}
			/>
		{/if}
	</Tray>
</section>

<style>
	.build {
		display: grid;
		gap: var(--sp-5);
	}

	.tools {
		display: grid;
		gap: var(--sp-4);
	}

	.four {
		grid-template-columns: repeat(4, 1fr);
	}

	.three {
		grid-template-columns: repeat(3, 1fr);
	}

	.two {
		grid-template-columns: repeat(2, 1fr);
	}

	/* The prop shelf: a plate for each piece, grouped by what it is. */
	.palette {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--sp-3);
	}

	.palette .group {
		grid-column: 1 / -1;
		margin: var(--sp-3) 0 0;
		padding-bottom: var(--sp-1);
		border-bottom: 1px solid rgba(240, 212, 158, 0.18);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: capitalize;
		color: var(--gilt);
	}

	.palette button {
		min-height: 2.4rem;
		padding: var(--sp-2) var(--sp-2);
		font-size: var(--fs-xs);
		line-height: 1.1;
	}

	.rotate,
	.all button,
	.palette .fire {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.floors {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
	}

	.floor-choice {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.2rem;
		padding: var(--sp-2) var(--sp-3);
		font-size: var(--fs-sm);
		text-align: left;
	}

	.chip {
		width: 1rem;
		height: 1rem;
		border-radius: var(--radius-sm);
		flex: none;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
	}

	.chip.plain {
		border: 1px dashed var(--muted);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		padding-block: var(--sp-2);
	}

	@media (max-width: 48rem) {
		.palette button,
		.floor-choice {
			min-height: 2.75rem;
		}
	}

	.all {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}
</style>
