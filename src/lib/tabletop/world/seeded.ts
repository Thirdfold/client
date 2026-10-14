// Seeded randomness (pure, no imports): the renderer chunk's dice (dice-faces.ts) and the world
// chunk's seeded layers (hash.ts re-exports it) share it, apart from `keyHash`, which only the world
// chunk needs, so the renderer chunk carries this alone (M74, its 424.4 kB cap).

/** Small seeded PRNG (mulberry32): uniform numbers in [0, 1), the same sequence for a seed. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
