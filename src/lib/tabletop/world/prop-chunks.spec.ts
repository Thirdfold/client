import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chunksInView, propChunk, sameChunks, type PropSphere } from './prop-chunks';

describe('propChunk', () => {
	it("keys a prop by its anchor cell's 16x16 chunk, row-major across the grid", () => {
		expect(propChunk({ x: 0, y: 0 }, 36)).toBe(0);
		expect(propChunk({ x: 15, y: 15 }, 36)).toBe(0);
		expect(propChunk({ x: 16, y: 0 }, 36)).toBe(1);
		expect(propChunk({ x: 35, y: 0 }, 36)).toBe(2);
		expect(propChunk({ x: 0, y: 16 }, 36)).toBe(3); // 36 cells are three chunks across
		expect(propChunk({ x: 47, y: 35 }, 48)).toBe(8); // the Hollow's far corner
	});
});

describe('chunksInView', () => {
	const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
	camera.position.set(0, 5, 10);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();
	const vp = new THREE.Matrix4().multiplyMatrices(
		camera.projectionMatrix,
		camera.matrixWorldInverse
	).elements;
	const at = (chunk: number, x: number, z: number, r = 1): PropSphere => ({ chunk, x, y: 0, z, r });

	it('sees the chunks with a prop ahead, not those behind or far to the side', () => {
		const seen = chunksInView([at(0, 0, 0), at(1, 0, 30), at(2, 80, 0), at(3, 1, 1)], vp);
		expect([...seen].sort()).toEqual([0, 3]);
		expect(chunksInView([], vp).size).toBe(0);
	});

	it('counts a chunk whole when any of its props reaches into the view', () => {
		expect(chunksInView([at(4, 20, 0), at(4, 0, 30)], vp).has(4)).toBe(false);
		expect(chunksInView([at(4, 20, 0, 15), at(4, 0, 30)], vp).has(4)).toBe(true);
		expect(chunksInView([at(4, 0, 30), at(4, 0, 0)], vp).has(4)).toBe(true);
	});

	it('follows the camera turning on the spot', () => {
		const props = [at(0, 0, 0), at(1, 0, 20)];
		const turned = camera.clone();
		turned.lookAt(0, 0, 20);
		turned.updateMatrixWorld();
		const vp2 = new THREE.Matrix4().multiplyMatrices(
			turned.projectionMatrix,
			turned.matrixWorldInverse
		).elements;
		expect([...chunksInView(props, vp)]).toEqual([0]);
		expect([...chunksInView(props, vp2)]).toEqual([1]);
	});
});

describe('sameChunks', () => {
	it('compares sets of chunks, null meaning all', () => {
		expect(sameChunks(null, null)).toBe(true);
		expect(sameChunks(new Set([1, 2]), new Set([2, 1]))).toBe(true);
		expect(sameChunks(new Set([1]), new Set([1, 2]))).toBe(false);
		expect(sameChunks(new Set([1]), new Set([2]))).toBe(false);
		expect(sameChunks(null, new Set())).toBe(false);
	});
});
