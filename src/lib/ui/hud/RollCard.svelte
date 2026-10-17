<script module lang="ts">
	import type { ChatMessage } from '$lib/game/chat';
	import type { DiceRoll } from '$lib/game/dice';

	export type RollEntry = Extract<ChatMessage, { kind: 'roll' | 'attack' | 'ability' | 'check' }>;

	/** The natural d20, when the roll was made with exactly one. */
	export function naturalOf(roll: DiceRoll | null | undefined): number | null {
		if (!roll) return null;
		const dice = roll.terms.flatMap((t) => (t.kind === 'dice' && t.sides === 20 ? t.rolls : []));
		return dice.length === 1 ? dice[0] : null;
	}

	/** A natural 20 or a natural 1 on the roll this card shows, for the table to cheer or wince at. */
	export function momentOf(entry: RollEntry): 'crit' | 'fumble' | null {
		const roll =
			entry.kind === 'attack' ? entry.toHit : entry.kind === 'ability' ? null : entry.roll;
		const n = naturalOf(roll);
		return n === 20 ? 'crit' : n === 1 ? 'fumble' : null;
	}
</script>

<script lang="ts">
	import { fade } from 'svelte/transition';
	import { formatBreakdown } from '$lib/game/dice';
	import { Icon, type IconName } from '$lib/ui/game';

	/** The roll as the dice impact: what to show large, the word beside it, how it came about. */
	let { entry }: { entry: RollEntry } = $props();

	const moment = $derived(momentOf(entry));
	const view = $derived.by(() => {
		const e = entry;
		let state = 'plain' as 'hit' | 'miss' | 'heal' | 'plain';
		let icon: IconName = 'd20';
		if (e.kind === 'roll') {
			const sides = e.roll.terms.flatMap((t) => (t.kind === 'dice' ? [t.sides] : []));
			icon = sides.length === 1 && sides[0] === 20 ? 'd20' : 'dice';
			return {
				who: `${e.authorName} rolled ${e.roll.expression}`,
				big: String(e.roll.total),
				verdict: null,
				how: formatBreakdown(e.roll),
				lines: [] as string[],
				state,
				icon
			};
		}
		if (e.kind === 'check') {
			state = e.success ? 'hit' : 'miss';
			return {
				who: `${e.authorName} · ${e.action}`,
				big: String(e.roll.total),
				verdict: e.success ? 'Found' : 'Nothing',
				how: `${e.stat} check vs ${e.dc} · ${e.success ? 'found' : 'nothing'}`,
				lines: [],
				state,
				icon
			};
		}
		if (e.kind === 'ability') {
			const amount = e.amount;
			state = amount !== null && amount > 0 ? 'heal' : 'plain';
			return {
				who: `${e.authorName} · ${e.ability}${e.targetName ? ` → ${e.targetName}` : ''}`,
				big: amount === null ? null : `${amount > 0 ? '+' : ''}${amount}`,
				verdict: null,
				how: e.text,
				lines: [],
				state,
				icon: amount !== null && amount > 0 ? ('heart' as IconName) : ('sparkle' as IconName)
			};
		}
		state = e.hit ? 'hit' : 'miss';
		return {
			who: `${e.authorName} · ${e.attack} → ${e.targetName}`,
			big: e.hit ? String(e.taken ?? e.damage?.total ?? 0) : 'Miss',
			verdict: e.hit ? 'Hit' : 'Miss',
			how: `${e.toHit.total} vs ${e.defense}${e.hit ? ' · hit, damage' : ''}`,
			lines: [e.effect, e.outcome].filter((l): l is string => !!l),
			state,
			icon
		};
	});
</script>

<div class="spot" role="status" out:fade|global={{ duration: 260 }}>
	<div class="card {view.state}" class:crit={moment === 'crit'} class:fumble={moment === 'fumble'}>
		<span class="who">{view.who}</span>
		{#if moment}
			<span class="moment g-tag" class:brass={moment === 'crit'} class:ember={moment === 'fumble'}>
				{moment === 'crit' ? 'Natural 20' : 'Natural 1'}
			</span>
		{/if}
		{#if view.big !== null}
			<span class="die" aria-hidden="true">
				<Icon name={view.icon} size="100%" />
			</span>
			<span class="big num" class:word={view.big === 'Miss'}>{view.big}</span>
		{/if}
		{#if view.verdict && view.verdict !== view.big}
			<span class="verdict" aria-hidden="true">{view.verdict}</span>
		{/if}
		<span class="how">{view.how}</span>
		{#each view.lines as line (line)}<span class="outcome">{line}</span>{/each}
	</div>
</div>

<style>
	.spot {
		position: absolute;
		top: 34%;
		left: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: var(--z-modal);
	}

	.card {
		--tone: var(--gilt);
		--tone-glow: rgba(224, 164, 88, 0.45);
		position: relative;
		display: grid;
		justify-items: center;
		gap: var(--sp-2);
		min-width: 15rem;
		max-width: min(24rem, 86vw);
		padding: var(--sp-6) var(--sp-8) var(--sp-7);
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-lg);
		background:
			var(--grain) 0 0 / 180px,
			radial-gradient(90% 70% at 50% 35%, rgba(255, 190, 100, 0.16), transparent 70%),
			var(--panel-solid);
		background-blend-mode: soft-light, normal, normal;
		box-shadow:
			inset 0 0 0 1px var(--gilt-line-strong),
			inset 0 0 0 5px rgba(0, 0, 0, 0.3),
			var(--shadow-lg),
			0 0 60px var(--tone-glow);
		text-align: center;
		animation: slam 560ms var(--spring) both;
	}

	.card.miss {
		--tone: #b3a38a;
		--tone-glow: rgba(0, 0, 0, 0);
		filter: saturate(0.6);
	}

	.card.heal {
		--tone: #7fc47a;
		--tone-glow: rgba(127, 196, 122, 0.35);
	}

	.card.crit {
		--tone: var(--gilt-hi);
		--tone-glow: rgba(255, 210, 120, 0.75);
		box-shadow:
			inset 0 0 0 2px var(--gilt-hi),
			inset 0 0 0 6px rgba(0, 0, 0, 0.3),
			var(--shadow-lg),
			0 0 90px var(--tone-glow);
	}

	.card.fumble {
		--tone: #e27a6b;
		--tone-glow: rgba(226, 122, 107, 0.45);
		animation:
			slam 560ms var(--spring) both,
			shake 420ms 220ms ease-in-out;
	}

	.who {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	/* The die itself, large behind the result like a medallion struck from the number. */
	.die {
		position: absolute;
		top: 2.2rem;
		left: 50%;
		width: 9.5rem;
		height: 9.5rem;
		margin-left: -4.75rem;
		color: var(--tone);
		opacity: 0.4;
		filter: drop-shadow(0 0 14px var(--tone-glow));
		animation: tumble 700ms var(--ease-out) both;
	}

	.crit .die {
		opacity: 0.85;
	}

	.big {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 9.5rem;
		font-family: var(--font-display);
		font-size: 5.4rem;
		font-weight: 700;
		line-height: 1;
		color: var(--tone);
		text-shadow:
			0 3px 0 rgba(0, 0, 0, 0.6),
			0 0 28px var(--tone-glow);
		animation: stamp 480ms 120ms var(--spring) both;
	}

	.big.word {
		font-family: var(--font-label);
		font-size: 3rem;
		letter-spacing: 0.05em;
		color: var(--muted);
		text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
	}

	.verdict {
		margin-top: calc(-1 * var(--sp-3));
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tone);
	}

	.moment {
		z-index: 1;
	}

	.how {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.outcome {
		font-family: var(--font-label);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text);
	}

	/* A critical throws a ring of light off the card. */
	.card.crit::before {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: inherit;
		border: 2px solid var(--gilt-hi);
		animation: burst 900ms 200ms ease-out both;
		pointer-events: none;
	}

	@keyframes slam {
		0% {
			opacity: 0;
			transform: scale(0.35) rotate(-10deg);
		}
		55% {
			opacity: 1;
			transform: scale(1.1) rotate(2deg);
		}
		100% {
			transform: none;
		}
	}

	@keyframes stamp {
		0% {
			opacity: 0;
			transform: scale(2.2);
		}
		100% {
			opacity: 1;
			transform: none;
		}
	}

	@keyframes tumble {
		from {
			transform: rotate(-120deg) scale(0.6);
			opacity: 0;
		}
	}

	@keyframes shake {
		0%,
		100% {
			translate: 0;
		}
		20% {
			translate: -7px 0;
		}
		40% {
			translate: 6px 0;
		}
		60% {
			translate: -4px 0;
		}
		80% {
			translate: 3px 0;
		}
	}

	@keyframes burst {
		from {
			opacity: 0.9;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(1.35);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card.fumble,
		.die,
		.big,
		.card.crit::before {
			animation: none;
		}
	}
</style>
