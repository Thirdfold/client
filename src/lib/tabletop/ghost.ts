// The ghost mini (#286): a second, translucent copy of a token's figure at the cell a move would
// end on. It is its own FigureBatches, so it shares the figure code and its programs (the mini
// kind's hashed see-through carries the opacity) and needs no new material, but it stays out of the
// tokens' batches: its meshes cast no shadow (a shadow pass copies neither the opacity nor the
// hashing, and an extra caster would dirty the cached sun shadow on every hover) and are never
// picked (they would answer as the real token). A hover only moves one instance.

import * as THREE from 'three/webgpu';
import { FigureBatches } from './figures';
import { PICK_LAYER } from './picking';

/** How much of the figure shows. */
export const GHOST_OPACITY = 0.35;
const ID = 'ghost';

export class Ghost {
	readonly group = new THREE.Group();
	private readonly figures: FigureBatches;

	constructor(parent: THREE.Object3D, onModel: () => void) {
		this.figures = new FigureBatches(this.group, () => (this.strip(), onModel()));
		parent.add(this.group);
	}

	/** Shows the figure of `model` (null: the plain miniature) in `colour`, placed by `matrix`. */
	show(model: string | null, colour: string, matrix: THREE.Matrix4): void {
		this.figures.set(ID, model, colour, GHOST_OPACITY);
		this.figures.place(ID, matrix);
		this.strip();
	}

	hide(): void {
		this.figures.remove(ID);
	}

	dispose(): void {
		this.group.removeFromParent();
		this.figures.dispose();
	}

	/** No shadow and no picks, on every mesh (batches and their shadow proxies come and go). */
	private strip(): void {
		this.group.traverse((o) => {
			o.castShadow = false;
			o.layers.disable(PICK_LAYER);
		});
	}
}
