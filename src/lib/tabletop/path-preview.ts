// What a move shows before it is made (#286), and what a drag adds (#287): the path's ribbon, a
// ghost of the mini at the cell it would end on with its step count, and, while a mini is carried,
// a tether from it down to that cell. The cells come from the room page (ui/path-preview.ts), from
// the cells the viewer was sent only; this puts them on the ground. Nothing animates and nothing
// changes on the wire: each call is one frame.

import * as THREE from 'three/webgpu';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Token } from '$lib/game/token';
import { BASE_TOP, FIGURE_SCALE } from './bases';
import { Ghost } from './ghost';
import { STEP_HEIGHT, type Ground } from './ground';
import type { LabelLayer } from './label-layer';
import { LABEL_HEIGHT } from './labels';
import type { OverlayLayer } from './overlay';
import { PathLayer } from './path';
import { RIBBON_LIFT, ribbonOf } from './path-ribbon';

/** Where a move would end, for the ghost and the step count: `label` is empty for no count. */
export interface PathEnd {
	tokenId: string;
	cell: GridPos;
	label: string;
}

const turn = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const scaled = new THREE.Matrix4();

export class PathPreview {
	readonly paths: PathLayer;
	private readonly ghost: Ghost;
	private tokens: readonly Token[] = [];
	private grid: SquareGrid | null = null;
	private ground: Ground | null = null;
	private carried: string | null = null;
	/** The cell the carried mini would be set down on: where the tether ends. */
	private tetherTo: THREE.Vector3 | null = null;

	constructor(
		overlay: OverlayLayer,
		parent: THREE.Object3D,
		private readonly labels: LabelLayer,
		private readonly rootOf: (id: string) => THREE.Object3D | null,
		private readonly request: () => void,
		onModel: () => void
	) {
		this.paths = new PathLayer(overlay, onModel);
		this.ghost = new Ghost(parent, onModel);
	}

	/** The table the cells are on, and the tokens whose figures the ghost copies. */
	sync(tokens: readonly Token[], grid: SquareGrid, ground: Ground | null): void {
		[this.tokens, this.grid, this.ground] = [tokens, grid, ground];
	}

	/** Shows the walk `cells` (the start first), solid for `within` steps; null shows no ribbon. */
	set(cells: readonly GridPos[] | null, within: number, end: PathEnd | null): void {
		const { grid, ground } = this;
		if (!grid || !ground) return;
		const ribbon = cells && cells.length > 1 ? ribbonOf(cells, within, grid, ground.floorY) : null;
		this.paths.setRibbon(ribbon, grid.cellSize);
		const token = end && this.tokens.find((t) => t.id === end.tokenId);
		const root = end && this.rootOf(end.tokenId);
		if (!end || !token || !root) {
			this.ghost.hide();
			this.labels.note(null);
			this.tetherTo = null;
		} else {
			const w = gridToWorld(grid, end.cell);
			const floor = ground.floorY(end.cell);
			const at = new THREE.Vector3(
				w.x,
				floor + (token.lift ?? 0) * STEP_HEIGHT * grid.cellSize,
				w.z
			);
			// The real mini's root and figure, moved to the cell.
			const top = BASE_TOP / (root.scale.y / grid.cellSize);
			matrix.compose(at, turn.identity(), root.scale);
			matrix.multiply(scaled.makeTranslation(0, top, 0)).multiply(scaled.makeScale(...fig));
			this.ghost.show(token.model ?? null, token.color, matrix);
			const above = at.clone().setY(at.y + LABEL_HEIGHT * root.scale.y);
			this.labels.note(end.label || null, above);
			this.tetherTo = new THREE.Vector3(w.x, floor + RIBBON_LIFT * grid.cellSize, w.z);
		}
		this.retether();
		this.request();
	}

	/** The carried mini (null: none). The lift is the token layer's; the tether is here. */
	carry(id: string | null): void {
		this.carried = id;
		if (!id) this.tetherTo = null;
		this.retether();
		this.request();
	}

	/** Draws the tether from the carried mini to the cell: again whenever the mini moves. */
	retether(): void {
		const from = this.carried && this.rootOf(this.carried)?.position;
		const to = this.tetherTo;
		this.paths.setTether(from && to ? [from.x, from.y, from.z, to.x, to.y, to.z] : null);
	}

	gallery(): THREE.Object3D[] {
		return this.paths.gallery();
	}

	dispose(): void {
		this.paths.dispose();
		this.ghost.dispose();
	}
}

const fig = [FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE] as const;
