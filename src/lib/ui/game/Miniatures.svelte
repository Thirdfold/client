<script lang="ts">
	/**
	 * Four painted miniatures, one for each class of the first adventure, standing on turned wooden
	 * bases with a brass ring: the Warden (helm, shield, sword), the Veil (hood, dagger), the Ember
	 * (pointed hat, a staff with a flame) and the Saint (a halo, a mace). They are the title
	 * screen's furniture: two pairs at the table's edge, the light from the lamp in the middle, so
	 * each pair is lit from the side that faces the centre and the right pair is the left one mirrored.
	 *
	 * Class colours are the medallion colours used everywhere else (Portrait, the character cards),
	 * so a player meets the same four hues on the title and at the table. Pure SVG, no assets; the
	 * shapes live in <symbol>s in one hidden sheet so the gradients keep working when a pair is
	 * hidden at narrow widths.
	 */
	const classes = [
		{ id: 'warden', base: '#3f78b5' },
		{ id: 'veil', base: '#7a58a0' },
		{ id: 'ember', base: '#d9772b' },
		{ id: 'saint', base: '#d1a62c' }
	];

	/** Blend two #rrggbb colours: t=0 is `a`, t=1 is `b`. */
	function mix(a: string, b: string, t: number): string {
		const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
		const c = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t);
		return `rgb(${c(0)} ${c(1)} ${c(2)})`;
	}
</script>

{#snippet base(id: string)}
	<ellipse cx="66" cy="206" rx="50" ry="9" fill="#000" opacity="0.6" filter="url(#mn-blur)" />
	<path d="M20 198v6a40 9.5 0 0 0 80 0v-6z" fill="url(#mn-wood)" />
	<ellipse cx="60" cy="198" rx="40" ry="10" fill="url(#mn-brass)" />
	<ellipse cx="60" cy="197.4" rx="35" ry="8" fill="url(#mn-{id}-dk)" />
	<path d="M24 201a40 10 0 0 0 72 0" fill="none" stroke="rgba(255,236,190,.5)" stroke-width="1" />
{/snippet}

<svg class="sheet" width="0" height="0" aria-hidden="true" focusable="false">
	<defs>
		<filter id="mn-blur" x="-30%" y="-100%" width="160%" height="300%">
			<feGaussianBlur stdDeviation="4" />
		</filter>
		<filter id="mn-bloom" x="-100%" y="-100%" width="300%" height="300%">
			<feGaussianBlur stdDeviation="3.5" />
		</filter>
		{#each classes as c (c.id)}
			<linearGradient id="mn-{c.id}" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" stop-color={mix(c.base, '#000000', 0.66)} />
				<stop offset="0.42" stop-color={mix(c.base, '#000000', 0.28)} />
				<stop offset="0.8" stop-color={mix(c.base, '#ffffff', 0.2)} />
				<stop offset="1" stop-color={mix(c.base, '#000000', 0.18)} />
			</linearGradient>
			<linearGradient id="mn-{c.id}-dk" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" stop-color={mix(c.base, '#000000', 0.82)} />
				<stop offset="0.7" stop-color={mix(c.base, '#000000', 0.5)} />
				<stop offset="1" stop-color={mix(c.base, '#000000', 0.62)} />
			</linearGradient>
		{/each}
		<linearGradient id="mn-wood" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#150d08" />
			<stop offset="0.6" stop-color="#3a2516" />
			<stop offset="1" stop-color="#1c120b" />
		</linearGradient>
		<linearGradient id="mn-brass" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#6a4415" />
			<stop offset="0.5" stop-color="#c58d44" />
			<stop offset="0.82" stop-color="#f2cd8a" />
			<stop offset="1" stop-color="#8a5a1f" />
		</linearGradient>
		<radialGradient id="mn-bone" cx="0.68" cy="0.3" r="0.8">
			<stop offset="0" stop-color="#f3e4c4" />
			<stop offset="0.6" stop-color="#c9b18a" />
			<stop offset="1" stop-color="#6e5a3f" />
		</radialGradient>
		<linearGradient id="mn-steel" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#2c313a" />
			<stop offset="0.55" stop-color="#8d96a3" />
			<stop offset="0.82" stop-color="#e3e8ee" />
			<stop offset="1" stop-color="#59606b" />
		</linearGradient>
		<linearGradient id="mn-staff" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#1d120b" />
			<stop offset="0.7" stop-color="#7a5230" />
			<stop offset="1" stop-color="#3a2516" />
		</linearGradient>
		<radialGradient id="mn-flame" cx="0.5" cy="0.75" r="0.7">
			<stop offset="0" stop-color="#fff6d6" />
			<stop offset="0.35" stop-color="#ffc766" />
			<stop offset="1" stop-color="#e8641e" />
		</radialGradient>
		<radialGradient id="mn-glow" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#ffd596" stop-opacity="0.75" />
			<stop offset="0.5" stop-color="#ff9a4d" stop-opacity="0.22" />
			<stop offset="1" stop-color="#ff9a4d" stop-opacity="0" />
		</radialGradient>
		<radialGradient id="mn-halo" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#ffe9a8" stop-opacity="0.55" />
			<stop offset="1" stop-color="#ffd37a" stop-opacity="0" />
		</radialGradient>

		<!-- The Warden: helm and plume, a kite shield on the left arm, a sword in the right hand. -->
		<symbol id="mn-fig-warden" viewBox="0 0 120 220">
			{@render base('warden')}
			<path
				d="M34 196C32 166 36 142 46 128h28c10 14 14 38 12 68a26 6 0 0 1-52 0z"
				fill="url(#mn-warden)"
			/>
			<path d="M54 130h12l3 66H51z" fill="#0a0604" opacity="0.18" />
			<path d="M53 146h14" stroke="#e3b266" stroke-width="2.4" stroke-linecap="round" />
			<path d="M86 196c2-30-2-54-12-68" fill="none" stroke="#f2cd8a" stroke-opacity="0.6" />
			<ellipse cx="44" cy="130" rx="10" ry="6.5" fill="url(#mn-steel)" />
			<ellipse cx="76" cy="130" rx="10" ry="6.5" fill="url(#mn-steel)" />
			<circle cx="60" cy="108" r="14" fill="url(#mn-bone)" />
			<path d="M45 108a15 15 0 0 1 30 0v3H45z" fill="url(#mn-steel)" />
			<path d="M58 100h4v14h-4z" fill="#3a4049" />
			<path
				d="M60 94c-3-9 2-16 13-17-4 5-4 11-2 17z"
				fill={mix('#3f78b5', '#ffffff', 0.1)}
				stroke="#13263a"
				stroke-width="0.8"
			/>
			<path d="M88 94h4l1 54h-6z" fill="url(#mn-steel)" />
			<path d="M81 148h18v4H81z" fill="url(#mn-brass)" />
			<path d="M88 152h4v10h-4z" fill="#3a2516" />
			<circle cx="90" cy="157" r="4.6" fill="url(#mn-bone)" />
			<path
				d="M14 136h32c0 30-6 48-16 58-10-10-16-28-16-58z"
				fill="url(#mn-warden)"
				stroke="url(#mn-brass)"
				stroke-width="2.4"
				stroke-linejoin="round"
			/>
			<path d="M30 140v46M18 150h24" stroke="#e3b266" stroke-width="1.6" opacity="0.8" />
			<circle cx="30" cy="158" r="5.4" fill="url(#mn-brass)" />
		</symbol>

		<!-- The Veil: a hood with nothing in it but two points of light, a dagger held low. -->
		<symbol id="mn-fig-veil" viewBox="0 0 120 220">
			{@render base('veil')}
			<path
				d="M38 196c2-28 6-56 12-74h20c8 18 12 46 14 74a23 5.5 0 0 1-46 0z"
				fill="url(#mn-veil)"
			/>
			<path d="M38 196c-4-20 0-46 10-70-2 24-2 46 4 70z" fill="#0a0510" opacity="0.5" />
			<path d="M84 196c-2-28-6-56-14-74" fill="none" stroke="#f2cd8a" stroke-opacity="0.55" />
			<path
				d="M46 156c10 4 26 4 36 0"
				fill="none"
				stroke="#e3b266"
				stroke-width="2"
				opacity="0.7"
			/>
			<path d="M42 126c-3-28 7-46 19-46s22 18 18 46c-6-8-30-8-37 0z" fill="url(#mn-veil)" />
			<path d="M66 82c8 6 12 20 11 40" fill="none" stroke="#f2cd8a" stroke-opacity="0.5" />
			<ellipse cx="60" cy="104" rx="9" ry="12" fill="#0a0510" />
			<circle cx="56" cy="102" r="1.3" fill="#ffd596" />
			<circle cx="64.5" cy="102" r="1.3" fill="#ffd596" />
			<path d="M82 150l5 0-2 28z" fill="url(#mn-steel)" />
			<path d="M80 148h9v3h-9z" fill="url(#mn-brass)" />
			<circle cx="84.5" cy="145" r="4.4" fill="url(#mn-bone)" />
		</symbol>

		<!-- The Ember: pointed hat, a wide brass-banded robe, a staff with a flame on it. -->
		<symbol id="mn-fig-ember" viewBox="0 0 120 220">
			{@render base('ember')}
			<rect x="95" y="76" width="4" height="122" rx="1.8" fill="url(#mn-staff)" />
			<circle cx="99" cy="52" r="26" fill="url(#mn-glow)" />
			<path d="M91 76c-4-9 0-13 3-13 2 0 3 1 5 1s3-1 5-1c3 0 7 4 3 13z" fill="url(#mn-brass)" />
			<path
				d="M99 30c-8 9-10 17-5 24 2 3 6 4 10 2 6-6 4-15-5-26z"
				fill="url(#mn-flame)"
				filter="url(#mn-bloom)"
				opacity="0.6"
			/>
			<path d="M99 32c-7 8-9 16-4 22 2 3 6 3 9 1 5-6 3-14-5-23z" fill="url(#mn-flame)" />
			<path
				d="M30 196c2-30 10-58 20-72h20c10 14 18 42 20 72a30 6.5 0 0 1-60 0z"
				fill="url(#mn-ember)"
			/>
			<path d="M90 196c-2-30-10-58-20-72" fill="none" stroke="#ffe0a8" stroke-opacity="0.6" />
			<path d="M32 164c18 8 38 8 56 0v6c-18 8-38 8-56 0z" fill="url(#mn-brass)" />
			<circle cx="60" cy="112" r="12" fill="url(#mn-bone)" />
			<ellipse cx="60" cy="103" rx="27" ry="6.5" fill="url(#mn-ember-dk)" />
			<path d="M42 103c6-20 12-36 26-56-2 16 4 36 10 56z" fill="url(#mn-ember-dk)" />
			<path d="M43 100c10 5 24 5 34 0" fill="none" stroke="#e3b266" stroke-width="2.2" />
			<path d="M70 52c0 14 4 32 8 50" fill="none" stroke="#ffe0a8" stroke-opacity="0.35" />
			<circle cx="97" cy="150" r="4.6" fill="url(#mn-bone)" />
		</symbol>

		<!-- The Saint: a halo that gives light, a pale tabard, a flanged mace. -->
		<symbol id="mn-fig-saint" viewBox="0 0 120 220">
			{@render base('saint')}
			<ellipse cx="60" cy="86" rx="24" ry="9" fill="url(#mn-halo)" />
			<path
				d="M34 196c0-28 8-56 16-70h20c8 14 16 42 16 70a26 6 0 0 1-52 0z"
				fill="url(#mn-saint)"
			/>
			<path d="M53 128h14l3 68H50z" fill="#f3e4c4" opacity="0.5" />
			<path d="M53 128l-3 68M67 128l3 68" stroke="#7a5a1c" stroke-width="1" opacity="0.6" />
			<path d="M86 196c0-28-8-56-16-70" fill="none" stroke="#fff3c9" stroke-opacity="0.65" />
			<path d="M40 158c14 6 26 6 40 0" fill="none" stroke="#7a3b2a" stroke-width="3" />
			<circle cx="60" cy="108" r="13" fill="url(#mn-bone)" />
			<path d="M46 107a14 14 0 0 1 28 0c-3-5-8-7-14-7s-11 2-14 7z" fill="url(#mn-saint-dk)" />
			<ellipse
				cx="60"
				cy="88"
				rx="18"
				ry="5"
				fill="none"
				stroke="#ffd37a"
				stroke-width="2.6"
				opacity="0.5"
				filter="url(#mn-bloom)"
			/>
			<ellipse cx="60" cy="88" rx="18" ry="5" fill="none" stroke="#f6d589" stroke-width="2" />
			<rect x="88" y="112" width="4" height="60" rx="1.6" fill="url(#mn-staff)" />
			<circle cx="90" cy="106" r="9" fill="url(#mn-brass)" />
			<path
				d="M90 94v-4M90 118v4M80 106h-4M100 106h4M83 99l-3-3M97 99l3-3M83 113l-3 3M97 113l3 3"
				stroke="#8a5a1f"
				stroke-width="2.2"
				stroke-linecap="round"
			/>
			<circle cx="90" cy="156" r="4.6" fill="url(#mn-bone)" />
		</symbol>
	</defs>
</svg>

<div class="minis" aria-hidden="true">
	<div class="pair left">
		<svg class="mini back" viewBox="0 0 120 220" focusable="false"><use href="#mn-fig-ember" /></svg
		>
		<svg class="mini front" viewBox="0 0 120 220" focusable="false"
			><use href="#mn-fig-warden" /></svg
		>
	</div>
	<div class="pair right">
		<svg class="mini back" viewBox="0 0 120 220" focusable="false"><use href="#mn-fig-veil" /></svg>
		<svg class="mini front" viewBox="0 0 120 220" focusable="false"
			><use href="#mn-fig-saint" /></svg
		>
	</div>
</div>

<style>
	.sheet {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	/* Beside the menu, not behind it: only where the margins are wide enough to hold a pair. */
	.minis {
		display: none;
	}

	@media (min-width: 83rem) {
		.minis {
			display: block;
		}

		.pair {
			position: absolute;
			bottom: 3vh;
			display: flex;
			align-items: flex-end;
			width: min(calc((100vw - 62rem) / 2 - 0.75rem), 24rem);
			filter: drop-shadow(0 0 20px rgba(255, 154, 77, 0.2));
		}

		.left {
			left: 1vw;
		}

		.right {
			right: 1vw;
			transform: scaleX(-1);
		}

		.mini {
			display: block;
			flex: 1 1 0;
			min-width: 0;
			height: auto;
			overflow: visible;
		}

		.back {
			margin-right: -12%;
			margin-bottom: 3%;
			flex-basis: 0;
			transform: scale(0.88);
			transform-origin: 50% 100%;
			opacity: 0.94;
		}
	}
</style>
