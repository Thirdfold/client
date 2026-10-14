// Plants (#304): what sets one tree or bush apart from the next, and whether any is in view. Pure
// (no three.js), in the lazy `world` chunk beside the decor jitter, so the renderer keeps neither.

import { keyHash, seededRandom } from './hash';

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

/** The planes of a view: the four sides and the near one (axis 0, 1 or 2 of the clip box, and its sign). */
const SIDES = [
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[2, 1]
] as const;

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
 * projection times view matrix is `vp` (three's column-major `elements`): each plane is the
 * matrix's last row plus or minus another (Gribb and Hartmann). Conservative: never false for a
 * sphere in view.
 */
export function anyInView(buckets: Iterable<Bucket>, vp: ArrayLike<number>): boolean {
	const planes = SIDES.map(([k, s]) => [
		vp[3] + s * vp[k],
		vp[7] + s * vp[4 + k],
		vp[11] + s * vp[8 + k],
		vp[15] + s * vp[12 + k]
	]);
	for (const { model, parts } of buckets) {
		if (model?.entry.kind !== 'foliage') continue;
		for (const { mesh } of parts) {
			const sphere = mesh.visible && mesh.boundingSphere;
			if (!sphere) continue;
			const { x, y, z } = sphere.center as { x: number; y: number; z: number };
			if (
				planes.every(
					([a, b, c, d]) => a * x + b * y + c * z + d >= -sphere.radius * Math.hypot(a, b, c)
				)
			)
				return true;
		}
	}
	return false;
}
