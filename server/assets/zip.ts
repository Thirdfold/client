// A zip reader for the CC0 packs (docs/ASSETS.md "CC0 packs (milestone 76)"): the central
// directory and the stored or deflated members, in memory, on node:zlib alone. The pack's SHA-256 is
// pinned before this ever sees its bytes, so there is no CRC check; encryption, multi-disk
// archives and zip64 (members or archives of 4 GB) are refused rather than half read.

import { inflateRawSync } from 'node:zlib';

/** What one member may inflate to: a pack's biggest texture is 8 MB, and a bomb is not a pack. */
const MAX_MEMBER = 256 * 1024 * 1024;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export interface Zip {
	/** Every file's path in the archive (directories left out). */
	names(): string[];
	has(name: string): boolean;
	/** A member's bytes; throws on a name the archive doesn't hold. */
	read(name: string): Uint8Array;
}

interface Member {
	method: number;
	size: number;
	packed: number;
	offset: number;
}

export function openZip(data: Uint8Array): Zip {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let end = -1;
	for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === EOCD) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error('not a zip: no end-of-archive record');
	const count = view.getUint16(end + 10, true);
	const size = view.getUint32(end + 12, true);
	let at = view.getUint32(end + 16, true);
	if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) throw new Error('zip64');
	const members = new Map<string, Member>();
	for (let n = 0; n < count; n++) {
		if (view.getUint32(at, true) !== CENTRAL) throw new Error('broken zip directory');
		const flags = view.getUint16(at + 8, true);
		const nameLength = view.getUint16(at + 28, true);
		const m: Member = {
			method: view.getUint16(at + 10, true),
			packed: view.getUint32(at + 20, true),
			size: view.getUint32(at + 24, true),
			offset: view.getUint32(at + 42, true)
		};
		if (flags & 1) throw new Error('encrypted zip');
		if ([m.packed, m.size, m.offset].includes(0xffffffff)) throw new Error('zip64');
		const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
		if (!name.endsWith('/')) members.set(name, m);
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
	}
	return {
		names: () => [...members.keys()],
		has: (name) => members.has(name),
		read(name) {
			const m = members.get(name);
			if (!m) throw new Error(`"${name}" is not in the zip`);
			if (m.size > MAX_MEMBER) throw new Error(`"${name}" is larger than ${MAX_MEMBER} bytes`);
			if (view.getUint32(m.offset, true) !== LOCAL) throw new Error('broken zip member');
			const start =
				m.offset + 30 + view.getUint16(m.offset + 26, true) + view.getUint16(m.offset + 28, true);
			const packed = data.subarray(start, start + m.packed);
			if (m.method === 0) return packed;
			if (m.method !== 8) throw new Error(`zip method ${m.method} is not supported`);
			const out = inflateRawSync(packed, { maxOutputLength: MAX_MEMBER });
			if (out.length !== m.size) throw new Error(`"${name}" inflates to the wrong size`);
			return out;
		}
	};
}
