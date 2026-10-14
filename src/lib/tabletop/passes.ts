// The pipeline's own passes (post.ts): the prepass, whose normals are 8-bit;
// the overlay's, which keeps the world's depth; and the scene's, which has
// what it reads drawn first.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { GRADE_TONE_MAPPER, type ToneMapper } from '../assets/manifest';
import type { WarmBatch } from './warmup';
import { aoKind, needsPrepass, type AaMode, type AoKind, type QualitySettings } from './quality';

export const TONE_MAPPINGS: Record<ToneMapper, THREE.ToneMapping> = {
	agx: THREE.AgXToneMapping,
	aces: THREE.ACESFilmicToneMapping,
	neutral: THREE.NeutralToneMapping
};

/** What a pipeline is built with: the prepass, the scene pass's MSAA samples, the tone mapper. */
export interface Stages {
	prepass: boolean;
	samples: number;
	/** Antialiasing (#163): TRAA adds velocity and a resolve, SMAA passes before the output stage, FXAA a pass after the grade. */
	aa: AaMode;
	/** Ambient occlusion (#159): SSAO or GTAO, whose passes differ. */
	ao: AoKind;
	/** Compiled into the output stage, so a change rebuilds (#158). */
	toneMapper: ToneMapper;
	/** The heat-haze pass (#326): high and ultra, with a prepass to fade against. */
	haze: boolean;
}

/** The heat-haze pass (haze.ts, a lazy chunk): its draw, the offset it holds and what it compiles. */
export interface HazePass {
	pass: THREE.PassNode;
	/** 1 while a source is in view, else 0: the pass's gate and the offset's multiplier. */
	strength: { value: number };
	/** What the warm-up compiles for it: its quad on its material, in the pass's target (#180). */
	batch: WarmBatch;
	/** The picture's offset at the fragment, in screen UV (0 while off). */
	warp: THREE.Node<'vec2'>;
	dispose(): void;
}

/**
 * The stages settings call for. The overlay tests depth against a pass without MSAA: the prepass
 * (drawn with MSAA or AO on, `needsPrepass`), else the scene pass itself.
 */
export function stagesFor(settings: QualitySettings): Stages {
	return {
		prepass: needsPrepass(settings),
		samples: settings.msaa,
		aa: settings.aa,
		ao: aoKind(settings),
		toneMapper: settings.toneMapper ?? GRADE_TONE_MAPPER,
		haze: (settings.tier === 'high' || settings.tier === 'ultra') && needsPrepass(settings)
	};
}

/** Something to compile the table's materials for: a pass's target and outputs. */
export interface PassTarget {
	renderTarget: THREE.RenderTarget;
	/** Null for a pass with one output (the overlay's). */
	mrt: THREE.MRTNode | null;
	/**
	 * The pass, whose context (the scene pass's AO) changes what its lit materials compile to, and
	 * whose `drawsFirst` (the prepass and the AO) must not draw while they compile (`drawnFirst`).
	 */
	pass?: THREE.PassNode;
}

/**
 * The opaque prepass: its colour attachment holds view normals, which fit in 8 bits.
 * `PassNode.setup` resets that attachment to the renderer's output type on every build,
 * so the 8-bit type is put back after it.
 */
export class PrePassNode extends THREE.PassNode {
	setup(builder: THREE.NodeBuilder) {
		const node = super.setup(builder);
		this.renderTarget.texture.type = THREE.UnsignedByteType;
		return node;
	}
}

/**
 * The overlay's pass: it keeps the world's depth (the depth source's texture, not cleared) and
 * has that pass drawn first; NodeFrame draws a pass once a frame, however often it is asked.
 */
export class OverlayPassNode extends THREE.PassNode {
	constructor(
		scene: THREE.Scene,
		camera: THREE.Camera,
		private readonly depthFrom: THREE.PassNode
	) {
		super(THREE.PassNode.COLOR, scene, camera, {
			samples: 0,
			depthTexture: depthFrom.renderTarget.depthTexture!
		});
		this.name = 'overlay';
		this.autoClearDepth = false;
	}

	updateBefore(frame: THREE.NodeFrame) {
		frame.updateBeforeNode(this.depthFrom);
		return super.updateBefore(frame);
	}
}

/**
 * The scene pass: it has what it reads drawn first, the prepass and then the AO, each once a frame.
 * Three keys a pass's render context by how deeply it is nested, so a prepass drawn sometimes from
 * here and sometimes from inside another pass (the AO's, or the overlay's) would compile all its
 * materials twice; and an AO drawn from inside the scene's own draw, when a material first asks for
 * it, made WebGPU pipelines for the wrong targets, which aborted the frame.
 */
export class ScenePassNode extends THREE.PassNode {
	drawsFirst: THREE.Node[] = [];

	updateBefore(frame: THREE.NodeFrame) {
		for (const node of this.drawsFirst) frame.updateBeforeNode(node);
		return super.updateBefore(frame);
	}
}

type Flow = { getFlowContextData(): Record<string, unknown> };
type Cached = {
	_contextNodeCache: { version: number; context: THREE.ContextNode<unknown> } | null;
};

/**
 * The context `pass` draws its materials in, or null without one: the very node
 * `PassNode.updateBefore` makes and caches (three r186's `_contextNodeCache`, made here first if
 * it has not drawn yet), so a warm-up compiles the render objects a draw then finds.
 */
export function passContext(
	renderer: THREE.WebGPURenderer,
	pass: THREE.PassNode
): THREE.ContextNode<unknown> | null {
	if (!pass.contextNode) return null;
	const p = pass as unknown as Cached & { version: number };
	if (p._contextNodeCache?.version !== p.version) {
		const flow = (node: THREE.ContextNode<unknown>) =>
			(node as unknown as Flow).getFlowContextData();
		const context = T.context({ ...flow(renderer.contextNode), ...flow(pass.contextNode) });
		p._contextNodeCache = { version: p.version, context };
	}
	return p._contextNodeCache!.context;
}

/**
 * What `pass` draws first (the scene pass's prepass and AO): a compile runs its materials' nodes'
 * `updateBefore`, so while they compile in the AO's context each would draw the whole prepass.
 */
export const drawnFirst = (pass: THREE.PassNode): readonly THREE.Node[] =>
	pass instanceof ScenePassNode ? pass.drawsFirst : [];

/**
 * What glows: the emissive attachment, plus the exposed HDR colour above 1 with a soft knee
 * (quadratic from 1 - knee to 1 + knee, as Unity's bloom), by the brightest channel.
 */
export function bloomInput(scenePass: THREE.PassNode, exposure: THREE.Node<'float'>, knee: number) {
	const hdr = scenePass.getTextureNode('output').rgb.mul(exposure);
	const bright = T.max(hdr.r, T.max(hdr.g, hdr.b));
	const soft = T.clamp(bright.sub(1 - knee), 0, 2 * knee);
	const curve = soft.mul(soft).div(4 * knee);
	const excess = T.max(curve, bright.sub(1)).div(T.max(bright, 1e-4));
	return T.vec4(scenePass.getTextureNode('emissive').rgb.add(hdr.mul(excess)), 1);
}

/**
 * The prepass pipeline stage: view normals, and for TRAA each pixel's motion (half-float, cloned
 * from the colour texture before that turns 8-bit); its depth is the overlay's, the AO's and the
 * soft particles' (#326).
 */
export function buildPrepass(
	scene: THREE.Scene,
	camera: THREE.Camera,
	aa: AaMode,
	halfFloat: THREE.TextureDataType
): PrePassNode {
	const prepass = new PrePassNode(THREE.PassNode.COLOR, scene, camera, { samples: 0 });
	prepass.name = 'prepass';
	prepass.transparent = false;
	const normals = T.packNormalToRGB(T.normalView);
	prepass.setMRT(
		T.mrt(aa === 'traa' ? { output: normals, velocity: T.velocity } : { output: normals })
	);
	if (aa === 'traa') prepass.getTexture('velocity').type = halfFloat;
	prepass.renderTarget.texture.type = THREE.UnsignedByteType;
	return prepass;
}
