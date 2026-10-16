// The lobby's warm-up (#180) from the renderer chunk: lobby.ts is a lazy chunk of its own (`lobby`
// in scripts/check-bundle.mjs) since M74, fetched by the landing page's idle warm-up. The pipeline
// shape rules it needs are handed in from here rather than imported there: shape.ts is shared by
// the room page, and a lazy chunk importing it split it out of the page's chunk, costing the room
// page a chunk of its own.

import { initialShape, sameShape, shapeOf, startingSettings, type Shape } from './shape';
import type { WarmRenderer } from './lobby';

export type { Shape };
/** What `warmLobby` decides the pipeline's shape with (shape.ts). */
export type ShapeRules = {
	initialShape: typeof initialShape;
	sameShape: typeof sameShape;
	shapeOf: typeof shapeOf;
	startingSettings: typeof startingSettings;
};

/** Makes the renderer and warms it up (lobby.ts `warmLobby`); null where it would not help. */
export const warmLobby = (
	options: Parameters<typeof import('./lobby').warmLobby>[0] = {}
): Promise<WarmRenderer | null> =>
	import('./lobby').then((m) =>
		m.warmLobby(options, { initialShape, sameShape, shapeOf, startingSettings })
	);
