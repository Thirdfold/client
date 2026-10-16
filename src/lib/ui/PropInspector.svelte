<script lang="ts">
	import { ASSETS, PROP_SCALE, type Prop, type Rotation } from '$lib/game/props';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';
	import PanelTitle from './room/PanelTitle.svelte';
	import Slider from './room/Slider.svelte';
	import ToolSlot from './room/ToolSlot.svelte';
	import Toggle from './room/Toggle.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		prop: Prop;
		send(action: RoomAction): boolean;
		onDone(): void;
		/** Removes the prop (the room view offers an undo). */
		onRemove(): void;
	}

	let { prop, send, onDone, onRemove }: Props = $props();

	const turn = (by: 1 | -1) => ((prop.rotation + by + 4) % 4) as Rotation;
</script>

<section class="inspector" aria-label="Selected prop">
	<PanelTitle icon="cube">{ASSETS[prop.assetId].name}</PanelTitle>
	<p class="where">
		Click a cell to move it. <kbd>[</kbd> <kbd>]</kbd> rotate, <kbd>Del</kbd> removes.
	</p>

	<Tray title="Turn" icon="refresh">
		<div class="pair">
			<span class="mirror">
				<ToolSlot
					icon="refresh"
					label="Rotate left"
					kbd="["
					title="Rotate left ([)"
					onclick={() =>
						send({ type: 'prop_update', propId: prop.id, patch: { rotation: turn(-1) } })}
				/>
			</span>
			<ToolSlot
				icon="refresh"
				label="Rotate right"
				kbd="]"
				title="Rotate right (])"
				onclick={() => send({ type: 'prop_update', propId: prop.id, patch: { rotation: turn(1) } })}
			/>
		</div>
		<Slider
			label="Size"
			reading="×{prop.scale.toFixed(2)}"
			ariaLabel="Prop size"
			min={PROP_SCALE.min}
			max={PROP_SCALE.max}
			step={0.25}
			value={prop.scale}
			onchange={(scale) => send({ type: 'prop_update', propId: prop.id, patch: { scale } })}
		/>
	</Tray>

	<Tray title="Finish" icon="wand">
		<div class="tint">
			<label>
				<span class="lab">Tint</span>
				<input
					type="color"
					value={prop.tint ?? '#ffffff'}
					aria-label="Prop tint"
					onchange={(e) =>
						send({
							type: 'prop_update',
							propId: prop.id,
							patch: { tint: e.currentTarget.value }
						})}
				/>
			</label>
			<button
				type="button"
				disabled={!prop.tint}
				onclick={() => send({ type: 'prop_update', propId: prop.id, patch: { tint: null } })}
				>Clear tint</button
			>
		</div>
		<Toggle
			label="Hidden from players"
			checked={prop.hidden === true}
			onchange={(hidden) => send({ type: 'prop_update', propId: prop.id, patch: { hidden } })}
		/>
	</Tray>

	<div class="actions">
		<button type="button" class="primary" onclick={onDone}><Icon name="check" /> Done</button>
		<button type="button" class="danger" onclick={onRemove}><Icon name="trash" /> Remove</button>
	</div>
</section>

<style>
	.inspector {
		display: grid;
		gap: var(--sp-5);
	}

	.where {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}

	/* The left turn is the right turn's mirror. */
	.mirror {
		display: grid;
	}

	.mirror :global(svg) {
		transform: scaleX(-1);
	}

	.lab {
		margin-right: var(--sp-4);
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.tint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}

	.tint label {
		display: flex;
		align-items: center;
	}

	.tint button {
		font-size: var(--fs-xs);
	}

	input[type='color'] {
		width: 2.5rem;
		height: 1.9rem;
		min-height: 0;
		padding: 0.15rem;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}

	.actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
	}
</style>
