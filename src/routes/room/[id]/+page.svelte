<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { NAME_MAX_LENGTH, ROOM_ID_PATTERN } from '$lib/game/names';
	import type { JoinRole } from '$lib/game/protocol';
	import {
		RoomConnection,
		savedSession,
		takeHandoff,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import { loadName, saveName } from '$lib/prefs';
	import RoomView from '$lib/ui/RoomView.svelte';
	import Steps from '$lib/ui/Steps.svelte';
	import { prefetchRenderer } from '$lib/tabletop/load';
	import { Backdrop, Banner, Frame, Icon } from '$lib/ui/game';

	const roomId = $derived(page.params.id?.toUpperCase() ?? '');
	const validId = $derived(ROOM_ID_PATTERN.test(roomId));

	let conn = $state<RoomConnection | null>(null);
	let name = $state(loadName());

	// (Re)attach whenever the room in the URL changes: reuse the connection the
	// landing page opened, else resume a saved seat, else ask the user to join.
	$effect(() => {
		if (!validId) return;
		const id = roomId;
		const token = savedSession(id);
		// Only the room in the URL decides this: reading the handed-off connection's state here
		// would re-run it on every reset of the room, closing a live connection for a new one.
		conn = untrack(
			() =>
				takeHandoff(id) ??
				(token ? new RoomConnection({ type: 'resume', roomId: id, sessionToken: token }) : null)
		);
	});

	// Close each connection once it is replaced or the page unmounts.
	$effect(() => {
		const c = conn;
		return () => c?.close();
	});

	const errorCode = $derived(conn?.status === 'closed' ? conn.error?.code : undefined);
	const roomMissing = $derived(!validId || errorCode === 'room_not_found');
	const needsJoin = $derived(
		validId && !roomMissing && (conn === null || errorCode === 'session_not_found')
	);

	function join(event: SubmitEvent | null, role: JoinRole) {
		event?.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		saveName(trimmed);
		conn?.close();
		const intent: EnterIntent = { type: 'join', roomId, name: trimmed, role };
		conn = new RoomConnection(intent);
	}

	// The table's 3D renderer is the biggest download: fetch it while the visitor is still here.
	$effect(() => prefetchRenderer());
</script>

<svelte:head>
	<title>{validId ? `Room ${roomId}` : 'Room'} · thirdfold</title>
</svelte:head>

{#if roomMissing}
	<Backdrop variant="hall" />
	<main class="notice">
		<Banner level={1}>Room not found</Banner>
		<Frame class="plaque" as="section" aria-label="Room not found">
			<p>The room <strong class="num">{roomId}</strong> doesn't exist or has closed.</p>
			<a class="back" href={resolve('/')}><Icon name="back" /> Back to start</a>
		</Frame>
	</main>
{:else if needsJoin}
	<Backdrop variant="hall" />
	<main class="notice">
		<Banner level={1}>You’re invited to play</Banner>
		<Frame class="plaque" as="section" aria-label="Join the game">
			<Steps current={1} />
			<p class="room-id">Room <span class="code num">{roomId}</span></p>
			{#if errorCode === 'session_not_found'}
				<p>Your previous seat in this room has expired. Join again to carry on.</p>
			{:else}
				<p>Tell the table your name, and you’ll pick a character next.</p>
			{/if}
			<form onsubmit={(e) => join(e, 'player')}>
				<label class="field">
					<span>Your name</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={name}
						maxlength={NAME_MAX_LENGTH}
						placeholder="e.g. Morgan"
						autocomplete="nickname"
						autofocus
					/>
				</label>
				<button class="primary join" type="submit" disabled={!name.trim()}>Join the game</button>
			</form>
			<button
				type="button"
				class="watch ghost"
				disabled={!name.trim()}
				onclick={() => join(null, 'spectator')}
			>
				<Icon name="eye" /> Just watch instead
			</button>
			{#if conn?.error && errorCode !== 'session_not_found'}
				<p class="error" role="alert">{conn.error.message}</p>
			{/if}
		</Frame>
	</main>
{:else if conn}
	<RoomView {conn} />
{/if}

<style>
	/* A doorway into the table: the banner hangs over a plaque, in the lamplit hall. */
	.notice {
		position: relative;
		z-index: 1;
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0;
		min-height: 100dvh;
		max-width: 34rem;
		margin: 0 auto;
		padding: var(--sp-7) var(--sp-6);
	}

	.notice :global(.g-banner) {
		z-index: 2;
		margin-bottom: -1.1rem;
		animation: g-pop 520ms var(--spring) both;
	}

	.notice :global(.plaque) {
		display: grid;
		gap: var(--sp-5);
		width: 100%;
		padding: var(--sp-8) var(--sp-7) var(--sp-7);
		border-radius: var(--radius-lg);
		animation: g-rise 560ms 120ms var(--ease-out) both;
	}

	.notice :global(.plaque > *) {
		position: relative;
		z-index: 1;
		margin: 0;
	}

	.notice form {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: end;
		gap: var(--sp-4);
		margin-top: var(--sp-3);
	}

	.room-id {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.code {
		display: inline-block;
		margin-left: var(--sp-3);
		padding: var(--sp-1) var(--sp-5);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 var(--gilt-line);
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.16em;
		color: var(--gilt-hi);
	}

	.field {
		display: grid;
		gap: var(--sp-3);
	}

	.field span {
		font-family: var(--font-label);
		font-size: var(--fs-md);
		letter-spacing: 0.04em;
		color: var(--gilt);
	}

	.join {
		min-height: 2.75rem;
	}

	.watch {
		justify-self: center;
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.75rem;
	}

	.back {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.75rem;
		padding: var(--sp-3) var(--sp-6);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-control);
		background: var(--wood-grad);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 3px 0 var(--ink-line);
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.035em;
		color: var(--text);
		text-decoration: none;
	}

	.back:hover {
		background: var(--wood-grad-hover);
	}

	.back:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: 2px;
	}

	.error {
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid #6b2f26;
		border-radius: var(--radius-md);
		background: rgba(60, 24, 16, 0.85);
		color: #ffd7cf;
	}

	@media (max-width: 30rem) {
		.notice form {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.notice :global(.g-banner),
		.notice :global(.plaque) {
			animation: none;
		}
	}
</style>
