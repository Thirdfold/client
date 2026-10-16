import { describe, expect, it } from 'vitest';
import { skinnedStrip } from './cc0-fixtures';
import { bakePrimitive, poseWorlds } from './pose-bake';

const near = (a: ArrayLike<number>, b: number[]) => {
	expect(a.length).toBe(b.length);
	b.forEach((v, i) => expect(a[i]).toBeCloseTo(v, 4));
};

describe('baking a pose out of a skinned glTF (M76, #330)', () => {
	const doc = skinnedStrip();
	const nodes = Object.fromEntries(
		doc
			.getRoot()
			.listNodes()
			.map((n) => [n.getName(), n])
	);
	const body = nodes.Body;
	const prim = body.getMesh()!.listPrimitives()[0];

	it('carries the bind pose to world space unchanged', () => {
		const { position, normal } = bakePrimitive(body, prim, poseWorlds(doc));
		near(position, [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0, -0.5, 2, 0, 0.5, 2, 0]);
		near(normal!, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
	});

	it('bends the knee by a clip at a time: joints times weights times inverse binds', () => {
		const { position, normal } = bakePrimitive(
			body,
			prim,
			poseWorlds(doc, { clip: 'Bend', time: 1 })
		);
		// The hip's row stays; the knee's turn a quarter about z through (0, 1, 0).
		near(position, [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 1.5, 0, -1, 0.5, 0, -1, 1.5, 0]);
		near(normal!, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
		// Halfway, an eighth of a turn; a time past the clip holds its last key.
		const half = bakePrimitive(body, prim, poseWorlds(doc, { clip: 'Bend', time: 0.5 }));
		near(half.position.subarray(15, 18), [
			0.5 * Math.SQRT1_2 - Math.SQRT1_2,
			0.5 * Math.SQRT1_2 + Math.SQRT1_2 + 1,
			0
		]);
		const late = bakePrimitive(body, prim, poseWorlds(doc, { clip: 'Bend', time: 9 }));
		near(late.position, Array.from(position));
	});

	it('carries what hangs from a bone with it, skin or none', () => {
		const sword = nodes.Sword.getMesh()!.listPrimitives()[0];
		const bent = bakePrimitive(nodes.Sword, sword, poseWorlds(doc, { clip: 'Bend', time: 1 }));
		const sum = [0, 0, 0];
		for (let i = 0; i < bent.position.length; i++) sum[i % 3] += bent.position[i];
		const n = bent.position.length / 3;
		near(
			sum.map((v) => v / n),
			[-0.5, 1, 0]
		);
	});

	it('changes nothing in the document and refuses a clip it does not have', () => {
		poseWorlds(doc, { clip: 'Bend', time: 1 });
		expect(nodes.Knee.getRotation()).toEqual([0, 0, 0, 1]);
		expect(() => poseWorlds(doc, { clip: 'Dance' })).toThrow('no animation named "Dance"');
	});
});
