// Plants (#304): what sets one tree or bush apart from the next, and whether any is in view. Pure
// (no three.js), in the lazy `world` chunk beside the decor jitter, so the renderer keeps neither.

import { keyHash, seededRandom } from './hash';
import { sphereInView, viewPlanes } from './prop-chunks';

/** How far a plant strays from its model: its size either way, and its hue (a share of the wheel). */
export const PLANT_VARIETY = { scale: 0.1, hue: 0.06 } as const;

/** What sets one plant apart from the next: a turn about the vertical, a scale to multiply by, a hue shift. */
export interface Variety {
	yaw: number;
	scale: number;
	hue: number;
}

/**
 * The variety of plant `propId`, from its id alone so every client agrees: a canopy is round, so a
 * tree takes any turn (`freeYaw`; a bush has its catalogue jitter's), a size within
 * `PLANT_VARIETY.scale` and a hue within `PLANT_VARIETY.hue`. Changes no rule and no pick.
 */
export function varietyFor(propId: string, freeYaw: boolean): Variety {
	const rand = seededRandom(keyHash(`${propId}:plant`));
	const [yaw, scale, hue] = [rand(), rand() * 2 - 1, rand() * 2 - 1];
	return {
		yaw: freeYaw ? (yaw * 2 - 1) * Math.PI : 0,
		scale: 1 + scale * PLANT_VARIETY.scale,
		hue: hue * PLANT_VARIETY.hue
	};
}

/** What `anyInView` reads of a bucket of props (props.ts `AssetMeshes`). */
interface Bucket {
	model: { entry: { kind: string } } | null;
	parts: {
		mesh: {
			visible: boolean;
			boundingSphere: { center: { x: number; y: number; z: number }; radius: number } | null;
		};
	}[];
}

/**
 * Whether any plant's mesh in `buckets` has its bounding sphere in the view of a camera whose
 * projection times view matrix is `vp` (three's column-major `elements`, `viewPlanes`).
 * Conservative: never false for a sphere in view.
 */
export function anyInView(buckets: Iterable<Bucket>, vp: ArrayLike<number>): boolean {
	const planes = viewPlanes(vp);
	for (const { model, parts } of buckets) {
		if (model?.entry.kind !== 'foliage') continue;
		for (const { mesh } of parts) {
			const sphere = mesh.visible && mesh.boundingSphere;
			if (!sphere) continue;
			const { x, y, z } = sphere.center;
			if (sphereInView(planes, x, y, z, sphere.radius)) return true;
		}
	}
	return false;
}
