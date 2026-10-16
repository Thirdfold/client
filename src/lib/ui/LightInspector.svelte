<script lang="ts">
	import {
		FLICKERS,
		LIGHT_COLORS,
		LIGHT_KINDS,
		lightKindName,
		lightLook,
		MAX_LIGHT_HEIGHT,
		MAX_LIGHT_INTENSITY,
		MAX_LIGHT_RADIUS,
		type Flicker,
		type Light,
		type LightKind
	} from '$lib/game/lights';
	import type { LightPatch } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { Icon } from '$lib/ui/game';
	import Field from './room/Field.svelte';
	import PanelTitle from './room/PanelTitle.svelte';
	import Slider from './room/Slider.svelte';
	import Swatch from './room/Swatch.svelte';
	import Toggle from './room/Toggle.svelte';
	import Tray from './room/Tray.svelte';

	interface Props {
		light: Light;
		send(action: RoomAction): boolean;
		onDone(): void;
		/** Removes the light (the room view offers an undo). */
		onRemove(): void;
	}

	let { light, send, onDone, onRemove }: Props = $props();

	/** Its whole look: its own fields over its kind's. */
	const look = $derived(lightLook(light));
	const FLICKER_LABEL: Record<Flicker, string> = {
		none: 'Steady',
		candle: 'Candle',
		torch: 'Torch',
		fire: 'Fire',
		pulse: 'Pulse',
		lantern: 'Lantern'
	};

	/** One change, one field. */
	const update = (patch: LightPatch) => send({ type: 'light_update', lightId: light.id, patch });
</script>

<section class="inspector" aria-label="Selected light">
	<PanelTitle icon="flame">{lightKindName(look.kind)}</PanelTitle>
	<p class="where">
		At {light.pos.x + 1}, {light.pos.y + 1}. <kbd>Del</kbd> removes, <kbd>Esc</kbd> lets go.
	</p>

	<Tray title="The flame" icon="flame">
		<Toggle label="Lit" checked={light.on} onchange={(on) => update({ on })} />
		<Field label="Kind">
			<select
				value={look.kind}
				onchange={(e) => update({ kind: e.currentTarget.value as LightKind })}
			>
				{#each LIGHT_KINDS as kind (kind)}
					<option value={kind}>{lightKindName(kind)}</option>
				{/each}
			</select>
		</Field>
		<div class="field">
			<span class="lab" id="light-colour">Colour</span>
			<div class="swatches" role="group" aria-labelledby="light-colour">
				{#each LIGHT_COLORS as c (c.color)}
					<Swatch
						color={c.color}
						title={c.name}
						label={c.name}
						pressed={light.color === c.color}
						onclick={() => update({ color: c.color })}
					/>
				{/each}
				<input
					type="color"
					value={light.color}
					aria-label="Any colour"
					onchange={(e) => update({ color: e.currentTarget.value })}
				/>
			</div>
		</div>
		<Field label="Flicker">
			<select
				value={look.flicker}
				onchange={(e) => update({ flicker: e.currentTarget.value as Flicker })}
			>
				{#each FLICKERS as flicker (flicker)}
					<option value={flicker}>{FLICKER_LABEL[flicker]}</option>
				{/each}
			</select>
		</Field>
	</Tray>

	<Tray title="Reach" icon="sparkle">
		<Slider
			label="Radius"
			reading="{light.radius} {light.radius === 1 ? 'cell' : 'cells'}"
			min={1}
			max={MAX_LIGHT_RADIUS}
			value={light.radius}
			onchange={(radius) => update({ radius })}
		/>
		<Slider
			label="Intensity"
			reading="×{look.intensity.toFixed(2)}"
			min={0}
			max={MAX_LIGHT_INTENSITY}
			step={0.25}
			value={look.intensity}
			onchange={(intensity) => update({ intensity })}
		/>
		<Slider
			label="Height"
			reading="{look.height} {look.height === 1 ? 'level' : 'levels'}"
			min={0}
			max={MAX_LIGHT_HEIGHT}
			value={look.height}
			onchange={(height) => update({ height })}
		/>
	</Tray>

	<Tray title="Look" icon="eye">
		<Toggle
			label="Casts shadows"
			checked={look.shadows}
			onchange={(shadows) => update({ shadows })}
		/>
		<Toggle
			label="Draw a fixture"
			checked={look.fixture}
			onchange={(fixture) => update({ fixture })}
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

	.field {
		display: grid;
		gap: var(--sp-3);
		font-size: var(--fs-xs);
	}

	.lab {
		color: var(--muted);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-4);
	}

	.swatches input {
		width: 2.25rem;
		height: 1.7rem;
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
