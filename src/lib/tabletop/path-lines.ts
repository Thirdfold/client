// The wide lines of the path preview (#286) and the drag's tether (#287): three's webgpu Line2 with
// Line2NodeMaterial, which are big, so this file is its own lazy chunk (path.ts imports it when a
// table shows). Three materials, all in world units and made once, never switched: solid for the
// part within reach, dashed for the part beyond, and a thin solid one for the tether (the same
// program as the solid one). `dashed` and `worldUnits` recompile when set, so they are only ever
// given here, at construction.

import { Line2NodeMaterial } from 'three/webgpu';
import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { DASH, GAP, LINE_COLOURS, RIBBON_WIDTH, TETHER_WIDTH } from './path-ribbon';

const made = (colour: number, linewidth: number, dashed: boolean) =>
	new Line2NodeMaterial({
		color: colour,
		linewidth,
		worldUnits: true,
		dashed,
		dashSize: DASH,
		gapSize: GAP
	});

export class PathLines {
	readonly materials = {
		solid: made(LINE_COLOURS.reach, RIBBON_WIDTH, false),
		dashed: made(LINE_COLOURS.beyond, RIBBON_WIDTH, true),
		tether: made(LINE_COLOURS.tether, TETHER_WIDTH, false)
	};
	readonly solid = this.line(this.materials.solid);
	readonly beyond = this.line(this.materials.dashed);
	readonly tether = this.line(this.materials.tether);

	/** Draws `points` (x, y, z triples) on `line`, or nothing when there are fewer than two. */
	set(line: Line2, points: readonly number[] | null): void {
		const n = points ? points.length / 3 : 0;
		line.visible = n > 1;
		if (n < 2) return;
		line.geometry.dispose();
		line.geometry = new LineGeometry();
		line.geometry.setPositions([...points!]);
		line.computeLineDistances(); // the dashes
	}

	/** Stand-ins for the warm-up: each material on a two-point line (compiles all of them). */
	standIns(): Line2[] {
		return Object.values(this.materials).map((m) => {
			const line = this.line(m);
			line.geometry.setPositions([0, 0, 0, 1, 0, 0]);
			line.computeLineDistances();
			return line;
		});
	}

	dispose(): void {
		for (const line of [this.solid, this.beyond, this.tether]) {
			line.removeFromParent();
			line.geometry.dispose();
		}
		for (const m of Object.values(this.materials)) m.dispose();
	}

	/** A line that is never culled (its points move with every path) nor picked. */
	private line(material: Line2NodeMaterial): Line2 {
		const line = new Line2(new LineGeometry(), material);
		line.frustumCulled = false;
		line.visible = false;
		line.raycast = () => {};
		return line;
	}
}
