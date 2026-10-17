<script lang="ts">
	import '../app.css';
	// The modern skin over app.css; delete this line to return to the classic look.
	import '../skin-modern.css';
	// The game skin over both: plates, frames, parchment and light. Delete this line to return to
	// the flat modern look.
	import '../skin-game.css';
	import favicon from '$lib/assets/favicon.svg';
	import { play, setMix, unlock } from '$lib/audio/engine';
	import { loadMix } from '$lib/audio/mix';
	import { guardStorage } from '$lib/storage';
	import { onNavigate } from '$app/navigation';

	let { children } = $props();

	guardStorage();
	setMix(loadMix(localStorage));

	// Browsers only let a page make sound once someone has interacted with it.
	function wake() {
		unlock();
	}

	// Leaving the front page for a table folds the board shut and opens the room beneath it
	// (the keyframes are in app.css). Browsers without view transitions just navigate.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (navigation.from?.route.id !== '/' || navigation.to?.route.id !== '/room/[id]') return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	/**
	 * The interface has a voice: a brass key turning for a primary choice, a wooden tick for the
	 * rest, and a hair of a sound as the pointer arrives on a live control.
	 */
	function click(event: MouseEvent) {
		const button = (event.target as HTMLElement | null)?.closest('button:not(:disabled)');
		if (!button) return;
		const primary = button.classList.contains('primary');
		play([{ kind: 'ui', sound: primary ? 'confirm' : 'click' }]);
	}

	let lastHover: Element | null = null;
	let lastHoverAt = 0;
	function hover(event: PointerEvent) {
		if (event.pointerType !== 'mouse') return;
		const button = (event.target as HTMLElement | null)?.closest('button:not(:disabled)') ?? null;
		const now = performance.now();
		if (!button || button === lastHover || now - lastHoverAt < 70) {
			lastHover = button;
			return;
		}
		lastHover = button;
		lastHoverAt = now;
		play([{ kind: 'ui', sound: 'hover' }]);
	}
</script>

<svelte:window onpointerdown={wake} onkeydown={wake} onclick={click} onpointerover={hover} />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>thirdfold</title>
</svelte:head>

{@render children()}
