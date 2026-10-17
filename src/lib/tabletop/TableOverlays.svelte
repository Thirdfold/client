<script lang="ts">
	import { Icon } from '$lib/ui/game';
	import Notice from '$lib/ui/hud/Notice.svelte';
	import type { PerfStats } from './perf';

	/**
	 * What shows over the table besides the table (Tabletop.svelte; the loading cover is
	 * TableLoading.svelte): the `?perf` overlay, the notices for a lost device and for
	 * software rendering (dismissable), and the panel when the table can't be shown at all.
	 */
	let {
		perf,
		lossNotice = $bindable(),
		softwareNotice = $bindable(),
		webglError
	}: {
		perf: PerfStats | null;
		lossNotice: boolean;
		softwareNotice: boolean;
		webglError: string | null;
	} = $props();

	const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
	const avg = (label: string) => {
		const t = perf?.timings[label];
		return t && t.count ? (t.total / t.count).toFixed(2) : '–';
	};
	/** GPU ms by pass (#166), in the order the pipeline draws them. */
	const ORDER = [
		'prepass',
		'ao',
		'scene',
		'smaa',
		'traa',
		'dof',
		'blur',
		'bloom',
		'output',
		'overlay'
	];
	const passes = $derived(
		Object.entries(perf?.gpu ?? {}).sort(
			([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)
		)
	);
</script>

{#if lossNotice}
	<div class="notices">
		<Notice tone="warn" icon="warn" role="status">
			The graphics device was lost twice: the table is drawn at low quality for now.
			{#snippet action()}
				<button type="button" onclick={() => (lossNotice = false)} aria-label="Dismiss">
					<Icon name="close" size="1rem" />
				</button>
			{/snippet}
		</Notice>
	</div>
{/if}
{#if perf}
	<dl class="perf" aria-label="Rendering performance">
		<dt>backend</dt>
		<dd>{perf.backend}{perf.compat ? ' (compat)' : ''}</dd>
		<dt>adapter</dt>
		<dd class="adapter" title={perf.adapter ?? ''}>{perf.adapter ?? '–'}</dd>
		<dt>tier / mode</dt>
		<dd>{perf.tier ?? '–'} / {perf.mode ?? '–'}</dd>
		<dt>fps</dt>
		<dd>{perf.fps}</dd>
		<dt>frame ms</dt>
		<dd>{avg('frame')} (max {perf.timings.frame?.max.toFixed(1) ?? '–'})</dd>
		<dt>GPU ms</dt>
		<dd>{perf.gpuMs === null ? 'n/a' : perf.gpuMs.toFixed(2)}</dd>
		{#each passes as [pass, ms] (pass)}
			<dt class="pass">{pass}</dt>
			<dd>{ms.toFixed(2)}</dd>
		{/each}
		<dt>draws</dt>
		<dd>{perf.drawCalls}</dd>
		<dt>triangles</dt>
		<dd>{perf.triangles.toLocaleString()}</dd>
		<dt>geo / tex</dt>
		<dd>{perf.geometries} / {perf.textures}</dd>
		<dt>prog / pipelines</dt>
		<dd>{perf.programs} / {perf.pipelines}</dd>
		<dt>memory MB</dt>
		<dd>{mb(perf.memoryBytes)} (tex {mb(perf.texturesBytes)})</dd>
		<dt>lighting ms</dt>
		<dd>{avg('lighting')} ×{perf.timings.lighting?.count ?? 0}</dd>
		{#if perf.heroes?.owners.length}
			<dt>hero slots</dt>
			<dd title={perf.heroes.owners.map((o) => o ?? '–').join(', ')}>
				{perf.heroes.owners.filter(Boolean).length}/{perf.heroes.owners.length}, cubes
				{perf.heroes.redraws.reduce((a, b) => a + b, 0)} (+{perf.heroes.lastRedraws}),
				{mb(perf.heroes.cubeBytes)} MB
			</dd>
		{/if}
		{#if perf.vfx?.live}
			<dt>particles</dt>
			<dd>{perf.vfx.live} ({perf.vfx.bursts} bursts, {perf.vfx.loops} loops)</dd>
		{/if}
	</dl>
{/if}
{#if softwareNotice}
	<div class="notices">
		<Notice tone="warn" icon="info" role="status">
			No graphics card in use: the table is drawn in software, at low quality.
			{#snippet action()}
				<button type="button" onclick={() => (softwareNotice = false)} aria-label="Dismiss">
					<Icon name="close" size="1rem" />
				</button>
			{/snippet}
		</Notice>
	</div>
{/if}
{#if webglError}
	<div class="webgl-error g-frame" role="alert">
		<span class="mark" aria-hidden="true"><Icon name="warn" size="2.2rem" /></span>
		<p class="title">The table can’t be shown here</p>
		<p>{webglError}</p>
		<p>
			You’re still at the table: chat, dice and the panels work. To see it, turn on hardware
			acceleration in your browser’s settings, or open this link in another browser.
		</p>
	</div>
{/if}

<style>
	.perf {
		position: absolute;
		left: 0.5rem;
		bottom: 0.5rem;
		display: grid;
		grid-template-columns: auto auto;
		gap: 0 var(--sp-4);
		margin: 0;
		padding: var(--sp-3) var(--sp-4);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color: var(--glow);
		background: var(--scrim);
		pointer-events: none;
		z-index: var(--z-overlay);
	}

	.perf dd {
		margin: 0;
	}

	.perf .pass {
		padding-left: 1ch;
		opacity: 0.75;
	}

	.perf .adapter {
		max-width: 24ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Notices about how the table is drawn rest on the table's lower edge, above the hotbar. */
	.notices {
		position: absolute;
		bottom: calc(var(--edge, 0.75rem) + 15rem);
		left: var(--free-left, 1rem);
		right: var(--free-right, 1rem);
		display: grid;
		justify-items: center;
		z-index: var(--z-hud);
		pointer-events: none;
	}

	@media (max-width: 48rem) {
		.notices {
			top: var(--below-bar, 5rem);
			bottom: auto;
		}
	}

	.notices :global(.notice) {
		font-size: var(--fs-sm);
	}

	.notices :global(.act button) {
		min-height: 2rem;
		padding: var(--sp-1) var(--sp-3);
	}

	/* Centred in the free space between the room's chat and side panels. */
	.webgl-error {
		position: absolute;
		top: 50%;
		left: var(--free-left, 1rem);
		right: var(--free-right, 1rem);
		transform: translateY(-50%);
		margin-inline: auto;
		width: min(28rem, calc(100% - var(--free-left, 1rem) - var(--free-right, 1rem)));
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		padding: var(--sp-7) var(--sp-8);
		border-radius: var(--radius-lg);
		color: var(--muted);
		text-align: center;
		box-shadow:
			inset 0 0 0 2px rgba(226, 122, 107, 0.55),
			inset 0 0 0 6px rgba(0, 0, 0, 0.3),
			var(--shadow-lg);
	}

	.webgl-error > :global(*) {
		position: relative;
		z-index: 1;
	}

	.webgl-error .mark {
		display: grid;
		color: var(--danger);
	}

	.webgl-error p {
		margin: 0;
		max-width: 65ch;
	}

	.webgl-error .title {
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--gilt-hi);
	}
</style>
