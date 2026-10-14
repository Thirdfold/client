// Wet and snow on a lit kind's colour, roughness and normal (#321): the place kinds.ts asks, and
// cover.ts (the lazy `vfx` chunk) fills in when it loads. Until then, and for a graph built
// before it, every term is the identity.

import type { ShaderKind, Variant } from './kinds';
import type { N } from './tsl';

export interface Covers {
	colour: (c: N) => N;
	rough: (r: N) => N;
	normal: (n: N) => N;
}

const same: Covers = { colour: (x) => x, rough: (x) => x, normal: (x) => x };

/** `metal`: the fragment's metalness, which wet and snow leave alone. */
export const covers: { of: (kind: ShaderKind, variant: Variant, metal: N) => Covers } = {
	of: () => same
};
