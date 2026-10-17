<script lang="ts">
	import { Icon, Meter, Portrait } from '$lib/ui/game';

	/**
	 * Who you are at this table, in the corner: your portrait, your name, and (for a character) a
	 * heart and its meter with the conditions you carry. The GM and a spectator get the same plate
	 * with their seat in place of the meter.
	 */
	interface Props {
		name: string;
		/** A line under the name: the seat, or the character's class. */
		subtitle: string;
		color: string;
		badge?: 'crown' | null;
		/** Hit points, for a character. */
		hp?: { value: number; max: number } | null;
		/** What its rules call hit points (Stress, Health), where they differ. */
		healthName?: string;
		downed?: boolean;
		dead?: boolean;
		statuses?: readonly { name: string; about: string }[];
		carrying?: readonly string[];
		/** Opens the character sheet (the portrait becomes a button). */
		onSheet?: () => void;
	}
	let {
		name,
		subtitle,
		color,
		badge = null,
		hp = null,
		healthName = 'HP',
		downed = false,
		dead = false,
		statuses = [],
		carrying = [],
		onSheet
	}: Props = $props();
</script>

<section class="id g-frame" class:down={downed || dead} aria-label="You">
	{#snippet face()}
		<Portrait
			{name}
			{color}
			{badge}
			size={58}
			ratio={hp ? hp.value / Math.max(1, hp.max) : undefined}
		/>
	{/snippet}
	{#if onSheet}
		<button
			type="button"
			class="face ghost"
			onclick={onSheet}
			title="Character sheet"
			aria-label={`${name}: character sheet`}
		>
			{@render face()}
		</button>
	{:else}
		<span class="face">{@render face()}</span>
	{/if}
	<div class="info">
		<p class="name">{name}</p>
		<p class="sub">{subtitle}</p>
		{#if hp}
			<div class="heart">
				<Icon name="heart" size="1.1rem" />
				<Meter value={hp.value} max={hp.max} label={healthName} />
				<span class="num hpnum">{hp.value}/{hp.max} {healthName}</span>
			</div>
		{/if}
		{#if downed || dead || statuses.length || carrying.length}
			<ul class="tags">
				{#if dead}
					<li class="g-tag ember">Dead</li>
				{:else if downed}
					<li class="g-tag ember">Down</li>
				{/if}
				{#each statuses as s (s.name)}
					<li class="g-tag" title={s.about}>{s.name}</li>
				{/each}
				{#each carrying as item (item)}
					<li class="g-tag brass" title="Carrying">{item}</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.id {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		width: min(18rem, 100%);
		padding: var(--sp-4) var(--sp-6) var(--sp-4) var(--sp-4);
		border-radius: var(--radius-lg);
		pointer-events: auto;
		animation: g-slide-left 420ms var(--spring) both;
	}

	.id.down {
		box-shadow:
			inset 0 0 0 1px rgba(226, 122, 107, 0.7),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-md);
	}

	.face {
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 50%;
		z-index: 1;
	}

	button.face {
		min-height: 0;
		padding: 2px;
	}

	.info {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
		flex: 1;
		z-index: 1;
	}

	.name {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.04em;
		line-height: 1.1;
		color: var(--text);
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
	}

	.sub {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.heart {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		color: #e27a6b;
	}

	.heart :global(.wrap) {
		flex: 1;
		min-width: 4rem;
	}

	.hpnum {
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--muted);
		white-space: nowrap;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (max-width: 48rem) {
		.id {
			width: auto;
			align-self: flex-start;
			gap: var(--sp-4);
			padding: var(--sp-3) var(--sp-5) var(--sp-3) var(--sp-3);
		}

		.id :global(.portrait) {
			--size: 40px !important;
		}

		.name {
			font-size: var(--fs-md);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.id {
			animation: none;
		}
	}
</style>
