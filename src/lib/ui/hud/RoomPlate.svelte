<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PublicPlayer, Role } from '$lib/game/protocol';
	import { Icon, Portrait } from '$lib/ui/game';

	/**
	 * The room plate: the table's name and who is at it. The room code beside a lantern that lights
	 * when the connection is good and dims when it is not, the party as medallions (the GM wears the
	 * crown), and the invite. It is small on purpose: the table stays free.
	 */
	interface Props {
		code: string | undefined;
		status: 'connecting' | 'connected' | 'reconnecting' | 'closed';
		players: readonly PublicPlayer[];
		myId: string | undefined;
		/** Token colour of each player's own token, for their medallion. */
		colors: Readonly<Record<string, string>>;
		isGm: boolean;
		listed: boolean | undefined;
		copied: boolean;
		onCopy(): void;
		onListing(): void;
	}
	let { code, status, players, myId, colors, isGm, listed, copied, onCopy, onListing }: Props =
		$props();

	const STATUS_LABEL = {
		connecting: 'Connecting…',
		connected: 'Connected',
		reconnecting: 'Reconnecting…',
		closed: 'Disconnected'
	};
	const ROLE_LABEL: Record<Role, string> = { gm: 'GM', player: 'Player', spectator: 'Spectator' };
	const SHOWN = 5;
	const lantern = $derived(status === 'connected' ? 'lit' : status === 'closed' ? 'out' : 'dim');
	const shown = $derived(players.slice(0, SHOWN));
	const more = $derived(players.length - shown.length);
</script>

<header class="plate g-frame">
	<a class="brand" href={resolve('/')} title="Back to the front page">thirdfold</a>
	<span class="code" title={`Room code · ${STATUS_LABEL[status]}`} data-status={status}>
		<svg class="lantern {lantern}" viewBox="0 0 24 24" aria-hidden="true">
			<path class="ring" d="M9.5 4.5a2.5 2.5 0 0 1 5 0" />
			<path class="body" d="M8 7h8l1.4 10.5h-10.8zM6.6 17.5h10.8M7.5 20.5h9" />
			<path
				class="flame"
				d="M12 9.2c.6 1.7 2.3 2.5 2.3 4.5a2.3 2.3 0 0 1-4.6 0c0-.9.4-1.5.8-2 .2.6.5.9.9 1 0-1.2.2-2.6.6-3.5z"
			/>
			{#if lantern === 'out'}<path class="slash" d="m5 4.5 14 15" />{/if}
		</svg>
		<span class="visually-hidden">{STATUS_LABEL[status]}</span>
		<span class="text">{code ?? STATUS_LABEL[status]}</span>
	</span>
	{#if code}
		<ul class="party" aria-label="At the table">
			{#each shown as player (player.id)}
				<li class:offline={!player.connected}>
					<Portrait
						name={player.name}
						size={34}
						color={colors[player.id] ?? '#6b5a44'}
						badge={player.role === 'gm' ? 'crown' : null}
						label={`${player.name}${player.id === myId ? ' (you)' : ''}, ${ROLE_LABEL[player.role]}${player.connected ? '' : ', offline'}`}
					/>
				</li>
			{/each}
			{#if more > 0}<li class="more num" title={`${more} more at the table`}>+{more}</li>{/if}
		</ul>
		<span class="acts">
			<button
				type="button"
				class="invite"
				onclick={onCopy}
				title="Copy the room's link to share it"
			>
				<Icon name={copied ? 'check' : 'link'} size="1.15rem" />
				<span class="word">{copied ? 'Link copied' : 'Copy invite link'}</span>
			</button>
			{#if isGm}
				<button
					type="button"
					aria-pressed={listed}
					title={listed
						? 'Anyone can find this game on the front page and join. Click to make it invite-only.'
						: 'Only people with the invite link can join. Click to list it for anyone to find.'}
					onclick={onListing}
				>
					<Icon name={listed ? 'eye' : 'lock'} size="1.15rem" />
					<span class="word">{listed ? 'Open to all' : 'Invite only'}</span>
				</button>
			{/if}
		</span>
	{/if}
</header>

<style>
	.plate {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-3) var(--sp-5);
		border-radius: var(--radius-bar, var(--radius-md));
		pointer-events: auto;
		min-width: 0;
	}

	.brand {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--gilt-hi);
		text-decoration: none;
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.55);
		border-radius: var(--radius-sm);
	}

	.brand:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.code {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-3);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 var(--gilt-line);
	}

	.code .text {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.16em;
		color: var(--text);
	}

	.lantern {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		color: var(--muted);
		overflow: visible;
	}

	.lantern .flame {
		fill: currentColor;
		stroke: none;
		transform-origin: 12px 13.5px;
	}

	.lantern.lit {
		color: var(--gilt);
		filter: drop-shadow(0 0 5px var(--ember-glow));
	}

	.lantern.lit .flame {
		fill: var(--gilt-hi);
		animation: flicker 2.4s ease-in-out infinite;
	}

	.lantern.dim {
		color: #8a7456;
	}

	.lantern.dim .flame {
		transform: scale(0.6);
		animation: gutter 1.1s ease-in-out infinite;
	}

	.lantern.out {
		color: var(--danger);
	}

	.lantern.out .flame {
		display: none;
	}

	.lantern .slash {
		stroke: var(--danger);
	}

	@keyframes flicker {
		0%,
		100% {
			transform: scale(1) rotate(0);
		}
		35% {
			transform: scale(1.08, 1.14) rotate(-2deg);
		}
		70% {
			transform: scale(0.95, 0.98) rotate(2deg);
		}
	}

	@keyframes gutter {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.9;
		}
	}

	.party {
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0 var(--sp-2) 0 0;
		list-style: none;
	}

	.party li {
		margin-right: -0.4rem;
		transition: transform 160ms var(--ease-out);
	}

	.party li:hover {
		transform: translateY(-2px);
	}

	.party li.offline {
		opacity: 0.45;
		filter: grayscale(0.7);
	}

	.more {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--panel-raised);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--gilt-hi);
	}

	.acts {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		padding-left: var(--sp-5);
		border-left: 1px solid var(--gilt-line);
	}

	.acts button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.25rem;
		padding: var(--sp-2) var(--sp-5);
		font-size: var(--fs-sm);
	}

	@media (max-width: 80rem) {
		.acts .word {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.acts button {
			padding: var(--sp-2) var(--sp-4);
		}
	}

	@media (max-width: 48rem) {
		.plate {
			gap: var(--sp-4);
			padding: var(--sp-2) var(--sp-4);
		}

		.acts {
			padding-left: var(--sp-4);
			margin-left: auto;
		}

		.acts button {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}

		.brand {
			display: none;
		}

		.party li:nth-child(n + 4) {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lantern.lit .flame,
		.lantern.dim .flame {
			animation: none;
		}
	}
</style>
