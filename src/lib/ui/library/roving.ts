// Arrow keys move through the tabs, or the choices of an order, the way a game menu does.
// The group keeps a roving tabindex (one stop in the tab order); this only adds the arrows.

const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];

/** `use:roving={'[role=tab]'}` on the element holding the group. */
export function roving(node: HTMLElement, selector: string) {
	function onkeydown(event: KeyboardEvent) {
		if (!KEYS.includes(event.key)) return;
		const items = [...node.querySelectorAll<HTMLElement>(selector)].filter(
			(el) => !el.hasAttribute('disabled')
		);
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		event.preventDefault();
		const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (at + step + items.length) % items.length;
		items[next].focus();
		items[next].click();
	}
	node.addEventListener('keydown', onkeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onkeydown);
		}
	};
}
