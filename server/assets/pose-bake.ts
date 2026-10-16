// A static pose out of a skinned glTF (M76, #330, docs/ASSETS.md "CC0 packs (milestone 76)"):
// the nodes' world matrices with one animation clip sampled at one time over their own transforms
// (no clip: the nodes as they stand, the bind pose), and each primitive's vertices carried to
// world space by them, skinned by joints and weights when its node has a skin. The result is plain
// positions and normals; the caller drops skins, animations and bones. Pure: nothing in the
// document changes. A clip is sampled linearly (STEP held; a cubic spline reads its keyframe
// values, tangents ignored), which is exact for the one-keyframe pose clips figure packs ship.

import type { Animation, AnimationSampler, Document, Node, Primitive } from '@gltf-transform/core';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

export interface Pose {
	/** An animation's name; none is the nodes' own transforms. */
	clip?: string;
	/** Seconds into the clip (0 by default). */
	time?: number;
}

/** A sampler's value (`size` numbers) at time `t`. */
function sample(s: AnimationSampler, t: number, size: number): number[] {
	const times = s.getInput()!.getArray()!;
	const out = s.getOutput()!.getArray()!;
	const cubic = s.getInterpolation() === 'CUBICSPLINE';
	const at = (i: number) => {
		const from = (cubic ? i * 3 + 1 : i) * size;
		return Array.from({ length: size }, (_, k) => out[from + k]);
	};
	const last = times.length - 1;
	if (t <= times[0] || last === 0) return at(0);
	if (t >= times[last]) return at(last);
	let i = 0;
	while (times[i + 1] <= t) i++;
	if (s.getInterpolation() === 'STEP') return at(i);
	const k = (t - times[i]) / (times[i + 1] - times[i]);
	const [a, b] = [at(i), at(i + 1)];
	if (size === 4) {
		const q = new Quaternion(...(a as [number, number, number, number])).slerp(
			new Quaternion(...(b as [number, number, number, number])),
			k
		);
		return [q.x, q.y, q.z, q.w];
	}
	return a.map((v, c) => v + (b[c] - v) * k);
}

/** Every node's world matrix at `pose`. */
export function poseWorlds(doc: Document, pose: Pose = {}): Map<Node, Matrix4> {
	const clip: Animation | undefined = pose.clip
		? doc
				.getRoot()
				.listAnimations()
				.find((a) => a.getName() === pose.clip)
		: undefined;
	if (pose.clip && !clip) throw new Error(`no animation named "${pose.clip}"`);
	const t = new Map<Node, number[]>();
	const r = new Map<Node, number[]>();
	const s = new Map<Node, number[]>();
	for (const c of clip?.listChannels() ?? []) {
		const node = c.getTargetNode();
		const path = c.getTargetPath();
		const sampler = c.getSampler();
		if (!node || !sampler) continue;
		const time = pose.time ?? 0;
		if (path === 'translation') t.set(node, sample(sampler, time, 3));
		else if (path === 'rotation') r.set(node, sample(sampler, time, 4));
		else if (path === 'scale') s.set(node, sample(sampler, time, 3));
	}
	const local = (n: Node) =>
		new Matrix4().compose(
			new Vector3(...((t.get(n) ?? n.getTranslation()) as [number, number, number])),
			new Quaternion(...((r.get(n) ?? n.getRotation()) as [number, number, number, number])),
			new Vector3(...((s.get(n) ?? n.getScale()) as [number, number, number]))
		);
	const worlds = new Map<Node, Matrix4>();
	const world = (n: Node): Matrix4 => {
		let m = worlds.get(n);
		if (!m) {
			const parent = n.getParentNode();
			m = parent ? world(parent).clone().multiply(local(n)) : local(n);
			worlds.set(n, m);
		}
		return m;
	};
	for (const n of doc.getRoot().listNodes()) world(n);
	return worlds;
}

export interface Baked {
	position: Float32Array;
	/** Null when the primitive has no normals. */
	normal: Float32Array | null;
}

/**
 * `prim`, hung on `node`, in world space at `worlds`' pose: carried by the node's matrix, or, when
 * the node has a skin, by the weighted joint matrices (the node's own transform is then ignored,
 * as glTF says).
 */
export function bakePrimitive(node: Node, prim: Primitive, worlds: Map<Node, Matrix4>): Baked {
	const pos = prim.getAttribute('POSITION')!;
	const nor = prim.getAttribute('NORMAL');
	const count = pos.getCount();
	const skin = node.getSkin();
	const joints: Matrix4[] = [];
	if (skin) {
		const ibm = skin.getInverseBindMatrices();
		const raw = new Array<number>(16);
		skin.listJoints().forEach((j, i) => {
			const inverse = new Matrix4();
			if (ibm) inverse.fromArray(ibm.getElement(i, raw));
			joints.push(worlds.get(j)!.clone().multiply(inverse));
		});
	}
	const sets: number[] = [];
	for (let k = 0; prim.getAttribute(`JOINTS_${k}`) && prim.getAttribute(`WEIGHTS_${k}`); k++) {
		sets.push(k);
	}
	const base = worlds.get(node)!;
	const position = new Float32Array(count * 3);
	const normal = nor ? new Float32Array(count * 3) : null;
	const [p, n] = [new Vector3(), new Vector3()];
	const blend = new Matrix4();
	const normalMatrix = new Matrix3();
	const [vj, vw, el] = [
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0]
	];
	for (let v = 0; v < count; v++) {
		pos.getElement(v, el);
		p.set(el[0], el[1], el[2]);
		if (nor) {
			nor.getElement(v, el);
			n.set(el[0], el[1], el[2]);
		}
		let m = base;
		if (skin && sets.length) {
			const e = blend.elements;
			e.fill(0);
			let sum = 0;
			for (const js of sets) {
				prim.getAttribute(`JOINTS_${js}`)!.getElement(v, vj);
				prim.getAttribute(`WEIGHTS_${js}`)!.getElement(v, vw);
				for (let c = 0; c < 4; c++) {
					if (!vw[c]) continue;
					const j = joints[vj[c]].elements;
					for (let i = 0; i < 16; i++) e[i] += j[i] * vw[c];
					sum += vw[c];
				}
			}
			if (sum > 0) {
				for (let i = 0; i < 16; i++) e[i] /= sum;
				m = blend;
			}
		}
		p.applyMatrix4(m);
		position.set([p.x, p.y, p.z], v * 3);
		if (normal) {
			normalMatrix.getNormalMatrix(m);
			n.applyMatrix3(normalMatrix).normalize();
			normal.set([n.x, n.y, n.z], v * 3);
		}
	}
	return { position, normal };
}
