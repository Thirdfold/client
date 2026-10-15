// Textures of a CC0 pack model (M76, cc0-assemble.ts): PNG with power-of-two sides, JPEG made PNG,
// and a library surface's maps worn as a material's textures.

import { Document, type Material, type Texture } from '@gltf-transform/core';
import { decodePng, encodePng } from './png';

export interface Image {
	width: number;
	height: number;
	data: Uint8Array;
}
export interface SurfaceMaps {
	color: Image;
	normal?: Image;
	roughness?: Image;
	ao?: Image;
}

/** Bilinear resample, for a texture whose sides are not powers of two. */
export function resample(img: Image, width: number, height: number): Image {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const fy = Math.min(((y + 0.5) * img.height) / height - 0.5, img.height - 1);
		const y0 = Math.max(0, Math.floor(fy));
		const y1 = Math.min(y0 + 1, img.height - 1);
		const ky = Math.max(0, fy - y0);
		for (let x = 0; x < width; x++) {
			const fx = Math.min(((x + 0.5) * img.width) / width - 0.5, img.width - 1);
			const x0 = Math.max(0, Math.floor(fx));
			const x1 = Math.min(x0 + 1, img.width - 1);
			const kx = Math.max(0, fx - x0);
			for (let c = 0; c < 4; c++) {
				const at = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 4 + c];
				const top = at(x0, y0) * (1 - kx) + at(x1, y0) * kx;
				const bottom = at(x0, y1) * (1 - kx) + at(x1, y1) * kx;
				data[(y * width + x) * 4 + c] = Math.round(top * (1 - ky) + bottom * ky);
			}
		}
	}
	return { width, height, data };
}

/** The largest power of two (at least 4) not over `n`. */
export const lowerPow2 = (n: number) => Math.max(4, 2 ** Math.floor(Math.log2(n)));

/** A surface's maps as a material's textures: colour, normal and an ORM (occlusion, roughness, no metal). */
export function wear(doc: Document, material: Material, maps: SurfaceMaps): void {
	const png = (name: string, img: Image) =>
		doc
			.createTexture(name)
			.setImage(encodePng(img.width, img.height, img.data))
			.setMimeType('image/png');
	material
		.setBaseColorTexture(png('albedo', maps.color))
		.setBaseColorFactor([1, 1, 1, 1])
		.setNormalTexture(maps.normal ? png('normal', maps.normal) : null)
		.setMetallicFactor(0)
		.setRoughnessFactor(1)
		.setMetallicRoughnessTexture(null)
		.setOcclusionTexture(null);
	if (!maps.roughness && !maps.ao) return;
	const { width, height } = maps.color;
	const rough = maps.roughness && resample(maps.roughness, width, height);
	const ao = maps.ao && resample(maps.ao, width, height);
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data.set([ao ? ao.data[i * 4] : 255, rough ? rough.data[i * 4] : 255, 0, 255], i * 4);
	}
	const orm = png('orm', { width, height, data });
	material.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
}

const MAX_SIDE = 2048;

/** Sketchfab archives, scans especially, keep their maps as JPEG: sharp (a dependency of gltf-transform) makes them PNG. */
async function toPng(t: Texture, name: string): Promise<void> {
	let png: Uint8Array;
	try {
		const { default: sharp } = await import('sharp');
		const image = sharp(t.getImage()!);
		const { width = 0, height = 0 } = await image.metadata();
		// Scans come at 4K-8K: no larger than the 2K variant, with power-of-two sides.
		const [w, h] = [Math.min(MAX_SIDE, lowerPow2(width)), Math.min(MAX_SIDE, lowerPow2(height))];
		png = new Uint8Array(await image.resize(w, h, { fit: 'fill' }).png().toBuffer());
	} catch (err) {
		throw new Error(`texture "${name}" is ${t.getMimeType()}, not a PNG sharp can make: ${err}`, {
			cause: err
		});
	}
	t.setImage(png).setMimeType('image/png');
}

/** A texture as a PNG with power-of-two sides: the cook halves it to the base and the variants. */
export async function fixTexture(t: Texture): Promise<void> {
	const name = t.getName() || t.getURI() || 'a texture';
	const [sw, sh] = (() => {
		try {
			return t.getSize() ?? [0, 0];
		} catch {
			return [0, 0]; // an image gltf-transform cannot measure: sharp says what is wrong
		}
	})();
	if (t.getMimeType() === 'image/jpeg' || Math.max(sw, sh) > MAX_SIDE) await toPng(t, name);
	if (t.getMimeType() !== 'image/png') {
		throw new Error(
			`texture "${name}" is ${t.getMimeType() || 'unknown'}, not PNG or JPEG: convert it first`
		);
	}
	const [width, height] = t.getSize() ?? [0, 0];
	const [w, h] = [lowerPow2(width), lowerPow2(height)];
	if (w !== width || h !== height) {
		const r = resample(decodePng(t.getImage()!), w, h);
		t.setImage(encodePng(r.width, r.height, r.data));
	}
}

/**
 * A texture's colour at (u, v) as linear RGB, for baking a scan's colour map into vertex colours
 * (a scan's atlas of tiny islands locks the simplifier at every seam; colours on the vertices do not).
 * The image is read at most MAX_SIDE wide; the wrap is repeat.
 */
export async function colourAt(
	t: Texture
): Promise<(u: number, v: number) => [number, number, number]> {
	const { default: sharp } = await import('sharp');
	const { data, info } = await sharp(t.getImage()!)
		.resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return (u, v) => {
		const x = Math.min(info.width - 1, Math.floor((((u % 1) + 1) % 1) * info.width));
		const y = Math.min(info.height - 1, Math.floor((((v % 1) + 1) % 1) * info.height));
		const i = (y * info.width + x) * 3;
		return [lin(data[i]), lin(data[i + 1]), lin(data[i + 2])];
	};
}
