// The shader grid and the hover highlight (#245): the overlay kind's `grid` variant, drawn on a
// twin of each world chunk's tops in the overlay's pass (grid-overlay.ts). Lines come from the
// fragment's place on the grid in cells, `fract`, with Golus's pristine-grid coverage (derivatives
// clamp the width to a pixel and fade far lines toward their average, so they never shimmer);
// only on tops (an upward normal), on the grid, off the void, faded by the camera's distance and
// by the fog. The highlight is the same pass: the hovered cell in its kind's colour and pattern
// (move fills, blocked hatches, place draws corner brackets), so the kinds differ by shape as well
// as colour (G6). Modes, the focus, the hovered cell and its pattern are module-wide uniforms, like
// the cell maps': switching any of them compiles nothing. grid-modes.ts mirrors the maths.
//
// It takes worldModify's fog and cut, not its darkening: game state stays crisp at night, as the
// labels do, and a hidden cell gets alpha exactly 0, so nothing is laid over black after the
// output stage's re-mask (unexplored-black.svelte.spec.ts).

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { VOID } from '../../game/floor';
import { cellUV, cellUniforms, groundFlat, onGrid } from '../cell-maps';
import { MAP_SIDE } from '../cell-maps-kept';
import {
	AREA_STRIPES,
	CHANNELS,
	CHANNEL_COLOUR,
	CONTOUR_OPACITY,
	CONTOUR_WIDTH,
	DASHES_PER_CELL,
	FILL_OPACITY
} from '../cell-overlay';
import {
	BRACKET_ARM,
	BRACKET_BAND,
	EXPLORE_INNER,
	EXPLORE_RADIUS,
	FADE_FAR,
	FADE_NEAR,
	GRID_COLOR,
	GRID_OPACITY,
	HATCH_STRIPES,
	LINE_WIDTH,
	PATTERN_INSET,
	PATTERN_OPACITY
} from '../grid-modes';
import { tsl, type N } from './tsl';
import { worldFog, worldHidden } from './world-modify';

type Loose = (...args: unknown[]) => N;
const {
	Discard,
	If,
	abs,
	cameraPosition,
	clamp,
	dFdx,
	dFdy,
	distance,
	float,
	floor,
	fract,
	fwidth,
	length,
	min,
	normalWorldGeometry,
	positionWorld,
	smoothstep,
	texture
} = T as unknown as Record<string, Loose>;
const Fn = T.Fn as unknown as (body: () => N) => () => N;
const { max, mix, vec2, vec4 } = tsl;
const loose = (node: unknown) => node as N;

const FAR = new THREE.Vector2(-1e4, -1e4);

/** The grid's uniforms: set by `GridOverlay`, read by the one graph. */
export const gridUniforms = {
	/** The lines' strength (`GRID_STRENGTH` by mode). */
	strength: T.uniform(0),
	/** 1 in explore mode (lines only round the focus), else 0. */
	local: T.uniform(0),
	/** The focus cells' centres, in cells (the hovered cell, the selected token's); far when none. */
	focusA: T.uniform(FAR.clone()),
	focusB: T.uniform(FAR.clone()),
	/** The highlighted cell, and its pattern (`HIGHLIGHT_PATTERN`, 0 none) and colour. */
	hover: T.uniform(FAR.clone()),
	pattern: T.uniform(0),
	highlight: T.uniform(new THREE.Color())
};
const u = gridUniforms as unknown as Record<keyof typeof gridUniforms, N>;
const cells = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;

/** The cell overlay's texels (#285, cell-overlay.ts), a blank until `GridOverlay` sets its own. */
const BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
BLANK.needsUpdate = true;
export const overlayMap = texture(
	BLANK,
	min(max(loose(cellUV).mul(cells.gridSize), 0.5), cells.gridSize.sub(0.5)).div(MAP_SIDE)
) as unknown as N & { value: THREE.Texture };

/** `1 - smoothstep(a, b, x)`: GLSL leaves a reversed smoothstep undefined. */
const below = (a: N | number, b: N | number, x: N) => float(1).sub(smoothstep(a, b, x));

/** Golus's pristine grid, both axes at once (grid-modes.ts `lineCoverage`), then combined. */
function lines(at: N): N {
	const deriv = max(
		vec2(length(vec2(dFdx(at.x), dFdy(at.x))), length(vec2(dFdx(at.y), dFdy(at.y)))),
		vec2(1e-6)
	);
	const drawWidth = min(max(deriv, vec2(LINE_WIDTH)), vec2(0.5));
	const aa = deriv.mul(1.5);
	const g = float(1).sub(abs(fract(at).mul(2).sub(1)));
	const line = below(drawWidth.sub(aa), drawWidth.add(aa), g).mul(
		clamp(vec2(LINE_WIDTH).div(drawWidth), 0, 1)
	);
	const blend = clamp(deriv.mul(2).sub(1), 0, 1);
	const faded = mix(line, vec2(LINE_WIDTH), blend);
	return mix(faded.x, float(1), faded.y);
}

/** The highlight's coverage at `p` (0-1 across the cell) for the pattern uniform, antialiased. */
function highlightCover(p: N): N {
	const edge = min(min(p.x, float(1).sub(p.x)), min(p.y, float(1).sub(p.y)));
	const w = max(fwidth(edge), 1e-5);
	const inside = smoothstep(float(PATTERN_INSET).sub(w), float(PATTERN_INSET).add(w), edge);
	const diagonal = p.x.add(p.y).mul(HATCH_STRIPES);
	const hw = max(fwidth(diagonal), 1e-5);
	const tri = abs(fract(diagonal).sub(0.5));
	const stripe = smoothstep(float(0.25).sub(hw), float(0.25).add(hw), tri);
	const arm = max(min(p.x, float(1).sub(p.x)), min(p.y, float(1).sub(p.y)));
	const band = PATTERN_INSET + BRACKET_BAND;
	const bracket = below(float(BRACKET_ARM).sub(w), float(BRACKET_ARM).add(w), arm).mul(
		below(float(band).sub(w), float(band).add(w), edge)
	);
	const is = (k: number) => float(abs(u.pattern.sub(k)).lessThan(0.5));
	const cover = is(1).add(is(2).mul(stripe)).add(is(3).mul(bracket));
	const opacity = is(1)
		.mul(PATTERN_OPACITY[1])
		.add(is(2).mul(PATTERN_OPACITY[2]))
		.add(is(3).mul(PATTERN_OPACITY[3]));
	return inside.mul(cover).mul(opacity);
}

/**
 * The reach, range, path and area layers (#285) at the fragment: each channel's smooth 0-1 value
 * from the bilinear sample gives a fill (above 0.5) and a contour where it crosses 0.5, in the
 * channel's colour; patterns tell them apart without it (reach solid, range dashed, path dotted,
 * areas hatched). Returns the layers' colour and coverage.
 */
function overlayLayers(world: N, at: N): { rgb: N; alpha: N } {
	const sample = overlayMap;
	const along = world.x.add(world.z).div(cells.cellSize);
	const dashes = (perCell: number) => {
		const t = abs(fract(along.mul(perCell)).sub(0.5));
		const w = max(fwidth(t), 1e-4);
		return smoothstep(float(0.25).sub(w), float(0.25).add(w), t);
	};
	const stripe = (() => {
		const d = at.x.add(at.y).mul(AREA_STRIPES);
		const w = max(fwidth(d), 1e-4);
		return smoothstep(float(0.25).sub(w), float(0.25).add(w), abs(fract(d).sub(0.5)));
	})();
	const pattern = [float(1), dashes(DASHES_PER_CELL), dashes(DASHES_PER_CELL * 2), float(1)];
	let colour: N = loose(T.color(0x000000));
	let sum: N = float(0);
	let clear: N = float(1);
	CHANNELS.forEach((name, i) => {
		const v = [sample.x, sample.y, sample.z, sample.w][i];
		const half = max(float(CONTOUR_WIDTH * 0.5), fwidth(v));
		const edge = below(0, half, abs(v.sub(0.5)));
		const fill = smoothstep(0.45, 0.55, v).mul(FILL_OPACITY[name]);
		const filled = i === 3 ? fill.mul(stripe) : fill;
		const a = max(filled, edge.mul(pattern[i]).mul(CONTOUR_OPACITY));
		colour = colour.add(loose(T.color(CHANNEL_COLOUR[name])).mul(a));
		sum = sum.add(a);
		clear = clear.mul(float(1).sub(a));
	});
	return { rgb: colour.div(max(sum, 1e-4)), alpha: float(1).sub(clear) };
}

let graph: { colorNode: N; opacityNode: N; outputNode: N } | null = null;

/** The `grid` variant's nodes (kinds.ts), built once. */
export function gridGraph(): { colorNode: N; opacityNode: N; outputNode: N } {
	if (graph) return graph;
	const world = loose(positionWorld);
	const at = loose(cellUV).mul(cells.gridSize); // in cells: integers are the lines
	const up = smoothstep(0.5, 0.8, loose(normalWorldGeometry).y);
	const floorIndex = floor(loose(groundFlat).x.mul(255).add(0.5));
	const notVoid = float(abs(floorIndex.sub(VOID)).greaterThan(0.5));
	const fromCamera = distance(loose(cameraPosition), world).div(cells.cellSize);
	const fade = below(FADE_NEAR, FADE_FAR, fromCamera);
	const near = min(distance(at, u.focusA), distance(at, u.focusB));
	const local = mix(float(1), below(EXPLORE_INNER, EXPLORE_RADIUS, near), u.local);
	const shown = up.mul(loose(onGrid));
	const gridA = lines(at)
		.mul(GRID_OPACITY)
		.mul(u.strength)
		.mul(local)
		.mul(fade)
		.mul(notVoid)
		.mul(shown)
		.mul(worldFog());
	const inCell = float(abs(floor(at).x.sub(u.hover.x)).lessThan(0.5)).mul(
		float(abs(floor(at).y.sub(u.hover.y)).lessThan(0.5))
	);
	const visible = float(1).sub(worldHidden());
	const hlA = highlightCover(fract(at)).mul(inCell).mul(shown).mul(visible);
	const ov = overlayLayers(world, at);
	const ovA = ov.alpha.mul(shown).mul(visible).mul(notVoid);
	const under = hlA.add(gridA.mul(float(1).sub(hlA)));
	const alpha = ovA.add(under.mul(float(1).sub(ovA)));
	const share = hlA.div(max(under, 1e-4));
	const rgb = mix(
		mix(loose(T.color(GRID_COLOR)), u.highlight, share),
		ov.rgb,
		ovA.div(max(alpha, 1e-4))
	);
	const above = world.y.greaterThan(cells.cutY);
	const outputNode = Fn(() => {
		If(above, () => {
			Discard();
		});
		return vec4(rgb, alpha);
	})();
	graph = { colorNode: vec4(rgb, 1), opacityNode: alpha, outputNode };
	return graph;
}
