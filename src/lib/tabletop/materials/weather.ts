// The weather's graph (#320), in the lazy `vfx` chunk: the overlay kind's `weather` variant,
// registered beside the particles' `sheet` one (vfx.ts). One InstancedBufferGeometry of quads
// draws every drop; each instance carries only a fixed random (`aWeather`: its column in the box,
// its phase, a speed pick), and everything else is a closed form of those, the layer's uniforms
// and the storm's phase (weather.ts), which is server time: p = origin + mod(hash x box +
// velocity x t, box), the same drop in the same place on every client.
//
// The box follows the camera's target and the drops stay fixed in the world, wrapping at its
// edge, so nothing pops as the camera moves. A drop falls from the box's top and is gone, in the
// vertex stage (size 0), when its column
//   - is below the ground there (the level map, so it meets a ledge at the ledge's height),
//   - is roofed or dark (the visibility map's A channel, `INDOOR_FILL` under a roof),
//   - is a player's unexplored cell (fog on, not the GM's, neither visible nor explored),
// or past the box's edge (faded). A rain drop that reaches the ground becomes a ring on it for a
// moment, the same instance. Streaks lie along their fall and turn to face the camera; flakes
// always face it. Fragment: worldModify, so what is lit, dark or fogged follows its cell and a
// hidden cell is exactly black.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { cellUniforms, groundFlat, visibilityAt, visibilityTexel } from '../cell-maps';
import { STEP_HEIGHT } from '../ground';
import type { Graph } from './kinds';
import { tsl, type N } from './tsl';
import { softDepth, softOn } from './vfx';
import { worldModify } from './world-modify';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;
const cells = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;

/** Per instance: x and z in the box (0-1), the fall's phase, and a speed pick. */
export const WEATHER_ATTRIBUTE = 'aWeather';

export const weatherUniforms = {
	/** The box's centre: x, the base y, z. */
	center: T.uniform(new THREE.Vector3()),
	/** The box's width, its height above the base, the depth below it, a ring's life (a fall's share). */
	box: T.uniform(new THREE.Vector4(32, 12, 6, 0)),
	/** Offsets of the columns and the phase, from the weather's seed. */
	seed: T.uniform(new THREE.Vector3()),
	/** Where the storm is in its cycle, 0-1 (server time). */
	phase: T.uniform(0),
	/** 1 a flake facing the camera, 0 a streak; its length and width in box units; its sway. */
	look: T.uniform(new THREE.Vector4(0, 1, 0.04, 0)),
	/** The slant over a fall (x, z), the sway's cycles, the alpha. */
	tilt: T.uniform(new THREE.Vector4(0, 0, 0, 0.3)),
	/** The slowest speed's multiple and how many more are picked from. */
	mult: T.uniform(new THREE.Vector2(1, 0)),
	colour: T.uniform(new THREE.Color(0.7, 0.78, 0.92)),
	/** Cells from the camera where a drop starts to show and where it is whole (weather-look.ts). */
	near: T.uniform(new THREE.Vector2(3, 9))
};
const u = weatherUniforms as unknown as Record<keyof typeof weatherUniforms, N>;

let built: Graph | null = null;

export function weatherGraph(): Graph {
	if (built) return built;
	const a = tsl.attribute(WEATHER_ATTRIBUTE, 'vec4');
	const [width, height] = [u.box.x, u.box.y];
	const fall = height.add(u.box.z);
	const unit = width.div(32);
	// The drop's column: fixed in the world, wrapped about the box's centre.
	const spot = a.xy.add(u.seed.xy);
	const d = t.fract(spot.sub(u.center.xz.div(width)).add(0.5)).sub(0.5);
	const column = u.center.xz.add(d.mul(width));
	const edge = t.float(1).sub(t.smoothstep(0.36, 0.5, t.length(d)));
	// Its fall: a share of the way down, repeating whole times a cycle so the wrap is seamless.
	const speed = u.mult.x.add(t.floor(a.w.mul(u.mult.y)));
	const f = t.fract(a.z.add(u.seed.z).add(speed.mul(u.phase)));
	const top = u.center.y.add(height);
	// The column's cell: ground, roofs and fog. Off the grid nothing culls.
	const at = column.div(cells.cellSize).add(cells.gridSize.mul(0.5));
	const size = t.ivec2(cells.gridSize);
	const inside = t
		.float(at.x.greaterThanEqual(0))
		.mul(t.float(at.y.greaterThanEqual(0)))
		.mul(t.float(at.x.lessThan(cells.gridSize.x)))
		.mul(t.float(at.y.lessThan(cells.gridSize.y)));
	const cell = t.clamp(t.ivec2(t.floor(at)), t.ivec2(0, 0), size.sub(1));
	const seen = (visibilityTexel as unknown as N).load(cell);
	const ground = (groundFlat as unknown as N).load(cell);
	const floorY = ground.y.mul(255).mul(cells.cellSize).mul(STEP_HEIGHT);
	const hidden = cells.fogOn
		.mul(t.float(1).sub(cells.fogMode))
		.mul(t.float(1).sub(seen.x))
		.mul(t.float(1).sub(seen.y));
	const roofed = t.step(seen.w, cells.indoorFill.add(0.02));
	const allowed = t.mix(t.float(1), t.float(1).sub(hidden).mul(t.float(1).sub(roofed)), inside);
	// Where in its fall it meets the ground, and the ring it leaves.
	const hits = top.sub(floorY).div(fall);
	const falling = t.step(f, hits);
	const ringing = t
		.step(hits, f)
		.mul(t.step(f, hits.add(u.box.w)))
		.mul(t.step(hits, 1));
	const ring = f.sub(hits).div(t.max(u.box.w, 1e-4)).clamp(0, 1);
	const show = allowed.mul(edge).mul(falling.add(ringing).clamp(0, 1));
	// The drop: slanted by the wind, swaying; a streak's heading, a flake's camera plane.
	const slant = u.tilt.xy.mul(unit);
	const angle = f
		.mul(u.tilt.z)
		.add(a.w)
		.mul(2 * Math.PI);
	const sway = t.vec2(t.sin(angle), t.cos(angle.mul(0.8).add(1))).mul(u.look.w.mul(unit));
	const sky = column.add(slant.mul(f.sub(0.5))).add(sway);
	const p = t.vec3(sky.x, top.sub(f.mul(fall)), sky.y);
	const heading = t.vec3(slant.x, fall.negate(), slant.y).normalize();
	const toCamera = t.cameraPosition.sub(p).normalize();
	const right = t.cameraWorldMatrix.mul(t.vec4(1, 0, 0, 0)).xyz;
	const up = t.cameraWorldMatrix.mul(t.vec4(0, 1, 0, 0)).xyz;
	// A streak seen from straight above has no side to it: lean on the camera's right.
	const side = t.cross(heading, toCamera).add(right.mul(0.15)).normalize();
	const [alongAxis, acrossAxis] = [t.mix(heading, up, u.look.x), t.mix(side, right, u.look.x)];
	const corner = tsl.positionGeometry.xy;
	const drop = p
		.add(alongAxis.mul(corner.y.mul(u.look.y.mul(unit))))
		.add(acrossAxis.mul(corner.x.mul(u.look.z.mul(unit))));
	const radius = unit.mul(t.mix(0.08, 0.4, ring));
	const splash = t
		.vec3(column.x, floorY.add(0.03), column.y)
		.add(t.vec3(corner.x, 0, corner.y).mul(radius));
	// A drop at the lens is gone outright (no overdraw), before the fragment thins the rest.
	const lens = t.step(u.near.x, t.length(p.sub(t.cameraPosition)).div(cells.cellSize));
	const on = t.step(0.001, show.mul(lens));
	const position = t.mix(p, t.mix(drop, splash, ringing), on);
	// Alpha: in at the top, out near the ground (a ring fades as it spreads).
	const near = t.float(1).sub(t.smoothstep(hits.sub(0.04), hits, f));
	const life = t.mix(t.smoothstep(0, 0.04, f).mul(near), t.float(1).sub(ring), ringing);
	const mark = tsl.varying(t.vec2(u.tilt.w.mul(show).mul(life), ringing), 'vWeather');
	const r = t.length(tsl.uv().sub(0.5).mul(2));
	const blob = t.float(1).sub(t.smoothstep(0.35, 1, r));
	const band = t.smoothstep(0.55, 0.75, r).mul(t.float(1).sub(t.smoothstep(0.8, 1, r)));
	// Near the camera a drop thins out (cells away along the view, by `near`): a streak a cell from
	// the lens would cover the screen.
	const away = tsl.positionView.z.negate().div(cells.cellSize);
	const thin = t.smoothstep(u.near.x, u.near.y, away);
	// A player never sees a drop in front of ground they never explored (the prepass's depth along
	// the view ray, as the air's puffs, #374): it would lift that cell off black. On low, with no
	// depth to read, the column's own cell decides alone.
	const sceneZ = t.perspectiveDepthToViewZ(softDepth, t.cameraNear, t.cameraFar);
	const view = tsl.positionView.xyz.mul(sceneZ.div(tsl.positionView.z));
	const behind = visibilityAt(
		t.cameraWorldMatrix.mul(t.vec4(view, 1)).xyz as never
	) as unknown as N;
	const player = cells.fogOn.mul(t.float(1).sub(cells.fogMode)).mul(softOn);
	const clear = t.mix(t.float(1), behind.y, player);
	built = {
		colorNode: t.vec4(u.colour, 1),
		opacityNode: mark.x
			.mul(t.mix(blob, band, mark.y))
			.mul(thin)
			.mul(clear),
		alphaTestNode: null,
		positionNode: position,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.output, t.vec3(0)),
		lit: null
	};
	return built;
}
