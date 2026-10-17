<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { play } from '$lib/audio/engine';
	import { loadManifest } from '$lib/assets/load';
	import type { Credit, Manifest } from '$lib/assets/manifest';
	import { SHIPPED, SRD_ATTRIBUTION, type Shipped } from '$lib/credits';
	import { Backdrop, Banner, Frame, Icon } from '$lib/ui/game';
	import Glyph from '$lib/ui/library/Glyph.svelte';

	// Everything here comes from the asset manifest (each file's credit, #189)
	// and the hand list of shipped code and fonts in $lib/credits.

	const LICENSE_NAMES: Record<Credit['license'], string> = {
		'CC0-1.0': 'CC0 1.0 (public domain)',
		'CC-BY-4.0': 'CC BY 4.0',
		'LicenseRef-thirdfold-commissioned': 'Commissioned for thirdfold',
		'LicenseRef-thirdfold-original': 'thirdfold originals'
	};

	interface Row {
		name: string;
		credit: Credit;
	}

	let manifest = $state<Manifest | null>(null);
	loadManifest().then((m) => (manifest = m));

	/** Every file's credit, named by its asset id. */
	const rows = $derived.by((): Row[] => {
		if (!manifest) return [];
		const out: Row[] = [];
		for (const [id, m] of Object.entries(manifest.models)) out.push({ name: id, credit: m.credit });
		for (const [id, t] of Object.entries(manifest.textures)) {
			if (!id.startsWith('grade-')) out.push({ name: id, credit: t.credit });
		}
		for (const [id, a] of Object.entries(manifest.audio)) out.push({ name: id, credit: a.credit });
		return out;
	});
	const originals = $derived(
		rows.filter((r) => r.credit.license === 'LicenseRef-thirdfold-original').length
	);
	/** Other licences, then author, each with the assets they cover. */
	const groups = $derived.by(() => {
		const out: { license: Credit['license']; authors: { author: string; items: Row[] }[] }[] = [];
		for (const r of rows) {
			const { license, author } = r.credit;
			if (license === 'LicenseRef-thirdfold-original') continue;
			let g = out.find((g) => g.license === license);
			if (!g) out.push((g = { license, authors: [] }));
			let a = g.authors.find((a) => a.author === author);
			if (!a) g.authors.push((a = { author, items: [] }));
			a.items.push(r);
		}
		return out;
	});
	const assisted = $derived(rows.filter((r) => r.credit.ai));
	const ofKind = (kind: Shipped['kind']) => SHIPPED.filter((s) => s.kind === kind);

	// ---- The roll ----
	// The credits are a real scrolling region (so the keyboard, the wheel and a thumb all work and
	// every link stays reachable); a frame loop eases it upward. It rests while the pointer is over
	// it, while anything in it has focus, for a moment after someone scrolls it, and whenever the
	// reader pauses it. Under reduced motion it never moves: it is simply a page to read.
	const SPEED = 34; // pixels a second: slow enough to read

	let roll = $state<HTMLElement | null>(null);
	let paused = $state(false);
	let hovering = $state(false);
	let focused = $state(false);
	let reduced = $state(false);
	let atEnd = $state(false);

	$effect(() => {
		const query = matchMedia('(prefers-reduced-motion: reduce)');
		reduced = query.matches;
		const change = () => (reduced = query.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	});

	$effect(() => {
		const el = roll;
		if (!el || reduced) return;
		let raf = 0;
		let last = performance.now();
		let pos = el.scrollTop;
		let quietUntil = last + 1600;
		const touched = () => (quietUntil = performance.now() + 2600);
		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			const dt = Math.min(64, now - last) / 1000;
			last = now;
			const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
			atEnd = manifest !== null && end;
			if (paused || hovering || focused || now < quietUntil || atEnd) {
				pos = el.scrollTop;
				return;
			}
			// Someone moved it (the scroll position is whole pixels; ours is not).
			if (Math.abs(el.scrollTop - pos) > 1.5) pos = el.scrollTop;
			pos += SPEED * dt;
			el.scrollTop = pos;
		};
		raf = requestAnimationFrame(frame);
		el.addEventListener('wheel', touched, { passive: true });
		el.addEventListener('touchstart', touched, { passive: true });
		el.addEventListener('touchmove', touched, { passive: true });
		el.addEventListener('keydown', touched);
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener('wheel', touched);
			el.removeEventListener('touchstart', touched);
			el.removeEventListener('touchmove', touched);
			el.removeEventListener('keydown', touched);
		};
	});

	function rollAgain() {
		atEnd = false;
		roll?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
		play([{ kind: 'ui', sound: 'open' }]);
	}

	function goBack() {
		play([{ kind: 'ui', sound: 'back' }]);
		void goto(resolve('/'));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		goBack();
	}
</script>

<svelte:head>
	<title>Credits · thirdfold</title>
</svelte:head>

<svelte:window {onkeydown} />

{#snippet shipped(kind: Shipped['kind'], heading: string)}
	<section class="part">
		<Banner level={2}>{heading}</Banner>
		<ul class="entries">
			{#each ofKind(kind) as s (s.name)}
				<li>
					<a class="name" href={s.url} rel="external noopener">{s.name}</a>
					<span class="licence">{s.license}</span>
					{#if s.note}<span class="muted">{s.note}</span>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<Backdrop variant="hall" embers={10} />

<div class="stage">
	<header class="bar">
		<button type="button" class="back" aria-keyshortcuts="Escape" onclick={goBack}>
			<Icon name="back" />Back<span class="visually-hidden"> to the title</span>
			<kbd aria-hidden="true">Esc</kbd>
		</button>
		{#if !reduced}
			<button type="button" class="hold" aria-pressed={paused} onclick={() => (paused = !paused)}>
				{#if paused}<Icon name="play" />Resume{:else}<Glyph name="pause" />Pause{/if}
				<span class="visually-hidden"> the scrolling credits</span>
			</button>
		{/if}
	</header>

	<Frame class="window g-rise">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="roll"
			class:still={reduced}
			bind:this={roll}
			role="region"
			aria-label="Credits"
			tabindex="0"
			onpointerenter={(e) => (hovering = e.pointerType === 'mouse')}
			onpointerleave={() => (hovering = false)}
			onfocusin={() => (focused = true)}
			onfocusout={(e) => {
				if (!roll?.contains(e.relatedTarget as Node | null)) focused = false;
			}}
		>
			<main>
				<span
					class="mark"
					aria-hidden="true"
					style:--mark={`url(${asset('/brand/thirdfold-mark-mono.svg')})`}
				></span>
				<Banner level={1} class="mast">Credits</Banner>
				<p class="lead">Who made what thirdfold is built from, and on what terms.</p>

				<section class="part" aria-busy={manifest === null}>
					<Banner level={2}>Art and sound</Banner>
					{#if !manifest}
						<p class="muted">Reading the asset list…</p>
					{:else}
						<p>{LICENSE_NAMES['LicenseRef-thirdfold-original']}: {originals} assets.</p>
						{#each groups as g (g.license)}
							<h3>{LICENSE_NAMES[g.license]}</h3>
							<ul class="entries">
								{#each g.authors as a (a.author)}
									<li>
										<strong class="author">{a.author}</strong><span class="visually-hidden">:</span>
										<span class="works">
											{#each a.items as item, i (item.name)}
												{#if i > 0},
												{/if}
												{#if item.credit.source}
													<a href={item.credit.source} rel="external noopener">{item.name}</a>
												{:else}
													{item.name}
												{/if}
												{#if item.credit.modified}<span class="muted">(modified)</span>{/if}
											{/each}
										</span>
									</li>
								{/each}
							</ul>
						{/each}
						<h3>AI-assisted assets</h3>
						{#if assisted.length}
							<p>These were made with a generator, then cleaned up and repainted by hand:</p>
							<ul class="entries">
								{#each assisted as r (r.name)}
									<li>{r.name} <span class="muted">({r.credit.ai?.tool})</span></li>
								{/each}
							</ul>
						{:else}
							<p class="muted">None.</p>
						{/if}
					{/if}
				</section>

				{@render shipped('code', 'Code')}
				{@render shipped('font', 'Fonts')}
				{@render shipped('tool', 'Build tools')}

				{#if SRD_ATTRIBUTION}
					<section class="part">
						<Banner level={2}>Rules</Banner>
						<p>{SRD_ATTRIBUTION}</p>
					</section>
				{/if}

				<footer class="end">
					<hr class="g-rule" />
					<p class="sign-off">thirdfold</p>
					<div class="end-actions">
						<button type="button" class="primary" onclick={goBack}
							><Icon name="back" />Back to the title</button
						>
						<button type="button" onclick={rollAgain}><Icon name="refresh" />Read again</button>
					</div>
				</footer>
			</main>
		</div>
		{#if !reduced && (hovering || focused) && !paused}
			<p class="resting" aria-hidden="true">Resting while you read</p>
		{/if}
	</Frame>
</div>

<style>
	/* The page is a fixed stage: a bar above, one framed window below, and the credits roll in it. */
	.stage {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
		height: 100dvh;
		max-width: 46rem;
		margin: 0 auto;
		padding: var(--sp-6) clamp(var(--sp-6), 4vw, var(--sp-8)) var(--sp-7);
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5);
	}

	.back,
	.hold {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		min-height: 2.75rem;
	}

	.back {
		padding-inline: 1rem 0.8rem;
	}

	.back kbd {
		margin-left: 0.2rem;
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		letter-spacing: 0.05em;
	}

	.stage :global(.window) {
		position: relative;
		flex: 1;
		min-height: 0;
		padding: 10px;
		border-radius: 16px;
	}

	/* The roll: dark leather under lamplight, fading at the top and the foot like a curtain. */
	.roll {
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		scroll-padding-block: 22%;
		padding: 46dvh clamp(var(--sp-5), 5vw, var(--sp-8)) 40dvh;
		border-radius: 8px;
		background:
			radial-gradient(80% 40% at 50% 0%, rgba(255, 190, 110, 0.1), transparent 80%),
			var(--grain) 0 0 / 160px,
			linear-gradient(180deg, #170f0a, #0f0a07);
		background-blend-mode: normal, soft-light, normal;
		box-shadow:
			inset 0 0 26px rgba(0, 0, 0, 0.8),
			inset 0 0 0 1px var(--ink-line);
		mask-image: linear-gradient(transparent 0, #000 12%, #000 86%, transparent 100%);
		scrollbar-width: thin;
		text-align: center;
	}

	.roll:focus-visible {
		outline: 2px solid var(--gilt-hi);
		outline-offset: -3px;
	}

	/* No motion: the roll is a page, starting at its top, with nothing fading. */
	.roll.still {
		padding-block: var(--sp-8);
		mask-image: none;
	}

	main {
		display: grid;
		justify-items: center;
		gap: var(--sp-8);
		max-width: 34rem;
		margin: 0 auto;
	}

	.mark {
		width: 5rem;
		aspect-ratio: 5 / 4;
		background: var(--gilt-grad);
		mask: var(--mark) center / contain no-repeat;
		filter: drop-shadow(0 0 14px rgba(224, 164, 88, 0.45));
	}

	main :global(.mast) {
		margin-top: calc(var(--sp-8) * -0.4);
		font-size: 2.2rem;
		padding-inline: 3.6rem;
	}

	.lead {
		margin: calc(var(--sp-7) * -0.5) 0 var(--sp-6);
		max-width: 26rem;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--fs-lg);
		color: var(--muted);
	}

	.part {
		display: grid;
		justify-items: center;
		gap: var(--sp-5);
		width: 100%;
		margin-top: var(--sp-6);
	}

	.part :global(.g-banner) {
		margin-bottom: var(--sp-4);
	}

	.part p {
		margin: 0;
		max-width: 28rem;
	}

	/* A licence heading: small caps between two gilt rules. */
	h3 {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		width: 100%;
		margin: var(--sp-6) 0 0;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.1em;
		line-height: 1.2;
		color: var(--gilt);
	}

	h3::before,
	h3::after {
		content: '';
		flex: 1;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--gilt-line-strong));
	}

	h3::after {
		transform: scaleX(-1);
	}

	.entries {
		display: grid;
		gap: var(--sp-5);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entries li {
		display: grid;
		justify-items: center;
		gap: 0.15rem;
		line-height: 1.4;
	}

	/* Names in small caps; what they made, in the reading face. */
	.author {
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.07em;
		color: var(--text);
	}

	.works {
		color: var(--muted);
	}

	.entries .name {
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: 0.06em;
	}

	.licence {
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--gilt);
	}

	.muted {
		color: var(--muted);
	}

	a:focus-visible {
		border-radius: var(--radius-sm);
		outline: 2px solid var(--gilt-hi);
		outline-offset: 3px;
	}

	.end {
		display: grid;
		justify-items: center;
		gap: var(--sp-6);
		width: 100%;
		margin-top: var(--sp-8);
	}

	.end hr {
		width: 60%;
		margin: 0;
	}

	.sign-off {
		margin: 0;
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		letter-spacing: 0.14em;
		color: var(--gilt-hi);
	}

	.end-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-5);
	}

	.end-actions button {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		min-height: 2.75rem;
	}

	.resting {
		position: absolute;
		left: 50%;
		bottom: 1.2rem;
		translate: -50% 0;
		margin: 0;
		padding: 0.15rem 0.8rem;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: var(--panel-raised);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		font-family: var(--font-label);
		font-size: var(--fs-sm);
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
		pointer-events: none;
	}

	@media (max-width: 48rem) {
		.back kbd {
			display: none;
		}

		.stage {
			padding-top: var(--sp-5);
		}

		main :global(.mast) {
			font-size: 1.8rem;
			padding-inline: 2.8rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.roll {
			scroll-behavior: auto;
		}
	}
</style>
