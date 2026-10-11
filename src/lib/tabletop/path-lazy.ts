// The path preview, loaded when a table shows (#286, #287): the ribbon, the arrowhead, the ghost and
// the tether are needed only once a viewer hovers or drags, so they are a chunk of their own
// (path-preview.ts). This stands in for them until they arrive and hands over what was asked
// meanwhile, so the token layer calls it as if it were already there.

import type * as THREE from 'three/webgpu';
import type { LabelLayer } from './label-layer';
import type { OverlayLayer } from './overlay';
import type { PathPreview } from './path-preview';

export class LazyPath {
	private real: PathPreview | null = null;
	private gone = false;
	private table: Parameters<PathPreview['sync']> | null = null;
	private asked: Parameters<PathPreview['set']> | null = null;
	private carried: string | null = null;

	constructor(
		overlay: OverlayLayer,
		parent: THREE.Object3D,
		labels: LabelLayer,
		rootOf: (id: string) => THREE.Object3D | null,
		request: () => void,
		onModel: () => void
	) {
		void import('./path-preview').then(({ PathPreview }) => {
			if (this.gone) return;
			const real = (this.real = new PathPreview(overlay, parent, labels, rootOf, request, onModel));
			if (this.table) real.sync(...this.table);
			if (this.asked) real.set(...this.asked);
			real.carry(this.carried);
			onModel(); // its materials to warm up
		});
	}

	sync(...args: Parameters<PathPreview['sync']>): void {
		this.table = args;
		this.real?.sync(...args);
	}

	set(...args: Parameters<PathPreview['set']>): void {
		this.asked = args;
		this.real?.set(...args);
	}

	carry(id: string | null): void {
		this.carried = id;
		this.real?.carry(id);
	}

	retether(): void {
		this.real?.retether();
	}

	gallery(): THREE.Object3D[] {
		return this.real?.gallery() ?? [];
	}

	dispose(): void {
		this.gone = true;
		this.real?.dispose();
	}
}
