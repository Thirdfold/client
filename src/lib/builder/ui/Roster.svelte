<script lang="ts" module>
	export interface RosterItem {
		key: string;
		label: string;
		/** A second line: where, what kind. */
		sub?: string;
		/** A medallion with initials in this colour, instead of the icon. */
		color?: string;
		foe?: boolean;
		/** A number set on the plate (chapters in order). */
		order?: number;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, Portrait, type IconName } from '$lib/ui/game';
	import { play } from '$lib/audio/engine';
	import Empty from './Empty.svelte';

	/**
	 * Master and detail: the things of one kind as a shelf of plates, the chosen one's editor beside
	 * it. With nothing on the shelf, a composed empty state with the one thing to do.
	 */
	let {
		items,
		selected = $bindable(),
		icon,
		label,
		addLabel,
		onadd,
		emptyTitle,
		empty,
		editor
	}: {
		items: readonly RosterItem[];
		selected: string | undefined;
		icon: IconName;
		/** What the shelf is called, for assistive tech. */
		label: string;
		addLabel: string;
		onadd: () => void;
		emptyTitle: string;
		empty: Snippet;
		editor: Snippet<[string]>;
	} = $props();

	const current = $derived(items.some((i) => i.key === selected) ? selected : items[0]?.key);

	function pick(key: string) {
		if (key !== current) play([{ kind: 'ui', sound: 'select' }]);
		selected = key;
	}

	function onkey(e: KeyboardEvent) {
		const step =
			e.key === 'ArrowDown' || e.key === 'ArrowRight'
				? 1
				: e.key === 'ArrowUp' || e.key === 'ArrowLeft'
					? -1
					: 0;
		if (!step) return;
		const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')];
		const i = buttons.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		e.preventDefault();
		buttons[(i + step + buttons.length) % buttons.length].focus();
	}
</script>

{#if items.length === 0}
	<Empty {icon} title={emptyTitle}>
		{@render empty()}
		{#snippet action()}
			<button type="button" class="primary" onclick={onadd}>
				<Icon name="plus" size="1em" />{addLabel}
			</button>
		{/snippet}
	</Empty>
{:else}
	<div class="roster">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul class="shelf" aria-label={label} onkeydown={onkey}>
			{#each items as item, i (item.key)}
				<li class="g-pop" style:animation-delay="{Math.min(i, 8) * 40}ms">
					<button
						type="button"
						class="plate"
						aria-current={current === item.key ? 'true' : undefined}
						onclick={() => pick(item.key)}
					>
						{#if item.color}
							<Portrait name={item.label} color={item.color} size={34} foe={item.foe} />
						{:else}
							<span class="medal" aria-hidden="true">
								{#if item.order !== undefined}<span class="order">{item.order}</span>{:else}<Icon
										name={icon}
										size="1.1em"
									/>{/if}
							</span>
						{/if}
						<span class="words">
							<span class="name">{item.label}</span>
							{#if item.sub}<span class="sub">{item.sub}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
			<li>
				<button type="button" class="add" onclick={onadd}>
					<Icon name="plus" size="1.05em" />{addLabel}
				</button>
			</li>
		</ul>
		<div class="detail">
			{#if current !== undefined}
				{#key current}
					<div class="stack g-rise">{@render editor(current)}</div>
				{/key}
			{/if}
		</div>
	</div>
{/if}

<style>
	.roster {
		display: grid;
		grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
		gap: var(--sp-6);
		align-items: start;
	}

	.shelf {
		position: sticky;
		top: var(--sp-5);
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0 0 var(--sp-4);
		list-style: none;
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.plate {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		width: 100%;
		min-height: 3.2rem;
		padding: var(--sp-4) var(--sp-5);
		text-align: left;
		letter-spacing: 0.02em;
	}

	.words {
		display: grid;
		min-width: 0;
	}

	.name {
		overflow: hidden;
		font-size: var(--fs-md);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		overflow: hidden;
		font-family: var(--font-ui);
		font-size: var(--fs-xs);
		font-weight: 400;
		letter-spacing: 0;
		text-overflow: ellipsis;
		text-shadow: none;
		white-space: nowrap;
		color: var(--muted);
	}

	.plate[aria-current='true'] {
		border-color: var(--ink-line);
		background: linear-gradient(180deg, #2a1d10 0%, #3a2814 100%);
		color: var(--gilt-hi);
		box-shadow:
			inset 0 0 0 1px var(--gilt),
			inset 0 3px 8px rgba(0, 0, 0, 0.55),
			0 1px 0 var(--ink-line),
			0 0 18px rgba(224, 164, 88, 0.3);
		transform: translateY(2px);
	}

	.plate[aria-current='true'] .sub {
		color: #d8bf90;
	}

	.medal,
	.order {
		display: grid;
		place-items: center;
	}

	.medal {
		flex: none;
		width: 2.1rem;
		height: 2.1rem;
		border: 1px solid var(--ink-line);
		border-radius: 50%;
		background: linear-gradient(180deg, #3b2c20, #1f1611);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			0 2px 0 var(--ink-line);
		color: var(--gilt);
	}

	.order {
		font-size: var(--fs-md);
		line-height: 1;
	}

	.add {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-3);
		width: 100%;
		border-style: dashed;
		border-color: var(--gilt-line-strong);
		background: transparent;
		box-shadow: none;
		color: var(--gilt);
	}

	.add:not(:disabled):hover {
		border-color: var(--gilt);
		background: var(--accent-wash);
		box-shadow: 0 0 18px rgba(224, 164, 88, 0.2);
	}

	.detail {
		min-width: 0;
	}

	.stack {
		display: grid;
		gap: var(--sp-6);
		min-width: 0;
	}

	@media (max-width: 56rem) {
		.roster {
			grid-template-columns: minmax(0, 1fr);
		}

		.shelf {
			position: static;
			display: flex;
			max-height: none;
			margin-inline: calc(var(--sp-5) * -1);
			padding: var(--sp-2) var(--sp-5) var(--sp-5);
			overflow-x: auto;
			overflow-y: hidden;
			scroll-snap-type: x proximity;
		}

		.shelf li {
			flex: none;
			scroll-snap-align: start;
		}

		.plate {
			width: 11.5rem;
		}

		.add {
			width: auto;
			height: 100%;
			padding-inline: var(--sp-6);
			white-space: nowrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shelf li,
		.stack {
			animation: none;
		}
	}
</style>
