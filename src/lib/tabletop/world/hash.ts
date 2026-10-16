// The world's shared hashing and seeded randomness (pure, no three.js, so the world chunk and the
// server-project tests import it alike). `keyHash` turns an id into a seed; `seededRandom` turns a
// seed into a generator, so anything derived from a prop's or a roll's id is the same on every
// client. (The wall kits' own `keySeed` in autotile.ts hashes an edge key without building the
// string; it stays apart.)

/** FNV-1a of a string's UTF-16 code units, as an unsigned 32-bit number. */
export function keyHash(key: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

export { seededRandom } from './seeded'; // the dice's too, in the renderer chunk (seeded.ts)
