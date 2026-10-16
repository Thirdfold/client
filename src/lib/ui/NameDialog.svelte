<script lang="ts">
	import { play } from '$lib/audio/engine';
	import { NAME_MAX_LENGTH } from '$lib/game/names';
	import { Icon } from '$lib/ui/game';

	/**
	 * Asks for the name someone plays under: before running an adventure
	 * (`running` is its title), or to change it. `onSave` gets the trimmed name.
	 * A sheet of vellum let down over the screen, with a line to sign.
	 */
	interface Props {
		running: string | null;
		onSave(name: string): void;
		onCancel(): void;
	}

	let { running, onSave, onCancel }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let draft = $state('');
	let saved = false;

	export function open(initial: string) {
		draft = initial;
		saved = false;
		dialog?.showModal();
		play([{ kind: 'ui', sound: 'open' }]);
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = draft.trim();
		if (!name) return;
		saved = true;
		dialog?.close();
		onSave(name);
	}

	function closed() {
		if (!saved) play([{ kind: 'ui', sound: 'close' }]);
		onCancel();
	}
</script>

<dialog bind:this={dialog} class="vellum" aria-labelledby="name-title" onclose={closed}>
	<form onsubmit={submit}>
		<span class="seal" aria-hidden="true"><Icon name="pencil" size="1.5rem" /></span>
		<h2 id="name-title">{running ? 'Your name at the table' : 'The name you play under'}</h2>
		<p>
			{running
				? `You’ll open a table for “${running}” as its GM. Your players will see this name.`
				: 'Players at your tables will see this name.'}
		</p>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={draft}
			maxlength={NAME_MAX_LENGTH}
			autocomplete="nickname"
			placeholder="e.g. Morgan"
			aria-label="Your name"
			autofocus
		/>
		<div class="actions">
			<button class="primary" type="submit" disabled={!draft.trim()}>
				{running ? 'Run it' : 'Save'}
			</button>
			<button type="button" onclick={() => dialog?.close()}>Cancel</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(27rem, calc(100% - 2rem));
		padding: var(--sp-8) var(--sp-8) var(--sp-7);
		color: var(--ink);
	}

	dialog::backdrop {
		background: radial-gradient(70% 60% at 50% 45%, rgba(40, 24, 10, 0.55), rgba(6, 4, 2, 0.82));
		backdrop-filter: blur(3px);
	}

	form {
		display: grid;
		justify-items: center;
		gap: var(--sp-5);
		text-align: center;
	}

	/* A wax seal at the head of the sheet. */
	.seal {
		display: grid;
		place-items: center;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #b14a42, #7a2a25 70%, #561b17);
		box-shadow:
			inset 0 0 0 2px rgba(255, 200, 190, 0.28),
			inset 0 -3px 5px rgba(0, 0, 0, 0.35),
			0 4px 10px rgba(40, 20, 10, 0.5);
		color: #ffe3dc;
	}

	h2 {
		margin: 0;
		font-size: var(--fs-xl);
	}

	p {
		margin: 0;
		color: var(--ink-muted);
	}

	input {
		width: 100%;
		min-height: 3rem;
		margin-top: var(--sp-3);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 700;
		text-align: center;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-5);
		margin-top: var(--sp-3);
	}

	@media (max-width: 47.99rem) {
		.actions button {
			min-height: 2.75rem;
		}
	}
</style>
