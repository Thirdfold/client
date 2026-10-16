<script lang="ts">
	/**
	 * The scenery behind the screens that are not the table: a lit room you stand in, not a page you
	 * scroll. Pure CSS and a little SVG; drifting embers, a lamp's pool of light, grain, a vignette.
	 *
	 * title: the table at night, a lamp over it, four painted miniatures waiting at its edge.
	 * hall: the library's panelled wall under lamplight.
	 * workshop: the builder's drafting bench, colder and flatter so the work stands out.
	 */
	interface Props {
		variant?: 'title' | 'hall' | 'workshop';
		/** Fewer or no particles (the builder wants calm). */
		embers?: number;
	}
	let { variant = 'title', embers = variant === 'workshop' ? 0 : 22 }: Props = $props();

	// Deterministic scatter: the same room every time, no per-render randomness (and no hydration drift).
	function rng(seed: number) {
		return () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	const motes = $derived.by(() => {
		const r = rng(variant === 'title' ? 7 : variant === 'hall' ? 19 : 31);
		return Array.from({ length: embers }, () => ({
			x: Math.round(r() * 100),
			size: 2 + Math.round(r() * 3),
			dur: 9 + Math.round(r() * 12),
			delay: -Math.round(r() * 20),
			sway: Math.round((r() - 0.5) * 80)
		}));
	});
</script>

<div class="backdrop {variant}" aria-hidden="true">
	{#if variant === 'title'}
		<div class="stars"></div>
		<div class="lamp"></div>
		<div class="table">
			<div class="cloth"></div>
			<div class="pool"></div>
		</div>
		<!-- Loaded on the title only: the other screens do not pay for the drawings. -->
		{#await import('./Miniatures.svelte') then { default: Miniatures }}
			<Miniatures />
		{/await}
	{:else if variant === 'hall'}
		<div class="planks"></div>
		<div class="lamp hall-lamp"></div>
	{:else}
		<div class="bench"></div>
	{/if}

	{#each motes as m, i (i)}
		<span
			class="ember"
			style:left="{m.x}%"
			style:--s="{m.size}px"
			style:--d="{m.dur}s"
			style:--delay="{m.delay}s"
			style:--sway="{m.sway}px"
		></span>
	{/each}
	<div class="grain"></div>
	<div class="vignette"></div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--bg);
	}

	/* ---- title ---- */
	.title {
		background:
			radial-gradient(120% 70% at 50% 108%, rgba(255, 154, 77, 0.28), transparent 60%),
			linear-gradient(180deg, #080504 0%, #130d09 55%, #1c120b 100%);
	}
	.stars {
		position: absolute;
		inset: 0 0 45%;
		background-image:
			radial-gradient(1.2px 1.2px at 12% 18%, rgba(255, 236, 200, 0.8), transparent 60%),
			radial-gradient(1px 1px at 27% 9%, rgba(255, 236, 200, 0.6), transparent 60%),
			radial-gradient(1.4px 1.4px at 41% 24%, rgba(255, 236, 200, 0.7), transparent 60%),
			radial-gradient(1px 1px at 58% 12%, rgba(255, 236, 200, 0.55), transparent 60%),
			radial-gradient(1.3px 1.3px at 73% 21%, rgba(255, 236, 200, 0.75), transparent 60%),
			radial-gradient(1px 1px at 88% 8%, rgba(255, 236, 200, 0.6), transparent 60%),
			radial-gradient(1px 1px at 94% 29%, rgba(255, 236, 200, 0.5), transparent 60%),
			radial-gradient(1.2px 1.2px at 5% 36%, rgba(255, 236, 200, 0.5), transparent 60%);
		animation: twinkle 7s ease-in-out infinite;
	}
	.lamp {
		position: absolute;
		left: 50%;
		top: -10%;
		width: 90vmin;
		height: 90vmin;
		translate: -50% 0;
		background: radial-gradient(
			closest-side,
			rgba(255, 190, 110, 0.32),
			rgba(255, 154, 77, 0.1) 45%,
			transparent 72%
		);
		animation: flicker 5s ease-in-out infinite;
	}
	.table {
		position: absolute;
		left: -20%;
		right: -20%;
		bottom: -6%;
		height: 46%;
		perspective: 700px;
	}
	.cloth {
		position: absolute;
		inset: 0;
		transform: rotateX(62deg);
		transform-origin: 50% 100%;
		background:
			linear-gradient(rgba(240, 212, 158, 0.14) 1px, transparent 1px) 0 0 / 64px 64px,
			linear-gradient(90deg, rgba(240, 212, 158, 0.14) 1px, transparent 1px) 0 0 / 64px 64px,
			linear-gradient(180deg, #1a110b, #2a1b10);
		mask-image: linear-gradient(180deg, transparent, #000 40%);
	}
	.pool {
		position: absolute;
		left: 50%;
		bottom: 8%;
		width: 70%;
		height: 60%;
		translate: -50% 0;
		background: radial-gradient(closest-side, rgba(255, 190, 110, 0.42), transparent 72%);
		mix-blend-mode: screen;
	}

	/* ---- hall ---- */
	.hall {
		background: linear-gradient(180deg, #0c0806, #150e09);
	}
	.planks {
		position: absolute;
		inset: 0;
		background:
			repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0 2px, transparent 2px 148px),
			repeating-linear-gradient(90deg, rgba(255, 220, 160, 0.035) 0 74px, transparent 74px 148px),
			linear-gradient(180deg, #1c130d, #130d09);
	}
	.hall-lamp {
		top: -30%;
	}

	/* ---- workshop ---- */
	.workshop {
		background: #12100f;
	}
	.bench {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(rgba(214, 200, 184, 0.05) 1px, transparent 1px) 0 0 / 32px 32px,
			linear-gradient(90deg, rgba(214, 200, 184, 0.05) 1px, transparent 1px) 0 0 / 32px 32px,
			linear-gradient(rgba(214, 200, 184, 0.09) 1px, transparent 1px) 0 0 / 160px 160px,
			linear-gradient(90deg, rgba(214, 200, 184, 0.09) 1px, transparent 1px) 0 0 / 160px 160px,
			radial-gradient(90% 60% at 50% 0%, rgba(255, 190, 110, 0.07), transparent 70%),
			#12100f;
	}

	/* ---- shared ---- */
	.ember {
		position: absolute;
		bottom: -12px;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		background: radial-gradient(circle, #ffd9a0, #ff9a4d 55%, transparent 70%);
		box-shadow: 0 0 8px 2px rgba(255, 154, 77, 0.55);
		opacity: 0;
		animation: rise var(--d) linear var(--delay) infinite;
	}
	.grain {
		position: absolute;
		inset: 0;
		background: var(--grain) 0 0 / 180px;
		opacity: 0.16;
		mix-blend-mode: soft-light;
	}
	.vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(120% 100% at 50% 40%, transparent 55%, rgba(0, 0, 0, 0.65));
	}

	@keyframes rise {
		0% {
			transform: translate(0, 0) scale(1);
			opacity: 0;
		}
		10% {
			opacity: 0.9;
		}
		80% {
			opacity: 0.5;
		}
		100% {
			transform: translate(var(--sway), -105vh) scale(0.4);
			opacity: 0;
		}
	}
	@keyframes twinkle {
		50% {
			opacity: 0.55;
		}
	}
	@keyframes flicker {
		0%,
		100% {
			opacity: 1;
		}
		30% {
			opacity: 0.88;
		}
		55% {
			opacity: 1;
		}
		75% {
			opacity: 0.92;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ember {
			animation: none;
			opacity: 0.35;
			bottom: calc(var(--sway) + 50%);
		}
		.stars,
		.lamp {
			animation: none;
		}
	}
</style>
