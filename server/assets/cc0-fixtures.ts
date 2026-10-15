// Small stand-ins for a CC0 pack in the specs (cc0.spec.ts, pose-bake.spec.ts): a zip written by
// hand, and glTF documents built in memory (a skinned strip with a bending clip; props of several
// nodes and materials). Not a spec itself.

import { Document, type Material, type Node } from '@gltf-transform/core';
import { deflateRawSync } from 'node:zlib';

/** A zip of `files` (path → bytes): the first deflated, the rest stored, so both methods are read. */
export function zipOf(files: Record<string, Uint8Array>): Uint8Array {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	Object.entries(files).forEach(([name, data], n) => {
		const deflated = n % 2 === 0;
		const packed = deflated ? deflateRawSync(data) : Buffer.from(data);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(deflated ? 8 : 0, 8);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(deflated ? 8 : 0, 10);
		entry.writeUInt32LE(packed.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(nameBytes.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, nameBytes);
		parts.push(local, nameBytes, packed);
		offset += 30 + nameBytes.length + packed.length;
	});
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, directory, end]);
}

/** A cuboid's triangles (12) around `at`, `size` wide: positions, normals and UVs running to `tile`. */
export function boxArrays(at: [number, number, number], size: [number, number, number], tile = 1) {
	const position: number[] = [];
	const normal: number[] = [];
	const uv: number[] = [];
	const index: number[] = [];
	const faces: [number[], number[]][] = [
		[
			[0, 0, 1],
			[0, 1, 0]
		],
		[
			[0, 0, -1],
			[0, 1, 0]
		],
		[
			[1, 0, 0],
			[0, 1, 0]
		],
		[
			[-1, 0, 0],
			[0, 1, 0]
		],
		[
			[0, 1, 0],
			[1, 0, 0]
		],
		[
			[0, -1, 0],
			[1, 0, 0]
		]
	];
	for (const [n, up] of faces) {
		const side = [
			n[1] * up[2] - n[2] * up[1],
			n[2] * up[0] - n[0] * up[2],
			n[0] * up[1] - n[1] * up[0]
		];
		const base = position.length / 3;
		for (const [u, v] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1]
		]) {
			for (let a = 0; a < 3; a++) {
				position.push(at[a] + (size[a] / 2) * (n[a] + u * side[a] + v * up[a]));
			}
			normal.push(...n);
			uv.push(((u + 1) / 2) * tile, ((v + 1) / 2) * tile);
		}
		index.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	return { position, normal, uv, index };
}

/** A node holding a box of `material`, under `parent` or the scene. */
export function boxNode(
	doc: Document,
	name: string,
	material: Material,
	at: [number, number, number],
	size: [number, number, number],
	options: { tile?: number; parent?: Node } = {}
): Node {
	const box = boxArrays([0, 0, 0], size, options.tile);
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint16Array) =>
		doc.createAccessor(undefined, buffer).setType(type).setArray(array);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor('VEC3', new Float32Array(box.position)))
		.setAttribute('NORMAL', accessor('VEC3', new Float32Array(box.normal)))
		.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(box.uv)))
		.setIndices(accessor('SCALAR', new Uint16Array(box.index)))
		.setMaterial(material);
	const node = doc.createNode(name).setMesh(doc.createMesh(`${name}.mesh`).addPrimitive(prim));
	node.setTranslation(at);
	if (options.parent) options.parent.addChild(node);
	else (doc.getRoot().listScenes()[0] ?? doc.createScene()).addChild(node);
	return node;
}

/**
 * A strip skinned to two joints, `Hip` at the origin and `Knee` a unit above it, bent by the clip
 * `Bend` (the knee turns 90° about z by t = 1): vertices at y 0, 1, 2 (x ±0.5), the lowest weighted
 * to the hip, the others to the knee. A `Sword` box hangs from the knee, unskinned.
 */
export function skinnedStrip(): Document {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const accessor = (
		type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
		array: Float32Array | Uint16Array
	) => doc.createAccessor(undefined, buffer).setType(type).setArray(array);
	const scene = doc.createScene();
	const hip = doc.createNode('Hip');
	const knee = doc.createNode('Knee').setTranslation([0, 1, 0]);
	hip.addChild(knee);
	scene.addChild(hip);
	const rows = [0, 1, 2];
	const position = rows.flatMap((y) => [-0.5, y, 0, 0.5, y, 0]);
	const joints = rows.flatMap((y) =>
		y === 0 ? [0, 0, 0, 0, 0, 0, 0, 0] : [1, 0, 0, 0, 1, 0, 0, 0]
	);
	const weights = rows.flatMap(() => [1, 0, 0, 0, 1, 0, 0, 0]);
	const index = [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4];
	const material = doc.createMaterial('Cloth');
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor('VEC3', new Float32Array(position)))
		.setAttribute(
			'NORMAL',
			accessor('VEC3', new Float32Array(rows.flatMap(() => [0, 0, 1, 0, 0, 1])))
		)
		.setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(joints)))
		.setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(weights)))
		.setIndices(accessor('SCALAR', new Uint16Array(index)))
		.setMaterial(material);
	// Column-major inverse binds: the hip's identity, the knee's moves it down a unit.
	const knees = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]);
	const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const skin = doc
		.createSkin('Rig')
		.addJoint(hip)
		.addJoint(knee)
		.setInverseBindMatrices(accessor('MAT4', new Float32Array([...identity, ...knees])));
	const body = doc
		.createNode('Body')
		.setMesh(doc.createMesh('Body').addPrimitive(prim))
		.setSkin(skin);
	scene.addChild(body);
	boxNode(doc, 'Sword', material, [0, 0.5, 0], [0.1, 1, 0.1], { parent: knee });
	// Bend: the knee's rotation about z, 0 at t = 0 and 90° at t = 1.
	const s = Math.SQRT1_2;
	const bend = doc.createAnimation('Bend');
	const sampler = doc
		.createAnimationSampler()
		.setInput(accessor('SCALAR', new Float32Array([0, 1])))
		.setOutput(accessor('VEC4', new Float32Array([0, 0, 0, 1, 0, 0, s, s])))
		.setInterpolation('LINEAR');
	bend
		.addSampler(sampler)
		.addChannel(
			doc.createAnimationChannel().setTargetNode(knee).setTargetPath('rotation').setSampler(sampler)
		);
	return doc;
}

/** A GLB of glTF `json` whose one buffer is `bin` (its uri dropped). */
export function glbOf(json: { buffers: { uri?: string }[] }, bin: Uint8Array): Uint8Array {
	delete json.buffers[0].uri;
	const pad = (b: Buffer, fill: number) =>
		Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
	const [j, b] = [pad(Buffer.from(JSON.stringify(json)), 0x20), pad(Buffer.from(bin), 0)];
	const header = Buffer.alloc(12);
	header.write('glTF', 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
	const chunk = (type: string, data: Buffer) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(data.length, 0);
		h.write(type, 4, 'latin1');
		return Buffer.concat([h, data]);
	};
	return Buffer.concat([header, chunk('JSON', j), chunk('BIN\0', b)]);
}
