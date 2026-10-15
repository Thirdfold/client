import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { addInstanceTints, PIECE_MIN, TINT_ATTRIBUTE, uploadInstances } from './index';

describe('uploadInstances (#334)', () => {
	it('marks only the instances drawn of a pool, not the whole of it', () => {
		const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, PIECE_MIN);
		const v = mesh.instanceMatrix.version;
		uploadInstances(mesh.instanceMatrix, 3);
		expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 48 }]);
		expect(mesh.instanceMatrix.version).toBe(v + 1);
	});

	it("marks an interleaved view's buffer by its stride, from the first instance asked", () => {
		const geometry = new THREE.BufferGeometry();
		addInstanceTints(geometry, PIECE_MIN);
		const tint = geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InterleavedBufferAttribute;
		uploadInstances(tint, 2, 5);
		expect(tint.data.updateRanges).toEqual([{ start: 45, count: 18 }]); // 9 floats an instance
	});

	it('never marks an empty range, which WebGL2 would read as the rest of the buffer', () => {
		const a = new THREE.InstancedBufferAttribute(new Float32Array(16 * 4), 4);
		uploadInstances(a, 0);
		expect(a.updateRanges).toEqual([{ start: 0, count: 4 }]);
	});
});
