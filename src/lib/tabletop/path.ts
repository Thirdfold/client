// The path preview's layer (#286, #287): the ribbon (two wide lines, solid within reach and dashed
// beyond), the arrowhead, and the drag's tether, drawn in the overlay pass so no grade or lens
// touches them. The wide lines are a lazy chunk (path-lines.ts) that arrives after the table
// shows; what was asked before then is drawn once it is here, and `onReady` makes the warm-up
// compile its materials. The arrowhead is a pooled instanced mesh with a count of 0 or 1, like the
// editor previews, so showing it compiles nothing. Nothing animates: a change is one frame.

import * as THREE from 'three/webgpu';
import type { OverlayLayer } from './overlay';
import type { PathLines } from './path-lines';
import { LINE_COLOURS, type Ribbon } from './path-ribbon';

/** The arrowhead's size, in cells: its tip points along +X before it is turned. */
const ARROW = { radius: 0.15, length: 0.34 };

export class PathLayer {
	readonly group = new THREE.Group();
	private lines: PathLines | null = null;
	private ribbon: Ribbon | null = null;
	private tether: readonly number[] | null = null;
	private standIns: THREE.Object3D[] | null = null;
	private disposed = false;
	private readonly arrow: THREE.InstancedMesh;
	private readonly matrix = new THREE.Matrix4();
	private readonly colour = new THREE.Color();

	constructor(
		overlay: OverlayLayer,
		/** Told when the wide lines have arrived: warm their materials up, then draw. */
		private readonly onReady: () => void
	) {
		const cone = new THREE.ConeGeometry(ARROW.radius, ARROW.length, 16).rotateZ(-Math.PI / 2);
		this.arrow = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff }), 1);
		this.arrow.setColorAt(0, this.colour.set(LINE_COLOURS.reach)); // the colour attribute exists from the start
		this.arrow.frustumCulled = false;
		this.arrow.count = 0;
		this.arrow.raycast = () => {};
		this.group.add(this.arrow);
		overlay.scene.add(this.group);
		void import('./path-lines').then(({ PathLines }) => {
			if (this.disposed) return;
			this.lines = new PathLines();
			this.group.add(this.lines.solid, this.lines.beyond, this.lines.tether);
			this.drawRibbon();
			this.lines.set(this.lines.tether, this.tether);
			this.onReady();
		});
	}

	/** Shows the ribbon (null: none), `scale` being the cell size. */
	setRibbon(ribbon: Ribbon | null, scale: number): void {
		this.ribbon = ribbon;
		const tip = ribbon?.tip;
		this.arrow.count = tip ? 1 : 0;
		if (tip) {
			const turn = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-tip.dz, tip.dx));
			// Its tip on the destination's centre.
			const back = (ARROW.length / 2) * scale;
			this.matrix.compose(
				new THREE.Vector3(tip.x - tip.dx * back, tip.y + 0.04 * scale, tip.z - tip.dz * back),
				turn,
				new THREE.Vector3(scale, scale, scale)
			);
			this.arrow.setMatrixAt(0, this.matrix);
			this.arrow.instanceMatrix.needsUpdate = true;
			const colour = ribbon.beyond.length ? LINE_COLOURS.beyond : LINE_COLOURS.reach;
			this.arrow.setColorAt(0, this.colour.set(colour));
			this.arrow.instanceColor!.needsUpdate = true;
		}
		this.drawRibbon();
	}

	/** Shows the drag's tether between two points (x, y, z triples), or none. */
	setTether(points: readonly number[] | null): void {
		this.tether = points;
		if (this.lines) this.lines.set(this.lines.tether, points);
	}

	/** Stand-ins for the warm-up to compile the wide lines' materials in the overlay's pass. */
	gallery(): THREE.Object3D[] {
		return this.lines ? (this.standIns ??= this.lines.standIns()) : [];
	}

	dispose(): void {
		this.disposed = true;
		this.group.removeFromParent();
		this.arrow.geometry.dispose();
		(this.arrow.material as THREE.Material).dispose();
		this.arrow.dispose();
		this.lines?.dispose();
	}

	private drawRibbon(): void {
		const { lines, ribbon } = this;
		if (!lines) return;
		lines.set(lines.solid, ribbon?.solid ?? null);
		lines.set(lines.beyond, ribbon?.beyond ?? null);
	}
}

const UP = new THREE.Vector3(0, 1, 0);
