<script lang="ts">
	import type { PublicGame } from '$lib/game/library';
	import { Icon } from '$lib/ui/game';

	/**
	 * The open games as a table list: one row per table with its GM, its players and where the
	 * story is, Join and Watch on the right. Loading, empty and unreachable have their own looks.
	 */
	interface Props {
		games: PublicGame[] | null;
		/** Why the list could not be fetched; null when it could. */
		error: string | null;
		/** False until a name is written, or while a connection is being made. */
		canEnter: boolean;
		onjoin(game: PublicGame, role: 'player' | 'spectator'): void;
		onrefresh(): void;
	}

	let { games, error, canEnter, onjoin, onrefresh }: Props = $props();

	// The drawing is decoration: it loads after the page, into a slot that already has its shape.
	const loadArt = () => import('./TableArt.svelte');
</script>

<div class="top">
	<p class="lede">Tables their GMs have opened to anyone.</p>
	<button type="button" class="refresh" onclick={onrefresh}>
		<Icon name="refresh" size="1.15rem" />
		<span>Refresh</span>
	</button>
</div>

{#if error}
	<div class="state" role="alert">
		<div class="art-slot">
			{#await loadArt() then { default: TableArt }}
				<TableArt lit={false} />
			{/await}
		</div>
		<p class="big">The open games could not be looked up just now.</p>
		<p class="small">{error}</p>
		<button type="button" onclick={onrefresh}>Try again</button>
	</div>
{:else if games === null}
	<div class="state" role="status">
		<span class="spin"><Icon name="d20" size="2.2rem" /></span>
		<p class="big">Looking for open games…</p>
	</div>
{:else if games.length === 0}
	<div class="state">
		<div class="art-slot">
			{#await loadArt() then { default: TableArt }}
				<TableArt />
			{/await}
		</div>
		<p class="big">No open games right now.</p>
		<p class="small">Games are invite-only unless their GM lists them.</p>
	</div>
{:else}
	<ul class="list g-stagger">
		{#each games as game, i (game.roomId)}
			<li class="row" style:--i={i}>
				<div class="what">
					<strong class="title">{game.title}</strong>
					<span class="meta">
						<span class="item"><Icon name="crown" size="1em" /> GM {game.gm}</span>
						<span class="item">
							<Icon name="users" size="1em" />
							{game.players}
							{game.players === 1 ? 'player' : 'players'}
						</span>
						{#if game.status}<span class="g-tag">{game.status}</span>{/if}
					</span>
				</div>
				<div class="go">
					<button
						type="button"
						class="primary"
						disabled={!canEnter}
						onclick={() => onjoin(game, 'player')}
					>
						Join
					</button>
					<button
						type="button"
						class="ghost"
						disabled={!canEnter}
						onclick={() => onjoin(game, 'spectator')}
					>
						<Icon name="eye" size="1.1rem" />
						Watch
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5);
	}

	.lede {
		margin: 0;
		color: var(--muted);
	}

	.refresh {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex: none;
	}

	.state {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		padding: var(--sp-6) var(--sp-4) var(--sp-4);
		border: 1px dashed var(--gilt-line);
		border-radius: var(--radius-md);
		background: rgba(0, 0, 0, 0.22);
		text-align: center;
	}

	.art-slot {
		width: min(24rem, 100%);
		aspect-ratio: 300 / 170;
	}

	.big {
		margin: var(--sp-3) 0 0;
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.15;
	}

	.small {
		margin: 0 0 var(--sp-3);
		max-width: 28rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	.spin {
		display: inline-grid;
		color: var(--gilt);
		animation: spin 1.6s linear infinite;
	}

	.list {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4) var(--sp-6);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-md);
		background: linear-gradient(180deg, rgba(255, 238, 214, 0.07), rgba(255, 238, 214, 0.03));
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 2px 0 var(--ink-line);
		transition:
			background 140ms var(--ease-out),
			box-shadow 140ms var(--ease-out);
	}

	.row:hover,
	.row:focus-within {
		background: linear-gradient(180deg, rgba(255, 238, 214, 0.13), rgba(255, 238, 214, 0.06));
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 2px 0 var(--ink-line);
	}

	.what {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
		flex: 1 1 11rem;
	}

	.title {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		line-height: 1.15;
		overflow-wrap: anywhere;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2) var(--sp-5);
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.item {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
	}

	.go {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		flex: none;
	}

	.go button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}

	@media (max-width: 47.99rem) {
		.go button {
			min-height: 2.75rem;
		}

		.refresh {
			min-height: 2.75rem;
		}
	}
</style>
