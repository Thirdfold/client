<script lang="ts" module>
	/** A token the GM has described but not yet dropped on a cell. */
	export interface TokenDraft {
		name: string;
		color: string;
		ownerId: string | null;
	}
</script>

<script lang="ts">
	import { NAME_MAX_LENGTH } from '$lib/game/names';
	import type { PublicPlayer } from '$lib/game/protocol';
	import { MAX_TOKEN_LIFT, TOKEN_COLORS, TOKEN_SCALE, type Token } from '$lib/game/token';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { MAX_VISION } from '$lib/game/visibility';
	import { CARRIED_LIGHT_COLOR, LIGHT_COLORS, MAX_LIGHT_RADIUS } from '$lib/game/lights';
	import { loadManifest } from '$lib/assets/load';
	import {
		ART_STYLES,
		FIGURE_KINDS,
		isFigureKind,
		type ArtStyle,
		type FigureKind
	} from '$lib/assets/manifest';
	import { Icon, Portrait } from '$lib/ui/game';
	import Field from './room/Field.svelte';
	import PanelTitle from './room/PanelTitle.svelte';
	import Slider from './room/Slider.svelte';
	import Swatch from './room/Swatch.svelte';
	import Toggle from './room/Toggle.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		isGm: boolean;
		tokens: readonly Token[];
		players: readonly PublicPlayer[];
		myId: string;
		selected: Token | null;
		placing: TokenDraft | null;
		onSelect(id: string | null): void;
		onPlace(draft: TokenDraft | null): void;
		send(action: RoomAction): void;
	}

	let { isGm, tokens, players, myId, selected, placing, onSelect, onPlace, send }: Props = $props();

	let draft = $state<TokenDraft>({ name: '', color: TOKEN_COLORS[0], ownerId: null });

	const owners = $derived(players.filter((p) => p.role === 'player'));

	/** Figures a token can be drawn as, by kind (props, kit and the rest aren't figures). */
	const FIGURE_LABELS: Record<FigureKind, string> = {
		character: 'Characters',
		npc: 'People',
		enemy: 'Creatures'
	};
	let figures = $state<{ id: string; kind: FigureKind; style?: ArtStyle }[]>([]);
	let style = $state<ArtStyle | ''>(''); // the GM's filter; the token's own figure always shows
	$effect(() => {
		if (!isGm) return;
		void loadManifest().then((m) => {
			figures = Object.entries(m.models).flatMap(([id, e]) =>
				isFigureKind(e.kind) ? [{ id, kind: e.kind, style: e.style }] : []
			);
		});
	});
	const figureName = (id: string) => id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
	const playerName = (id: string | null) =>
		id === null ? 'GM only' : (players.find((p) => p.id === id)?.name ?? 'Unknown');
	const listed = $derived(isGm ? tokens : tokens.filter((t) => t.ownerId === myId));

	function startPlacing(event: SubmitEvent) {
		event.preventDefault();
		const name = draft.name.trim();
		if (!name) return;
		onPlace({ ...draft, name });
		// Ready the form for the next token: fresh name, next colour.
		const next =
			(TOKEN_COLORS.indexOf(draft.color as (typeof TOKEN_COLORS)[number]) + 1) %
			TOKEN_COLORS.length;
		draft = { name: '', color: TOKEN_COLORS[next], ownerId: draft.ownerId };
	}

	function setLight(token: Token, value: number) {
		const light = Math.round(value);
		if (
			Number.isFinite(light) &&
			light >= 0 &&
			light <= MAX_LIGHT_RADIUS &&
			light !== token.light
		) {
			send({ type: 'token_update', tokenId: token.id, patch: { light } });
		}
	}

	function setVision(token: Token, value: number) {
		const vision = Math.round(value);
		if (Number.isFinite(vision) && vision >= 0 && vision <= MAX_VISION && vision !== token.vision) {
			send({ type: 'token_update', tokenId: token.id, patch: { vision } });
		}
	}

	function rename(token: Token, value: string) {
		const name = value.trim();
		if (name && name !== token.name) {
			send({ type: 'token_update', tokenId: token.id, patch: { name } });
		}
	}
</script>

<section class="tokens" aria-label="Tokens">
	<PanelTitle icon="user">{isGm ? 'Tokens' : 'Your tokens'}</PanelTitle>

	{#if listed.length === 0}
		<p class="empty">
			{isGm ? 'No tokens on the map yet.' : 'The GM has not given you a token yet.'}
		</p>
	{:else}
		<ul class="list">
			{#each listed as token, i (token.id)}
				<li style:--i={i}>
					<button
						type="button"
						class="ghost token-row"
						aria-pressed={selected?.id === token.id}
						onclick={() => onSelect(selected?.id === token.id ? null : token.id)}
					>
						<Portrait name={token.name} color={token.color} size={32} />
						<span class="name">{token.name}</span>
						{#if isGm}<span class="owner">{playerName(token.ownerId)}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if isGm && selected}
		<Tray title="Selected" icon="user" class="inspector" aria-label="Selected token">
			<input
				value={selected.name}
				maxlength={NAME_MAX_LENGTH}
				aria-label="Token name"
				onchange={(e) => rename(selected, e.currentTarget.value)}
			/>
			<Field label="Controlled by">
				<select
					value={selected.ownerId ?? ''}
					onchange={(e) =>
						send({
							type: 'token_update',
							tokenId: selected.id,
							patch: { ownerId: e.currentTarget.value || null }
						})}
				>
					<option value="">GM only</option>
					{#each owners as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</Field>
			<Field label="Vision (cells, used when fog is on)" inline>
				<input
					type="number"
					min="0"
					max={MAX_VISION}
					step="1"
					value={selected.vision}
					aria-label="Token vision"
					onchange={(e) => setVision(selected, e.currentTarget.valueAsNumber)}
				/>
			</Field>
			<Field label="Carried light (cells, 0 = none)" inline>
				<input
					type="number"
					min="0"
					max={MAX_LIGHT_RADIUS}
					step="1"
					value={selected.light}
					aria-label="Token light"
					onchange={(e) => setLight(selected, e.currentTarget.valueAsNumber)}
				/>
			</Field>
			{#if selected.light > 0}
				<div class="swatches" role="group" aria-label="Carried light colour">
					{#each LIGHT_COLORS as c (c.color)}
						<Swatch
							color={c.color}
							title={c.name}
							label={`Light ${c.name}`}
							pressed={(selected.lightColor ?? CARRIED_LIGHT_COLOR) === c.color}
							onclick={() =>
								send({
									type: 'token_update',
									tokenId: selected.id,
									patch: { lightColor: c.color === CARRIED_LIGHT_COLOR ? null : c.color }
								})}
						/>
					{/each}
				</div>
			{/if}
			<Slider
				label="Size"
				reading="×{(selected.scale ?? 1).toFixed(2)}"
				ariaLabel="Token size"
				min={TOKEN_SCALE.min}
				max={TOKEN_SCALE.max}
				step={0.25}
				value={selected.scale ?? 1}
				onchange={(scale) => send({ type: 'token_update', tokenId: selected.id, patch: { scale } })}
			/>
			<Field label="Flying (levels)" inline>
				<input
					type="number"
					min="0"
					max={MAX_TOKEN_LIFT}
					step="1"
					value={selected.lift ?? 0}
					aria-label="Token flying height"
					onchange={(e) => {
						const lift = Math.round(e.currentTarget.valueAsNumber);
						if (lift >= 0 && lift <= MAX_TOKEN_LIFT && lift !== (selected.lift ?? 0)) {
							send({ type: 'token_update', tokenId: selected.id, patch: { lift } });
						}
					}}
				/>
			</Field>
			{#if figures.some((f) => f.style)}
				<Field label="Style">
					<select bind:value={style} aria-label="Figure style">
						<option value="">Any</option>
						{#each ART_STYLES as a (a)}<option value={a}>{a}</option>{/each}
					</select>
				</Field>
			{/if}
			<Field label="Figure">
				<select
					value={selected.model ?? ''}
					aria-label="Token figure"
					onchange={(e) =>
						send({
							type: 'token_update',
							tokenId: selected.id,
							patch: { model: e.currentTarget.value || null }
						})}
				>
					<option value="">Plain miniature</option>
					{#each FIGURE_KINDS as kind (kind)}
						{#if figures.some((f) => f.kind === kind)}
							<optgroup label={FIGURE_LABELS[kind]}>
								{#each figures.filter((f) => f.kind === kind && (!style || f.style === style || f.id === selected.model)) as f (f.id)}
									<option value={f.id}>{figureName(f.id)}</option>
								{/each}
							</optgroup>
						{/if}
					{/each}
				</select>
			</Field>
			<Toggle
				label="Hidden from players (its owner still sees it)"
				checked={selected.hidden === true}
				onchange={(hidden) =>
					send({ type: 'token_update', tokenId: selected.id, patch: { hidden } })}
			/>
			<div class="swatches" role="group" aria-label="Token colour">
				{#each TOKEN_COLORS as color (color)}
					<Swatch
						{color}
						label={`Colour ${color}`}
						pressed={selected.color === color}
						onclick={() => send({ type: 'token_update', tokenId: selected.id, patch: { color } })}
					/>
				{/each}
			</div>
			<button
				type="button"
				class="danger remove"
				onclick={() => send({ type: 'token_delete', tokenId: selected.id })}
			>
				<Icon name="trash" /> Remove from the map
			</button>
		</Tray>
	{/if}

	{#if isGm}
		<form class="new" onsubmit={startPlacing}>
			<Tray title="New token" icon="plus">
				<input
					bind:value={draft.name}
					maxlength={NAME_MAX_LENGTH}
					placeholder="Name, e.g. Goblin"
					aria-label="New token name"
				/>
				<Field label="Controlled by">
					<select bind:value={draft.ownerId}>
						<option value={null}>GM only</option>
						{#each owners as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</Field>
				<div class="swatches" role="group" aria-label="New token colour">
					{#each TOKEN_COLORS as color (color)}
						<Swatch
							{color}
							label={`Colour ${color}`}
							pressed={draft.color === color}
							onclick={() => (draft.color = color)}
						/>
					{/each}
				</div>
				{#if placing}
					<button type="button" onclick={() => onPlace(null)}>
						<Icon name="close" /> Cancel placing
					</button>
				{:else}
					<button class="primary" type="submit" disabled={!draft.name.trim()}>
						<Icon name="map" /> Place on the map
					</button>
				{/if}
			</Tray>
		</form>
	{/if}
</section>

<style>
	.tokens {
		display: grid;
		gap: var(--sp-5);
	}

	.empty {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		color: var(--muted);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
		max-height: 13rem;
		overflow-y: auto;
		padding-block: var(--sp-2);
	}

	.list li {
		animation: g-rise 360ms var(--ease-out) calc(var(--i) * 50ms) backwards;
	}

	/* A token on the roster: its medallion, its name, whose it is. Chosen = lit and pressed in. */
	.token-row {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		padding: var(--sp-2) var(--sp-5) var(--sp-2) var(--sp-3);
		color: var(--text);
		text-align: left;
	}

	.token-row[aria-pressed='true'] {
		border-color: var(--ink-line);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-md);
	}

	.owner {
		font-family: var(--font-ui);
		font-size: var(--fs-xs);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--muted);
	}

	.token-row[aria-pressed='true'] .owner {
		color: var(--gilt);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		padding-block: var(--sp-2);
	}

	.remove,
	.new button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}

	@media (prefers-reduced-motion: reduce) {
		.list li {
			animation: none;
		}
	}
</style>
