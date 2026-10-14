// Weather in the sound (#325), a lazy chunk: the room page fetches it with the first change of the
// table (`hear`), so the audio code the page holds statically does not grow. It adds a bed under
// the place's ambience (rain, wind or both, on the ambience bus, so the Sound menu's ambience level
// applies), crossfaded within FADE when the bed changes and only retargeted in gain when the
// intensity does, and thunder on the effects bus (so a muted mix is silent) for each strike of the
// seeded lightning schedule (game/lightning.ts), `thunderDelayMs` after the strike on the server's
// clock: every client hears it at the picture's moment plus the same delay. All synthesized,
// presentation only, nothing sent. The music is untouched.

import { manifestNow, loadManifest } from '../assets/load';
import { strikeShare, thunderBetween, type WeatherNow } from '../game/lightning';
import { useServerClock, serverNow } from '../net/server-now';
import { resolveSky } from '../assets/sky-parse';
import type { WorldLook } from '../game/world';
import { audioGraph, loop, ticks, type Graph } from './engine';
import { LEVEL_GAIN, thunderLook, weatherSoundFor, type WeatherBed } from './weather';

const FADE = 2.5;
/** Thunder is scheduled on the audio clock this far ahead of the conductor's tick. */
const AHEAD_MS = 700;

interface Wanted {
	bed: WeatherBed;
	level: 0 | 1 | 2 | 3;
	/** The weather whose strikes thunder follows; null where it is not heard. */
	thunder: WeatherNow | null;
}

interface Layer {
	bed: WeatherBed;
	/** The bed's loudness by level. */
	level: GainNode;
	/** The crossfade. */
	fade: GainNode;
	stop(): void;
}

let wanted: Wanted = { bed: 'none', level: 0, thunder: null };
let layer: Layer | null = null;
let level = -1;
/** Server time thunder has been scheduled through. */
let through = -Infinity;
let started = false;

/**
 * The table's weather, as it is now: called with each change of the room (cheap when nothing
 * changed). `conn` gives the server's clock, which this also hands to the lightning in the renderer.
 */
export function hear(
	room: { world: WorldLook; environment: string | null },
	adventure: { location: { id: string } } | null,
	conn: { serverTime(): number }
): void {
	const { world, environment } = room;
	const location = adventure?.location.id;
	useServerClock(() => conn.serverTime());
	const manifest = manifestNow();
	if (!manifest) {
		void loadManifest().then(() => hear(room, adventure, conn));
		return;
	}
	const open = resolveSky(world, environment, manifest)?.sky.kind === 'open';
	const { bed, level: bucket } = weatherSoundFor(world.weather, open, location);
	const w = world.weather;
	wanted = {
		bed,
		level: bucket,
		thunder: bed !== 'none' && strikeShare(w) > 0 ? w : null
	};
	if (!started) {
		started = true;
		ticks.push(update);
	}
}

function update(now: number): void {
	const g = audioGraph();
	if (!g) return;
	if (wanted.bed !== (layer?.bed ?? 'none')) {
		if (layer) {
			const old = layer;
			old.fade.gain.setTargetAtTime(0.0001, now, FADE / 3);
			setTimeout(() => old.stop(), FADE * 1000 + 200);
		}
		layer = wanted.bed === 'none' ? null : makeBed(g, wanted.bed);
		layer?.fade.gain.setTargetAtTime(1, now, FADE / 3);
		level = -1;
	}
	if (layer && level !== wanted.level) {
		level = wanted.level;
		layer.level.gain.setTargetAtTime(LEVEL_GAIN[level], now, 0.6);
	}
	thunder(g, now);
}

/** Rain: a hiss at 2-5 kHz and a low patter; wind: low-passed noise on a slow swell. */
function makeBed(g: Graph, bed: Exclude<WeatherBed, 'none'>): Layer {
	const fade = g.ctx.createGain();
	fade.gain.value = 0.0001;
	const gain = g.ctx.createGain();
	gain.gain.value = 0.0001;
	gain.connect(fade).connect(g.buses.ambience);
	const stops: (() => void)[] = [];
	if (bed !== 'wind') {
		stops.push(loop(g, gain, 'bandpass', 3500, 0.2, 0.15));
		stops.push(loop(g, gain, 'lowpass', 900, 0.08, 2.5));
	}
	if (bed !== 'rain') stops.push(loop(g, gain, 'lowpass', bed === 'storm' ? 420 : 520, 0.16, 0.09));
	return {
		bed,
		level: gain,
		fade,
		stop: () => {
			stops.forEach((s) => s());
			fade.disconnect();
		}
	};
}

/** Schedules the thunder due before the next tick: a crack, then a rumble, sent to the reverb. */
function thunder(g: Graph, now: number): void {
	const w = wanted.thunder;
	if (!w) {
		through = -Infinity;
		return;
	}
	const wall = serverNow();
	const to = wall + AHEAD_MS;
	if (through < wall - AHEAD_MS || through > to) through = wall; // first, or the clock jumped
	for (const strike of thunderBetween(w, through, to)) {
		const at = now + Math.max(0, strike.at + strike.thunderDelayMs - wall) / 1000;
		boom(g, at, strike.thunderDelayMs);
	}
	through = to;
}

function boom(g: Graph, at: number, delayMs: number): void {
	const { gain, crack } = thunderLook(delayMs);
	const part = (cutoff: [number, number], length: number, peak: number, attack: number) => {
		const source = g.ctx.createBufferSource();
		source.buffer = g.noise;
		source.loop = true;
		const filter = g.ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(cutoff[0], at);
		filter.frequency.exponentialRampToValueAtTime(cutoff[1], at + length);
		const env = g.ctx.createGain();
		env.gain.setValueAtTime(0.0001, at);
		env.gain.exponentialRampToValueAtTime(peak * gain, at + attack);
		env.gain.exponentialRampToValueAtTime(0.0001, at + length);
		source.connect(filter).connect(env);
		env.connect(g.buses.effects);
		env.connect(g.reverb);
		source.start(at);
		source.stop(at + length + 0.05);
	};
	part([3000 * crack, 250], 0.7, 0.6 * crack, 0.005); // the crack
	part([160, 40], 2.6 + (delayMs - 1000) / 1500, 0.9, 0.2); // the rumble rolling away
}
