<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { defenseFor } from '$lib/adventure/characters';
	import { play } from '$lib/audio/engine';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { CreatorReply, RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon, Portrait } from '$lib/ui/game';
	import { loadDraft } from './dnd/creator-draft';
	import { actionIcon, roleOf, traitsOf } from './room/character';
	import { withoutArticle } from './room/names';
	import Steps from './Steps.svelte';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		send(action: RoomAction): boolean;
		/** For a story whose players may build their own characters. */
		roomId?: string;
		creatorReply?: CreatorReply | null;
		/** This player's name: a campaign's characters are kept for their players. */
		myName?: string;
	}

	let { adventure, players, send, roomId = '', creatorReply = null, myName = '' }: Props = $props();

	/** A character the campaign brought, and the player it is kept for. */
	const memberOf = (id: string) => adventure.campaign?.members.find((m) => m.id === id) ?? null;
	const keptFor = (id: string) => {
		const player = memberOf(id)?.player;
		return player && player.toLowerCase() !== myName.toLowerCase() ? player : null;
	};

	/** The rules' character creator, where the story lets players build their own. */
	const canCreate = $derived(adventure.build?.rules === 'dnd-5.5e' && !!roomId);
	// A creation left half-way opens where it was.
	let creating = $state(false);
	$effect.pre(() => {
		if (canCreate && roomId && loadDraft(roomId)) creating = true;
	});

	const status = (id: string) => adventure.characters.find((c) => c.id === id);
	const baseDefense = defenseFor(0);
	const classic = $derived(adventure.rules.id === 'thirdfold-classic');
	/** In the story with nobody playing it (a continued game): a player can take it up. */
	const unclaimed = (id: string) => {
		const s = status(id);
		return !!s?.inPlay && !s.playerId && adventure.stage !== 'choosing';
	};
	const takenBy = (id: string) => {
		const s = status(id);
		if (!s?.inPlay || unclaimed(id)) return null;
		return (s.playerId && players.find((p) => p.id === s.playerId)?.name) || 'the GM';
	};

	/** The card the pointer or focus is on: its medallion wakes. */
	let lit = $state<string | null>(null);

	function claim(id: string) {
		play([{ kind: 'ui', sound: 'select' }]);
		send({ type: 'adventure_claim', characterId: id });
	}

	function openCreator() {
		play([{ kind: 'ui', sound: 'open' }]);
		creating = true;
	}
</script>

{#if creating && canCreate}
	<!-- Loaded only when a player opens it: most tables never do. -->
	{#await import('./dnd/CharacterCreator.svelte') then { default: CharacterCreator }}
		<CharacterCreator
			{roomId}
			reply={creatorReply}
			{send}
			onClose={() => {
				play([{ kind: 'ui', sound: 'close' }]);
				creating = false;
			}}
		/>
	{/await}
{:else}
	<div class="backdrop">
		<section class="select" aria-labelledby="choose-title">
			<header>
				<div class="track"><Steps current={2} /></div>
				<h2 id="choose-title" class="g-banner">Choose your character</h2>
				<p class="subtitle">{adventure.title} · {adventure.location.name}</p>
				<p class="help">
					Pick whoever sounds like you. Each has two actions; you can change your mind until the
					story begins.
				</p>
			</header>
			<ul class="rail">
				{#each adventure.characters as character, i (character.id)}
					{@const id = character.id}
					{@const c = character.def}
					{@const taken = takenBy(id)}
					{@const member = memberOf(id)}
					{@const kept = keptFor(id)}
					{@const away = taken ?? kept}
					<li style:--i={i}>
						<button
							type="button"
							class="g-frame card"
							class:lit={lit === id && !away}
							class:taken={!!away}
							style:--char={c.color}
							disabled={!!away}
							onclick={() => claim(id)}
							onpointerenter={() => (lit = id)}
							onpointerleave={() => (lit = null)}
							onfocus={() => (lit = id)}
							onblur={() => (lit = null)}
						>
							<span class="stage">
								<Portrait
									name={withoutArticle(c.name)}
									label={c.name}
									color={c.color}
									size={96}
									active={lit === id && !away}
								/>
								{#if away}<span class="lock" aria-hidden="true"
										><Icon name="lock" size="1.2em" /></span
									>{/if}
							</span>
							<span class="name">{c.name}</span>
							<span class="role">{character.card.title ?? roleOf(c)}</span>
							{#if member}
								<span class="campaign g-tag brass"
									><Icon name="flag" size="1em" />From {adventure.campaign!.name}{member.player
										? ` · ${member.player}’s`
										: ''}</span
								>
							{/if}
							<span class="tagline">{c.tagline}</span>
							<span class="vitals num">
								<span><Icon name="heart" size="1em" /><b>{c.hp}</b> HP</span>
								<span
									><Icon name="shield" size="1em" /><b>{character.card.defense.value}</b>
									{character.card.defense.name}</span
								>
								{#if character.card.level !== null}
									<span><Icon name="star" size="1em" />Level <b>{character.card.level}</b></span>
								{/if}
								<span><Icon name="compass" size="1em" /><b>{c.speed}</b> Speed</span>
							</span>
							<span class="traits">
								{#each traitsOf(c) as t (t.label)}
									<span class="g-tag"><Icon name={t.icon} size="1em" />{t.label}</span>
								{/each}
							</span>
							<span class="skills">
								{#each character.card.actions as action, n (action.id)}
									{@const def = c.actions[n]}
									<span class="skill">
										<span class="glyph"
											><Icon name={def ? actionIcon(def) : 'sword'} size="1.2em" /></span
										>
										<span class="what"
											><b>{def?.name ?? action.id}</b>{action.part === 'action'
												? ''
												: ` (${action.partName.toLowerCase()})`}: {action.summary}</span
										>
									</span>
								{/each}
							</span>
							<span class="pick">
								{#if away}<Icon name="lock" size="1.1em" />{/if}
								{taken
									? `Taken by ${taken}`
									: kept
										? `Kept for ${kept}`
										: unclaimed(id)
											? `Take up ${c.name} again`
											: `Play ${c.name}`}
							</span>
						</button>
					</li>
				{/each}
			</ul>
			<p class="note">
				{#if classic}
					To hit, roll a d20 plus the attack's bonus and reach {baseDefense} + the target's armor. Limited
					abilities come back at the start of each fight.
				{:else}
					This story plays by {adventure.rules.name}. The table works out every roll for you;
					limited abilities come back at the start of each fight.
				{/if}
			</p>
			{#if canCreate}
				<div class="create">
					<span class="glyph" aria-hidden="true"><Icon name="pencil" size="1.4em" /></span>
					<p>
						Or make your own: pick a species, background and class, and the table works out the
						rest.
					</p>
					<button type="button" class="primary" onclick={openCreator}>
						<Icon name="plus" size="1.1em" />Create your own character
					</button>
				</div>
			{/if}
			{#if adventure.rules.attribution}
				<p class="note attribution">{adventure.rules.attribution}</p>
			{/if}
		</section>
	</div>
{/if}

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

	.select {
		width: min(70rem, 100%);
		margin: auto;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: center;
		gap: var(--sp-6);
	}

	header {
		display: grid;
		justify-items: center;
		max-width: 100%;
		min-width: 0;
		gap: var(--sp-4);
		text-align: center;
	}

	.track {
		width: min(36rem, 100%);
		overflow-x: auto;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--radius-md);
		background: rgba(16, 11, 8, 0.7);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
	}

	.g-banner {
		max-width: 100%;
		margin-top: var(--sp-4);
		font-size: var(--fs-xl);
		text-align: center;
		animation: g-pop 460ms var(--spring) backwards;
	}

	.subtitle {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.08em;
		color: var(--gilt-hi);
	}

	.help {
		margin: 0;
		max-width: 52ch;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	/* The rail: the four portrait cards side by side, a swipe on a phone. */
	.rail {
		display: flex;
		gap: var(--sp-6);
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: var(--sp-6) var(--sp-3) var(--sp-7);
		list-style: none;
		overflow-x: auto;
		justify-content: safe center;
		scroll-snap-type: x mandatory;
		scrollbar-width: thin;
	}

	.rail li {
		flex: 1 0 15rem;
		max-width: 19rem;
		scroll-snap-align: center;
		display: grid;
		animation: g-rise 560ms var(--ease-out) calc(120ms + var(--i) * 90ms) backwards;
	}

	/* A character card: a framed slab with a colour sash behind the medallion. */
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		height: 100%;
		padding: var(--sp-7) var(--sp-6) var(--sp-6);
		border-radius: var(--radius-lg);
		font-family: var(--font-ui);
		font-size: var(--fs-md);
		font-weight: 400;
		letter-spacing: 0;
		line-height: 1.3;
		text-align: center;
		text-shadow: none;
		color: var(--text);
		overflow: hidden;
		transition:
			transform 220ms var(--spring),
			box-shadow 200ms var(--ease-out);
	}

	/* The sash: the character's colour, a lit curtain behind the medallion. */
	.card::before {
		inset: 0 0 auto 0;
		height: 8.5rem;
		background: radial-gradient(120% 100% at 50% 0%, var(--char), transparent 72%);
		opacity: 0.4;
		transition: opacity 220ms var(--ease-out);
	}

	.card:not(:disabled):hover,
	.card:not(:disabled):active,
	.card:focus-visible {
		transform: translateY(-6px);
		/* The skin's button hover resets the whole background; put the whole frame back, lit. */
		background:
			var(--grain) 0 0 / 180px,
			radial-gradient(120% 70% at 20% 0%, rgba(255, 220, 160, 0.14), transparent 60%),
			var(--panel-solid);
		background-blend-mode: soft-light, normal, normal;
		box-shadow:
			inset 0 0 0 2px var(--char),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			0 0 0 1px var(--ink-line),
			0 18px 36px rgba(8, 4, 0, 0.6),
			0 0 34px color-mix(in srgb, var(--char) 55%, transparent);
	}

	.card:not(:disabled):hover::before,
	.card:focus-visible::before {
		opacity: 0.75;
	}

	.card:not(:disabled):active {
		transform: translateY(-2px);
	}

	.card.taken {
		filter: grayscale(0.7) brightness(0.75);
		opacity: 0.85;
	}

	.stage {
		position: relative;
		display: grid;
		place-items: center;
		margin-bottom: var(--sp-3);
	}

	.lock {
		position: absolute;
		right: -4px;
		bottom: -2px;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--panel-raised);
		color: var(--gilt-hi);
		box-shadow:
			0 0 0 1px var(--ink-line),
			inset 0 0 0 1px var(--gilt-line);
	}

	.name {
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.05;
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
	}

	.role {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.12em;
		color: var(--gilt);
	}

	.tagline {
		min-height: 4.2em;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--fs-md);
		color: #d8c6a4;
		text-wrap: balance;
	}

	.vitals {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-2) var(--sp-5);
		padding: var(--sp-4) var(--sp-4);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.6),
			0 1px 0 var(--gilt-line);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.vitals span {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.vitals b {
		font-size: var(--fs-md);
		color: var(--gilt-hi);
	}

	.traits {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
	}

	.skills {
		display: grid;
		margin-bottom: var(--sp-3);
		gap: var(--sp-4);
		width: 100%;
		text-align: left;
	}

	.skill {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-4);
		align-items: start;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--gilt);
	}

	.what b {
		color: var(--text);
	}

	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
		width: 100%;
		margin-top: auto;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--gilt-dark);
		border-radius: var(--radius-control);
		background: var(--gilt-grad);
		box-shadow:
			inset 0 0 0 1px rgba(255, 244, 214, 0.5),
			inset 0 -3px 5px rgba(120, 70, 20, 0.35),
			0 3px 0 var(--gilt-dark);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent-text);
		text-shadow: 0 1px 0 rgba(255, 238, 200, 0.55);
	}

	.card.taken .pick {
		border-color: var(--ink-line);
		background: #1a130e;
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--muted);
		text-shadow: none;
	}

	.card:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.note {
		margin: 0;
		max-width: 62ch;
		text-align: center;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.campaign {
		max-width: 100%;
		font-size: var(--fs-xs);
		text-align: center;
	}

	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--sp-5);
		width: min(46rem, 100%);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.5),
			0 1px 0 var(--gilt-line);
	}

	.create p {
		margin: 0;
		max-width: 34ch;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.create button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.75rem;
	}

	.attribution {
		font-size: var(--fs-2xs);
		opacity: 0.8;
	}

	@media (max-width: 48rem) {
		/* Below the two rows of bars the table keeps along the top on a phone. */
		.backdrop {
			padding-top: 8.5rem;
		}

		.g-banner {
			min-width: 0;
			padding-inline: 1.8rem;
			font-size: var(--fs-lg);
		}

		.rail {
			padding-inline: 10vw;
			gap: var(--sp-5);
		}

		.rail li {
			flex-basis: 80vw;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.g-banner,
		.rail li {
			animation: none;
		}

		.card:not(:disabled):hover,
		.card:focus-visible {
			transform: none;
		}
	}
</style>
