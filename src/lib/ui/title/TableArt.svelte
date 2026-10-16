<script lang="ts">
	/**
	 * The drawing for the title screen's quiet moments: a long game-night table in a dark room under
	 * a hanging lamp. The top is dark glass with a battle map inset in it (a river, a stone bridge,
	 * a hut, the party's four miniatures and one foe) in the right two thirds. The left third is the
	 * Game Master's: a folding screen standing across the end of the table with its painted face
	 * turned to the players, and the GM's rulebook, character sheet, mug and dice tray beside it.
	 * The room is empty of people and chairs: the table is laid and waiting.
	 *
	 * `lit` is the lamp burning and the map awake (nobody has opened a game yet); unlit is the lamp
	 * snuffed and the screen asleep (the server could not be reached): no cone, no pool, no glow,
	 * a thread of smoke, and the whole room a few stops colder.
	 */
	interface Props {
		lit?: boolean;
	}
	let { lit = true }: Props = $props();

	// The map is drawn in its own flat coordinates (u across, v from the far edge to the near edge,
	// both 0..1) and set onto the inset screen with a keystone: wider at the near edge, as a table
	// seen from a little above looks. Linear in v, which is plenty at this size.
	const FAR_Y = 75;
	const NEAR_Y = 101;
	const left = (v: number) => 130 - 14 * v;
	const right = (v: number) => 234 + 26 * v;
	const wide = (v: number) => right(v) - left(v);
	const at = (u: number, v: number): [number, number] => [
		left(v) + wide(v) * u,
		FAR_Y + (NEAR_Y - FAR_Y) * v
	];
	const fmt = (n: number) => n.toFixed(1);
	const poly = (points: [number, number][]) =>
		points.map(([u, v]) => at(u, v).map(fmt).join(',')).join(' ');

	const screen = poly([
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1]
	]);
	const river = poly([
		[0.47, 0],
		[0.455, 0.25],
		[0.47, 0.5],
		[0.44, 0.75],
		[0.43, 1],
		[0.58, 1],
		[0.59, 0.75],
		[0.56, 0.5],
		[0.56, 0.25],
		[0.545, 0]
	]);
	const road = poly([
		[0, 0.4],
		[1, 0.36],
		[1, 0.56],
		[0, 0.6]
	]);
	const lane = poly([
		[0.2, 0.42],
		[0.31, 0.42],
		[0.23, 0.1],
		[0.14, 0.1]
	]);
	const bridge = poly([
		[0.39, 0.36],
		[0.62, 0.36],
		[0.62, 0.58],
		[0.39, 0.58]
	]);
	const bridgeSeams = [0.44, 0.49, 0.54, 0.59]
		.map((u) => {
			const [x1, y1] = at(u, 0.36);
			const [x2, y2] = at(u, 0.58);
			return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
		})
		.join('');
	const gridLines = [
		...Array.from({ length: 9 }, (_, i) => {
			const [x1, y1] = at((i + 1) / 10, 0);
			const [x2, y2] = at((i + 1) / 10, 1);
			return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
		}),
		...Array.from({ length: 5 }, (_, j) => {
			const [x1, y1] = at(0, (j + 1) / 6);
			const [x2, y2] = at(1, (j + 1) / 6);
			return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
		})
	].join('');

	/** A tree or bush: a dark crown and a lighter one set up and to the light. */
	const crowns = (
		[
			[0.07, 0.22, 0.05],
			[0.2, 0.7, 0.055],
			[0.31, 0.88, 0.06],
			[0.11, 0.92, 0.045],
			[0.76, 0.2, 0.05],
			[0.88, 0.3, 0.042],
			[0.82, 0.82, 0.07],
			[0.94, 0.66, 0.05],
			[0.69, 0.92, 0.05],
			[0.67, 0.14, 0.035],
			[0.34, 0.14, 0.03]
		] as [number, number, number][]
	).map(([u, v, r]) => {
		const [x, y] = at(u, v);
		const rx = wide(v) * r;
		return { x, y, rx, ry: rx * 0.62 };
	});
	const rocks = (
		[
			[0.3, 0.6, 0.042],
			[0.79, 0.72, 0.04]
		] as [number, number, number][]
	).map(([u, v, r]) => {
		const [x, y] = at(u, v);
		const rx = wide(v) * r;
		return { x, y, rx, ry: rx * 0.55 };
	});
	const hut = (() => {
		const [x, y] = at(0.22, 0.12);
		const rx = wide(0.12) * 0.07;
		return { x, y, rx, ry: rx * 0.6 };
	})();

	/**
	 * The Game Master's screen: three panels standing on the table across its left end, in line with
	 * the table's own edge, folded in a zigzag so the panels catch the light differently. Each panel
	 * is a parallelogram on the table (base) raised by its height; the painting is drawn once on a
	 * strip three panels wide and laid onto each panel with a matrix, then clipped to the panel.
	 */
	const tableLeft = (y: number) => 62 - 0.905 * (y - 70);
	const fold = [0, 7, 0, 7];
	const base = [76, 85.3, 94.7, 104].map((y, i) => ({
		x: tableLeft(y) + 30 + fold[i],
		y,
		h: 20 + i * 2
	}));
	const panels = [0, 1, 2].map((k) => {
		const a = base[k];
		const b = base[k + 1];
		const h = Math.max(a.h, b.h);
		return {
			k,
			outline: `${fmt(a.x)},${fmt(a.y)} ${fmt(b.x)},${fmt(b.y)} ${fmt(b.x)},${fmt(b.y - b.h)} ${fmt(a.x)},${fmt(a.y - a.h)}`,
			matrix: `matrix(${fmt(b.x - a.x)} ${fmt(b.y - a.y)} 0 ${-h} ${fmt(a.x)} ${fmt(a.y)})`,
			shade: [0, 0.2, 0.06][k]
		};
	});
	const gmTop = base.map((p) => `${fmt(p.x)},${fmt(p.y - p.h)}`).join(' ');
	const gmShadow = [
		...base.map((p) => `${fmt(p.x + 6)},${fmt(p.y + 1.5)}`),
		...[...base].reverse().map((p) => `${fmt(p.x)},${fmt(p.y)}`)
	].join(' ');

	/** The party and one foe, standing on the map: a base, a body, a head. */
	const pieces = (
		[
			[0.3, 0.47, '#4b86c7'],
			[0.37, 0.53, '#8a66b3'],
			[0.28, 0.35, '#e0883a'],
			[0.35, 0.4, '#dcb540'],
			[0.74, 0.46, '#b8453a']
		] as [number, number, string][]
	).map(([u, v, color]) => {
		const [x, y] = at(u, v);
		const r = wide(v) * 0.017;
		return { x, y, r, color };
	});
</script>

<svg
	class="art"
	class:lit
	viewBox="0 0 300 170"
	role="img"
	aria-label={lit
		? 'A game table laid with a battle map, a GM screen and dice, under a lit lamp'
		: 'A game table with its map screen asleep and its lamp snuffed'}
	focusable="false"
>
	<defs>
		<linearGradient id="ta-top" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#4a3322" />
			<stop offset="0.55" stop-color="#2b1c12" />
			<stop offset="1" stop-color="#150d08" />
		</linearGradient>
		<linearGradient id="ta-front" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#1b110a" />
			<stop offset="0.5" stop-color="#3a2516" />
			<stop offset="1" stop-color="#150d08" />
		</linearGradient>
		<linearGradient id="ta-shade" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#7a4d1c" />
			<stop offset="0.38" stop-color="#f0c27a" />
			<stop offset="0.55" stop-color="#d79a4d" />
			<stop offset="1" stop-color="#6a3f14" />
		</linearGradient>
		<linearGradient id="ta-cone" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#ffcf8a" stop-opacity="0.42" />
			<stop offset="0.75" stop-color="#ff9a4d" stop-opacity="0.1" />
			<stop offset="1" stop-color="#ff9a4d" stop-opacity="0" />
		</linearGradient>
		<radialGradient id="ta-pool" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#ffd596" stop-opacity="0.38" />
			<stop offset="0.6" stop-color="#ff9a4d" stop-opacity="0.12" />
			<stop offset="1" stop-color="#ff9a4d" stop-opacity="0" />
		</radialGradient>
		<radialGradient id="ta-glow" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#ffe2a8" stop-opacity="0.95" />
			<stop offset="0.35" stop-color="#ffb866" stop-opacity="0.4" />
			<stop offset="1" stop-color="#ff9a4d" stop-opacity="0" />
		</radialGradient>
		<radialGradient id="ta-under" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#ffb866" stop-opacity="0.35" />
			<stop offset="1" stop-color="#ffb866" stop-opacity="0" />
		</radialGradient>
		<linearGradient id="ta-ground" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#4f8a3c" />
			<stop offset="1" stop-color="#2f6030" />
		</linearGradient>
		<linearGradient id="ta-water" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#4fc3d8" />
			<stop offset="1" stop-color="#2a8fb4" />
		</linearGradient>
		<linearGradient id="ta-sky" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#e3cfa0" />
			<stop offset="1" stop-color="#7fa0a8" />
		</linearGradient>
		<linearGradient id="ta-page" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#d9c496" />
			<stop offset="1" stop-color="#f0e2c2" />
		</linearGradient>
		<linearGradient id="ta-brass" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#8a5a1f" />
			<stop offset="0.6" stop-color="#e3b266" />
			<stop offset="1" stop-color="#b9772a" />
		</linearGradient>
		<filter id="ta-blur" x="-30%" y="-80%" width="160%" height="260%">
			<feGaussianBlur stdDeviation="4" />
		</filter>
		<filter id="ta-bloom" x="-30%" y="-200%" width="160%" height="500%">
			<feGaussianBlur stdDeviation="2" />
		</filter>
		<clipPath id="ta-screen">
			<polygon points={screen} />
		</clipPath>
		{#each panels as p (p.k)}
			<clipPath id="ta-gm-{p.k}">
				<polygon points={p.outline} />
			</clipPath>
		{/each}
	</defs>

	{#if lit}
		<!-- the lamp's cone of light -->
		<polygon points="136,48 164,48 266,110 34,110" fill="url(#ta-cone)" />
	{/if}

	<!-- the floor: a shadow under the table, and the warm strip of light under its lip -->
	<ellipse cx="150" cy="150" rx="132" ry="9" fill="#000" opacity="0.55" filter="url(#ta-blur)" />
	{#if lit}
		<ellipse cx="150" cy="140" rx="128" ry="12" fill="url(#ta-under)" />
	{/if}

	<!-- table legs: the far two show under the lip -->
	<path d="M68 112v22M232 112v22" class="leg" />

	<!-- the table: front face, then the glass top -->
	<path d="M24 112h252v9H24z" fill="url(#ta-front)" />
	<path d="M24 121h252" class="lip" />
	{#if lit}
		<path d="M30 121.4h240" class="led" filter="url(#ta-bloom)" />
		<path d="M30 121.4h240" class="led core" />
	{/if}
	<path d="M30 121v28M270 121v28" class="leg" />
	<polygon points="62,70 238,70 276,112 24,112" fill="url(#ta-top)" class="rim" />
	<polygon points="70,70 96,70 60,112 38,112" fill="#fff" opacity="0.05" />
	{#if lit}
		<ellipse cx="176" cy="90" rx="96" ry="16" fill="url(#ta-pool)" />
	{/if}

	<!-- the inset map screen -->
	<polygon points={screen} fill="#07090a" class="bezel" />
	<g clip-path="url(#ta-screen)">
		<polygon points={screen} fill="url(#ta-ground)" />
		<polygon points={lane} fill="#c9a96c" />
		<polygon points={road} fill="#d6b97c" />
		<polygon points={river} fill="url(#ta-water)" />
		<path d={gridLines} class="grid" />
		<polygon points={bridge} fill="#6c6a72" />
		<path d={bridgeSeams} class="seam" />
		<path
			d={`M${at(0.39, 0.36).map(fmt).join(' ')}L${at(0.62, 0.36).map(fmt).join(' ')}`}
			class="rail"
		/>
		<path
			d={`M${at(0.39, 0.58).map(fmt).join(' ')}L${at(0.62, 0.58).map(fmt).join(' ')}`}
			class="rail"
		/>
		<ellipse cx={hut.x} cy={hut.y} rx={hut.rx} ry={hut.ry} fill="#a67a42" />
		<ellipse cx={hut.x} cy={hut.y - 0.4} rx={hut.rx * 0.55} ry={hut.ry * 0.55} fill="#d9b06a" />
		{#each rocks as r, i (i)}
			<ellipse cx={r.x} cy={r.y} rx={r.rx} ry={r.ry} fill="#a49aa8" />
			<ellipse
				cx={r.x - r.rx * 0.2}
				cy={r.y - r.ry * 0.25}
				rx={r.rx * 0.6}
				ry={r.ry * 0.5}
				fill="#cfc7d3"
			/>
		{/each}
		{#each crowns as c, i (i)}
			<ellipse cx={c.x} cy={c.y + c.ry * 0.15} rx={c.rx} ry={c.ry} fill="#1f4a28" />
			<ellipse
				cx={c.x - c.rx * 0.12}
				cy={c.y - c.ry * 0.2}
				rx={c.rx * 0.78}
				ry={c.ry * 0.78}
				fill="#3f8a3e"
			/>
			<ellipse
				cx={c.x - c.rx * 0.25}
				cy={c.y - c.ry * 0.4}
				rx={c.rx * 0.4}
				ry={c.ry * 0.36}
				fill="#6fb552"
			/>
		{/each}
		{#each pieces as p, i (i)}
			<ellipse
				cx={p.x}
				cy={p.y + p.r * 0.2}
				rx={p.r * 1.25}
				ry={p.r * 0.55}
				fill="#000"
				opacity="0.5"
			/>
			<path
				d={`M${fmt(p.x - p.r)} ${fmt(p.y)}c0-${fmt(p.r * 1.2)} ${fmt(p.r * 0.4)}-${fmt(p.r * 1.7)} ${fmt(p.r)}-${fmt(p.r * 1.7)}s${fmt(p.r)} ${fmt(p.r * 0.5)} ${fmt(p.r)} ${fmt(p.r * 1.7)}z`}
				fill={p.color}
			/>
			<circle cx={p.x} cy={p.y - p.r * 2} r={p.r * 0.72} fill={p.color} />
			<circle cx={p.x - p.r * 0.2} cy={p.y - p.r * 2.2} r={p.r * 0.25} fill="#fff" opacity="0.5" />
		{/each}
		<polygon points={screen} fill="#fff" opacity="0.06" class="glass" />
		{#if !lit}
			<!-- asleep -->
			<polygon points={screen} fill="#0b0705" opacity="0.8" />
		{/if}
	</g>
	<polygon points={screen} class="bezel-line" />
	{#if lit}
		<polygon points={screen} fill="#6fd0a0" opacity="0.1" filter="url(#ta-blur)" />
	{/if}

	<!-- the GM's character sheet and pencil, and a mug: behind where the screen stands -->
	<g class="sheet">
		<polygon
			points="38,98 56,96 60,107 34,109"
			fill="#2a1a0f"
			opacity="0.5"
			transform="translate(0 1.4)"
		/>
		<polygon points="38,98 56,96 60,107 34,109" fill="url(#ta-page)" />
		<path d="M41 100.6l13-1.6M40.4 103l14.4-1.6M39.8 105.4l15.4-1.6" class="ink" />
		<path d="M42 107l14-5" class="pencil" />
	</g>
	<g class="mug" transform="translate(3 0)">
		<ellipse cx="58" cy="90" rx="5.4" ry="2" fill="#000" opacity="0.4" />
		<path d="M52.6 82v7a5.4 2 0 0 0 10.8 0v-7z" fill="#7a4d1c" />
		<ellipse cx="58" cy="82" rx="5.4" ry="2" fill="#2a1408" />
		<path d="M63.4 84c4 0 4 5 0 5" class="handle" />
		<path d="M54 83v6" stroke="#f0c27a" stroke-opacity="0.5" stroke-width="1" />
	</g>

	<!-- the Game Master's screen: three folded panels across the left end, the painting facing the table -->
	<g class="gm">
		<polygon points={gmShadow} fill="#000" opacity="0.45" filter="url(#ta-bloom)" />
		{#each panels as p (p.k)}
			<g clip-path="url(#ta-gm-{p.k})">
				<g transform={p.matrix}>
					<g transform="translate({-p.k} 0)">
						<rect x="0" y="0" width="3" height="1" fill="url(#ta-sky)" />
						<path
							d="M0 0V.28L.25 .55L.4 .42L.62 .78L.8 .52L1.05 .7L1.3 .45L1.55 .66L1.8 .5L2.1 .8L2.35 .55L2.6 .72L3 .48V0z"
							fill="#5a5552"
						/>
						<path
							d="M0 0V.12L.3 .3L.55 .2L.9 .38L1.2 .22L1.6 .36L2 .2L2.4 .34L2.8 .22L3 .3V0z"
							fill="#241f1d"
						/>
					</g>
				</g>
				<polygon points={p.outline} fill="#000" opacity={p.shade} />
			</g>
			<polygon points={p.outline} class="gm-edge" />
		{/each}
		<polyline points={gmTop} class="gm-top" />
	</g>

	<!-- the rulebook, closed, with a gilt frame: between the screen and the map -->
	<g class="book" transform="translate(-126 -2)">
		<polygon points="216,86 240,84 244,92 219,95" fill="#2a0f0f" />
		<polygon points="216,84 240,82 244,90 219,93" fill="#6a2222" />
		<polygon points="216,84 240,82 241,84 217,86" fill="#a64a3a" opacity="0.7" />
		<polygon points="222,86 236,85 238,89 223,90.5" class="gilt" />
		<polygon points="219,93 244,90 244,92 219,95" fill="#e8d7b0" />
	</g>

	<!-- the dice tray: green felt, a brass lip, a d6, a d20, a d8 -->
	<g class="tray" transform="translate(-152 3)">
		<polygon points="238,95 259,95 265,107 233,107" fill="#13241b" />
		<polygon points="238,95 259,95 265,107 233,107" class="tray-lip" />
		<ellipse cx="247" cy="104" rx="3.8" ry="1.3" fill="#000" opacity="0.4" />
		<path d="M243 98.5l3-1.8 3 1.8v4l-3 1.8-3-1.8z" fill="#efe2c6" />
		<path d="M243 98.5l3-1.8 3 1.8-3 1.8z" fill="#fff8e8" />
		<path d="M246 100.3v5.5M243 102.5l3 1.5 3-1.5" class="pip" />
		<path d="M252.6 101.4l3.6 2.3-1.4 3.6h-4.4l-1.4-3.6z" fill="#c98b3c" />
		<path d="M252.6 101.4l3.6 2.3-3.6 1.1-3.6-1.1z" fill="#f0c27a" />
		<path d="M241.4 103.2l2.4 2.6-2.4 2.6-2.4-2.6z" fill="#a13a3a" />
		<path d="M241.4 103.2l2.4 2.6h-4.8z" fill="#d46a5a" />
	</g>

	<!-- the lamp on its cord -->
	<path d="M150 0v16" class="cord" />
	<path d="M150 16c-3 0-4 3-4 4h8c0-1-1-4-4-4z" fill="#8a5a1f" />
	<path d="M128 46c0-17 10-27 22-27s22 10 22 27z" fill="url(#ta-shade)" />
	<path d="M137 42c1-11 6-18 13-20" class="shine" />
	<ellipse cx="150" cy="46" rx="22" ry="3.6" fill="#5a3611" />
	{#if lit}
		<circle class="halo" cx="150" cy="49" r="30" fill="url(#ta-glow)" />
		<ellipse cx="150" cy="48" rx="6.5" ry="5" fill="#fff0c8" />
	{:else}
		<ellipse cx="150" cy="48" rx="6.5" ry="5" fill="#3a2a1a" />
		<path class="smoke" d="M150 43c-4-6 4-9 0-15s3-8 1-13" />
	{/if}
</svg>

<style>
	.art {
		display: block;
		width: min(24rem, 100%);
		height: auto;
		overflow: visible;
	}

	.rim {
		stroke: rgba(255, 214, 150, 0.3);
		stroke-width: 1;
		stroke-linejoin: round;
	}

	.lip {
		fill: none;
		stroke: rgba(255, 214, 150, 0.2);
		stroke-width: 0.8;
	}

	.leg,
	.cord {
		fill: none;
		stroke: #1e130b;
		stroke-width: 4;
		stroke-linecap: round;
	}

	.cord {
		stroke: #8a5a1f;
		stroke-width: 1.4;
	}

	.led {
		fill: none;
		stroke: #ffb866;
		stroke-width: 2.6;
		stroke-linecap: round;
		opacity: 0.8;
	}

	.led.core {
		stroke: #ffe2a8;
		stroke-width: 0.9;
		opacity: 1;
	}

	.bezel {
		stroke: #000;
		stroke-width: 2.4;
		stroke-linejoin: round;
	}

	.bezel-line {
		fill: none;
		stroke: rgba(255, 244, 214, 0.22);
		stroke-width: 0.6;
		stroke-linejoin: round;
	}

	.grid {
		fill: none;
		stroke: rgba(255, 255, 255, 0.14);
		stroke-width: 0.35;
	}

	.seam {
		fill: none;
		stroke: rgba(20, 16, 24, 0.55);
		stroke-width: 0.5;
	}

	.rail {
		fill: none;
		stroke: #3b3a42;
		stroke-width: 1.3;
		stroke-linecap: round;
	}

	.gm-edge {
		fill: none;
		stroke: rgba(20, 12, 6, 0.55);
		stroke-width: 0.5;
		stroke-linejoin: round;
	}

	.gm-top {
		fill: none;
		stroke: rgba(255, 236, 200, 0.5);
		stroke-width: 0.8;
		stroke-linejoin: round;
	}

	.gilt {
		fill: none;
		stroke: #e3b266;
		stroke-width: 0.7;
		stroke-linejoin: round;
	}

	.ink {
		fill: none;
		stroke: rgba(60, 40, 20, 0.7);
		stroke-width: 0.6;
		stroke-linecap: round;
	}

	.pencil {
		fill: none;
		stroke: #d9a23a;
		stroke-width: 1.6;
		stroke-linecap: round;
	}

	.handle {
		fill: none;
		stroke: #7a4d1c;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.tray-lip {
		fill: none;
		stroke: #c58d44;
		stroke-width: 1.2;
		stroke-linejoin: round;
	}

	.pip {
		fill: none;
		stroke: rgba(70, 40, 20, 0.55);
		stroke-width: 0.5;
		stroke-linecap: round;
	}

	.shine {
		fill: none;
		stroke: rgba(255, 244, 214, 0.55);
		stroke-width: 1.6;
		stroke-linecap: round;
	}

	.smoke {
		fill: none;
		stroke: rgba(210, 190, 160, 0.4);
		stroke-width: 1.4;
		stroke-linecap: round;
	}

	/* The snuffed lamp: the same room, a few stops colder and darker. */
	.art:not(.lit) {
		filter: saturate(0.55) brightness(0.72);
	}

	.halo {
		transform-box: fill-box;
		transform-origin: center;
		animation: breathe 4.8s ease-in-out infinite;
	}

	@keyframes breathe {
		50% {
			opacity: 0.8;
			transform: scale(0.94);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.halo {
			animation: none;
		}
	}
</style>
