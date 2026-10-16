<script module lang="ts">
	/** Lines for the loading screens, in the table's own voice. */
	export const TIPS = [
		'Click your miniature, then a cell on the table, to walk there.',
		'Walk up beside a person or a thing to talk to it, search it or open it.',
		'The number keys use the slots on your hotbar. Q rolls the d20.',
		'Tactical looks down on the whole table. Explore comes down to the miniatures.',
		'A closed door opens when one of your tokens stands beside it.',
		'The GM can pause the game at any time. The table waits for everyone.'
	];
</script>

<script lang="ts">
	import { asset } from '$app/paths';
	import type { Tabletop } from './types';

	/**
	 * The cover over the table while it loads (Tabletop.svelte): from the renderer starting until
	 * the first look's loads have settled (the environment and the nearest models, M76 #340; the
	 * rest streams in behind placeholders), its shaders are warm and it has come to rest, then it
	 * lifts away. Again, quicker, for a new table (`table` changes: travel, a load) and a rebuilt
	 * renderer (`tabletop` goes and comes back).
	 */
	let { tabletop, table }: { tabletop: Tabletop | null; table: string } = $props();

	const STAGES = ['Setting the table', 'Placing the pieces', 'Warming the lights'];
	/** A tip for this cover; the next table gets another. */
	const tip = $derived(TIPS[Math.abs(hash(table)) % TIPS.length]);
	function hash(text: string): number {
		let h = 0;
		for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) | 0;
		return h;
	}
	let stage = $state(0);
	let loads = $state<[number, number]>([0, 0]);
	let ready = $state(false);
	/** How far along the cover is, 0 to 1: the stages, and within the second the loads settled. */
	const progress = $derived(
		stage === 0 ? 0.08 : stage === 1 ? 0.2 + 0.6 * (loads[1] > 0 ? loads[0] / loads[1] : 0) : 0.92
	);
	/** Shown once already: later covers lift quicker. */
	let quick = $state(false);
	/** The tabletop last covered, to tell a rebuilt renderer from a new table. */
	let covered: Tabletop | null = null;
	/** The cover is over a rebuilt renderer: "Restoring the table" until it lifts. */
	let restoring = $state(false);

	$effect(() => {
		const t = tabletop;
		void table;
		ready = false;
		stage = 0;
		// The tabletop went (a lost device, a new pipeline shape): restoring until the next one is
		// ready. The same tabletop on a new table is a new table, not a rebuild.
		if (!t) {
			if (covered) restoring = true;
			return;
		}
		if (t === covered) restoring = false;
		covered = t;
		// Loads settled before now were the last table's.
		const [, , before] = t.loads();
		const started = performance.now();
		let timer = 0;
		const poll = () => {
			const [, , done, all] = t.loads();
			const s = t.stats();
			loads = [done - before, all - before];
			stage = done < all ? 1 : 2;
			// ponytail: gives up after 30 s (a table that never rests, a stalled download).
			const calm = !s.holding && s.frames > 0 && (s.mode === 'idle' || s.mode === 'ambient');
			if ((done === all && calm) || performance.now() - started > 30_000) ready = true;
			else timer = window.setTimeout(poll, 100);
		};
		poll();
		return () => clearTimeout(timer);
	});

	/** Lifts away: fades, grows a touch and blurs; only fades under reduced motion. */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function lift(_: Element) {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const duration = still ? 250 : quick ? 450 : 800;
		quick = true;
		return {
			duration,
			easing: (p: number) => 1 - (1 - p) ** 3,
			css: (t: number, u: number) =>
				still
					? `opacity:${t}`
					: `opacity:${t};transform:scale(${1 + u * 0.04});filter:blur(${u * 6}px)`
		};
	}
</script>

{#if !ready}
	<div class="loading" data-cover={restoring ? 'restoring' : 'loading'} out:lift>
		<picture>
			<source
				srcset={asset('/brand/thirdfold-mark.svg')}
				media="(prefers-reduced-motion: reduce)"
			/>
			<img src={asset('/brand/thirdfold-mark-animated.svg')} alt="" />
		</picture>
		<p class="stage" role="status">
			{restoring ? 'Restoring the table' : STAGES[stage]}{stage === 1
				? `: ${loads[0]} of ${loads[1]}`
				: ''}
		</p>
		<span class="bar" aria-hidden="true"
			><span style:width="{Math.round(progress * 100)}%"></span></span
		>
		<ol aria-hidden="true">
			{#each STAGES as name, i (name)}
				<li class:done={i < stage} class:now={i === stage}>{name}</li>
			{/each}
		</ol>
		<p class="tip" aria-hidden="true"><span class="g-tag">Tip</span> {tip}</p>
	</div>
{/if}

<style>
	/* No z-index: the room's panels, later in the page, stay usable above it. */
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--sp-5);
		padding-inline: var(--free-left, 1rem) var(--free-right, 1rem);
		background:
			radial-gradient(55% 45% at 50% 44%, rgba(224, 164, 88, 0.16), transparent 72%),
			radial-gradient(120% 100% at 50% 50%, transparent 50%, rgba(0, 0, 0, 0.6)), var(--bg);
		color: var(--muted);
		text-align: center;
	}

	img {
		display: block;
		width: min(11rem, 44vw);
		height: auto;
		filter: drop-shadow(0 0 26px var(--ember-glow));
	}

	.stage {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
		text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
		font-variant-numeric: tabular-nums;
	}

	/* The progress bar: a groove with a brass fill that creeps along it. */
	.bar {
		position: relative;
		width: min(20rem, 100%);
		height: 0.8rem;
		overflow: hidden;
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 var(--gilt-line);
	}

	.bar span {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--gilt-grad);
		box-shadow: 0 0 12px var(--ember-glow);
		transition: width 500ms var(--ease-out);
	}

	ol {
		display: flex;
		gap: var(--sp-6);
		margin: 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.04em;
	}

	li {
		opacity: 0.4;
	}

	.done {
		opacity: 0.75;
	}

	.now {
		opacity: 1;
		color: var(--gilt);
	}

	.tip {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		max-width: 28rem;
		margin: var(--sp-4) 0 0;
		text-align: left;
	}

	@media (max-width: 48rem) {
		ol {
			display: none;
		}
	}
</style>
