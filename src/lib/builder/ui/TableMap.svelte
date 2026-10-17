<script lang="ts">
	import type { GridPos } from '$lib/game/grid';

	/** A little plan of a place's table: its grid, where the party appears, where the props stand. */
	let {
		width,
		height,
		spawn,
		props,
		name
	}: {
		width: number;
		height: number;
		spawn: readonly GridPos[];
		props: readonly { pos: GridPos }[];
		name: string;
	} = $props();

	const label = $derived(
		`Plan of ${name}: ${width} by ${height} cells, ${props.length} ${props.length === 1 ? 'prop' : 'props'}, the party appears at ${
			spawn.length ? spawn.map((c) => `${c.x},${c.y}`).join('; ') : 'nowhere yet'
		}`
	);
	const uid = $props.id();
</script>

<figure class="plan">
	<svg viewBox="-0.3 -0.3 {width + 0.6} {height + 0.6}" role="img" aria-label={label}>
		<defs>
			<pattern id="{uid}-g" width="1" height="1" patternUnits="userSpaceOnUse">
				<path d="M1 0H0V1" fill="none" stroke="rgba(240,212,158,.22)" stroke-width="0.04" />
			</pattern>
		</defs>
		<rect x="0" y="0" {width} {height} fill="#0b0705" />
		<rect x="0" y="0" {width} {height} fill="url(#{uid}-g)" />
		<rect
			x="0"
			y="0"
			{width}
			{height}
			fill="none"
			stroke="rgba(240,212,158,.6)"
			stroke-width="0.12"
		/>
		{#each props as p, i (i)}
			<rect
				x={p.pos.x + 0.22}
				y={p.pos.y + 0.22}
				width="0.56"
				height="0.56"
				rx="0.1"
				fill="#8f5f27"
				stroke="#f0d49e"
				stroke-width="0.05"
			/>
		{/each}
		{#each spawn as c, i (i)}
			<circle
				cx={c.x + 0.5}
				cy={c.y + 0.5}
				r="0.36"
				fill="#e0a458"
				stroke="#fff3d6"
				stroke-width="0.07"
			/>
		{/each}
	</svg>
	<figcaption>
		<span class="key"><i class="spawn"></i>Party</span>
		<span class="key"><i class="prop"></i>Props</span>
	</figcaption>
</figure>

<style>
	.plan {
		display: grid;
		gap: var(--sp-3);
		margin: 0;
	}

	svg {
		display: block;
		width: 100%;
		max-height: 15rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			0 2px 0 var(--ink-line);
	}

	figcaption {
		display: flex;
		gap: var(--sp-5);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}

	i {
		display: inline-block;
		width: 0.8rem;
		height: 0.8rem;
		border: 1px solid #fff3d6;
	}

	.spawn {
		border-radius: 50%;
		background: #e0a458;
	}

	.prop {
		border-radius: 2px;
		border-color: #f0d49e;
		background: #8f5f27;
	}
</style>
