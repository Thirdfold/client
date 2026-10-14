// The grass layer (#302, #303), a lazy chunk of its own (`grass` in scripts/check-bundle.mjs) with
// the grass graph (materials/grass.ts): the renderer and the lobby load it before making a table or
// a gallery. Every grass cell the viewer knows (world/grass-cells.ts: grass floors, and the plain
// ground of an environment whose default ground is grass, outside roofs, off props but nature's)
// grows a field of blades, all one draw: an InstancedBufferGeometry of a single blade strip whose
// instances the graph spreads over the cell list. The list (RGBA8: the cell's index, its inset
// bits, its density) and the field map (R8 per cell: grass or not, for the borders' fade) are
// rebuilt only when the cells' signature changes (timed as `grass`); a camera move only changes
// how many blades are drawn (`bladesInView`). Nothing here casts a shadow, asks the sun's to redraw
// or is picked, and its frames are AMBIENT only while the wind blows and the field is in view.
//
// The environment's default ground is grass where its token bases' discs are (`miniBase`, #265:
// every environment's disc is the surface its plain ground wears), so no new manifest field.
//
// Parting (#303): each drawn frame while minis or dice move, and once after every update, the
// footprints of the minis the token layer holds (only those the viewer was sent) and of resting
// dice go to the graph, the nearest 32 to the camera's focus (world/parting.ts). It never asks
// for a frame of its own.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { Prop } from '$lib/game/props';
import { manifestNow } from '$lib/assets/load';
import { MAP_SIDE } from './cell-maps-kept';
import type { CellMaps } from './cell-maps';
import type { DiceLayer } from './dice3d';
import { STEP_HEIGHT } from './ground';
import { BAKE_ATTRIBUTE, createMaterial } from './materials';
import {
	grassUniforms,
	LIST_HEIGHT,
	LIST_WIDTH,
	setGrassMaps,
	setParting
} from './materials/grass';
import { WindClock, windOn } from './materials/wind';
import type { PerfRecorder } from './perf';
import type { QualitySettings } from './quality';
import type { TokenLayer } from './tokens';
import { bladesInView, bladeStrip, GRASS_HEIGHT } from './world/grass-blades';
import { grassCells, grassSignature } from './world/grass-cells';
import { diceFootprints, partingSet, tokenFootprints, type Footprint } from './world/parting';
import type { WorldShape } from './world/shape';
import { VEGETATION } from './world/vegetation-tiers';

/**
 * The decor layer (#305, decor-layer.ts, a lazy chunk of its own), fetched from here so the renderer
 * has one lazy import for the ground's growth.
 */
export const decor = import('./decor-layer').then((m) => m.ready);

/** Grass under `?perf`'s `layers` (perf.ts `tagged`). */
const LAYER = { perfLayer: 'grass' };
/** How far wind may carry a tip past the field's bounds, in cells. */
const SWAY = 0.2;

function dataTexture(
	data: Uint8Array,
	side: number,
	height: number,
	format: THREE.PixelFormat,
	filter: THREE.MagnificationTextureFilter
): THREE.DataTexture {
	const texture = new THREE.DataTexture(data, side, height, format);
	texture.magFilter = texture.minFilter = filter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

/** Gives a blade geometry the strip of `segments` (world/grass-blades.ts), its normals up. */
function shapeBlade(geometry: THREE.BufferGeometry, segments: number): void {
	const { positions, indices } = bladeStrip(segments);
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	const normals = new Float32Array(positions.length);
	for (let k = 1; k < normals.length; k += 3) normals[k] = 1;
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	// Open and thin (#237's translucency reads the bake's occlusion as thickness): tips glow backlit.
	const bake = new Float32Array((positions.length / 3) * 2).map((_, i) => (i % 2 ? 0.5 : 1));
	geometry.setAttribute(BAKE_ATTRIBUTE, new THREE.BufferAttribute(bake, 2));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
}

/**
 * One blade on the grass graph, taking shadows as the field does: what the warm-up compiles
 * (#180), the lobby's before any table, a table's in its gallery. Its program is the field's
 * whatever its segments.
 */
export function grassStandIn(material = createMaterial('foliage', { grass: true })): THREE.Mesh {
	const geometry = new THREE.InstancedBufferGeometry();
	shapeBlade(geometry, VEGETATION.low.segments);
	geometry.instanceCount = 1;
	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	mesh.frustumCulled = false;
	return mesh;
}

export class GrassLayer {
	readonly group = new THREE.Group();
	private readonly material = createMaterial('foliage', { grass: true });
	private readonly geometry = new THREE.InstancedBufferGeometry();
	private readonly mesh = new THREE.Mesh(this.geometry, this.material);
	/** Kept for the layer's life at the largest grid's size, as the cell maps (#380). */
	private readonly list = dataTexture(
		new Uint8Array(LIST_WIDTH * LIST_HEIGHT * 4),
		LIST_WIDTH,
		LIST_HEIGHT,
		THREE.RGBAFormat,
		THREE.NearestFilter
	);
	private readonly field = dataTexture(
		new Uint8Array(MAP_SIDE * MAP_SIDE),
		MAP_SIDE,
		MAP_SIDE,
		THREE.RedFormat,
		THREE.LinearFilter
	);
	private inputs: unknown[] = [];
	private signature = -1;
	private count = 0;
	private blades = 0;
	private segments = 0;
	private on = true;
	private cellSize = 1;
	private readonly bounds = new THREE.Box3();
	private readonly footprints: Footprint[] = [];
	private readonly parting = {
		data: new Float32Array(grassUniforms.parts.array.length * 4),
		count: 0
	};
	private partDue = true;
	/** The wind field's clock (#300): the grass's and everything else's that sways. */
	readonly wind = new WindClock();
	private standIn: THREE.Mesh | null = null;
	private readonly frustum = new THREE.Frustum();
	private readonly matrix = new THREE.Matrix4();

	constructor(
		private readonly perf: PerfRecorder,
		/** Whose minis and dice part the grass (#303). */
		private readonly tokens: TokenLayer,
		private readonly dice: DiceLayer,
		/** The roofed cells as sent (`interior`): plain ground under a roof is no lawn. */
		private readonly maps: CellMaps
	) {
		setGrassMaps({ list: this.list, field: this.field });
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = true;
		this.mesh.raycast = () => {};
		this.mesh.userData = LAYER;
		this.mesh.visible = false;
		this.group.add(this.mesh);
	}

	/**
	 * The field for what the viewer was sent: its cells again when the shape, roofs (`interior`,
	 * as sent: plain ground under a roof is no lawn), props or environment changed (identity), their
	 * textures again only when the cells did.
	 */
	update(shape: WorldShape, props: readonly Prop[], environment: string | null): void {
		this.partDue = true;
		const interior = this.maps.interior;
		const inputs = [shape, props, environment, interior];
		if (inputs.every((v, i) => v === this.inputs[i])) return;
		if (environment !== this.inputs[2]) this.wind.setEnvironment(environment);
		this.inputs = inputs;
		this.perf.time('grass', () => this.rebuild(shape, props, environment, interior));
	}

	/** The tier's blades and segments (quality.ts's vegetation row), and the `grass` layer switch. */
	setTier(s: QualitySettings): void {
		this.on = s.layers.grass;
		this.blades = s.vegetation.blades;
		grassUniforms.blades.value = Math.max(this.blades, 1);
		const segments = s.vegetation.segments;
		if (segments === this.segments) return;
		this.segments = segments;
		shapeBlade(this.geometry, segments);
	}

	/**
	 * Before a frame: how many blades the camera can see, the parting while minis or dice move (or
	 * after an update), and whether the field sways in view (AMBIENT frames).
	 */
	tick(
		now: number,
		still: boolean,
		camera: THREE.Camera,
		focus: THREE.Vector3,
		moving: boolean
	): boolean {
		this.wind.tick(now, still);
		const near = this.bounds.isEmpty() ? Infinity : this.bounds.distanceToPoint(camera.position);
		const shown = this.count * bladesInView(this.blades, near / this.cellSize);
		this.geometry.instanceCount = shown;
		this.mesh.visible = this.on && shown > 0;
		if (moving || this.partDue) this.part(focus);
		if (!this.mesh.visible || !windOn()) return false;
		this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.frustum.setFromProjectionMatrix(this.matrix);
		return this.frustum.intersectsBox(this.bounds);
	}

	/** A stand-in for the warm-up (#180): the field may grow only later (a lawn painted, found). */
	gallery(): THREE.Object3D[] {
		return [(this.standIn ??= grassStandIn(this.material))];
	}

	dispose(): void {
		setGrassMaps(null);
		this.geometry.dispose();
		this.standIn?.geometry.dispose();
		this.material.dispose();
		this.list.dispose();
		this.field.dispose();
	}

	private rebuild(
		shape: WorldShape,
		props: readonly Prop[],
		environment: string | null,
		interior: Uint8Array | null
	): void {
		const { grid } = shape;
		const env = environment ? manifestNow()?.environments[environment] : undefined;
		const grass = grassCells({
			shape,
			interior,
			props,
			defaultIsGrass: env?.miniBase === 'grass'
		});
		const { width: w, cellSize: cs } = grid;
		this.cellSize = cs;
		this.count = grass.count;
		grassUniforms.cells.value = Math.max(grass.count, 1);
		// The field's extent, from the cells' corners and their highest floor.
		this.bounds.makeEmpty();
		let top = 0;
		for (let k = 0; k < grass.count; k++) {
			const c = grass.cells[k];
			const [x, y] = [c % w, Math.floor(c / w)];
			top = Math.max(top, shape.levels[c]);
			this.bounds.expandByPoint(this.at(grid, x - SWAY, y - SWAY));
			this.bounds.expandByPoint(this.at(grid, x + 1 + SWAY, y + 1 + SWAY));
		}
		if (!this.bounds.isEmpty()) this.bounds.max.y = (top * STEP_HEIGHT + GRASS_HEIGHT) * cs;
		this.geometry.boundingBox = this.bounds.clone();
		this.geometry.boundingSphere = this.bounds.getBoundingSphere(new THREE.Sphere());
		const signature = grassSignature(grass, w);
		if (signature === this.signature) return;
		this.signature = signature;
		const list = this.list.image.data as Uint8Array;
		const field = this.field.image.data as Uint8Array;
		field.fill(0);
		for (let k = 0; k < grass.count; k++) {
			const c = grass.cells[k];
			list.set([c & 255, c >> 8, grass.insets[k], grass.density[k]], k * 4);
			field[Math.floor(c / w) * MAP_SIDE + (c % w)] = 255;
		}
		this.list.needsUpdate = this.field.needsUpdate = true;
	}

	/** A grid corner's world point (cell units, x and y), on the ground. */
	private at(grid: SquareGrid, x: number, y: number): THREE.Vector3 {
		const cs = grid.cellSize;
		return new THREE.Vector3((x - grid.width / 2) * cs, 0, (y - grid.height / 2) * cs);
	}

	private part(focus: THREE.Vector3): void {
		this.partDue = false;
		const cs = this.cellSize;
		const n = tokenFootprints(this.tokens.entries, cs, STEP_HEIGHT * cs, this.footprints);
		const all = diceFootprints(this.dice.active, cs, ...this.dice.timing, this.footprints, n);
		setParting(partingSet(this.footprints, focus, undefined, this.parting, all));
	}
}
