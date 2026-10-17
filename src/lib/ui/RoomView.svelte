<script lang="ts">
	import { asset } from '$app/paths';
	import { areaCells, canReach, inActionRange } from '$lib/adventure/adventure';
	import { actionOf, STATUSES, type CharacterId } from '$lib/adventure/characters';
	import type { ChatMessage } from '$lib/game/chat';
	import { gridDistance, type GridPos } from '$lib/game/grid';
	import {
		alignToAxis,
		objectOnEdge,
		walkDistance,
		segmentProblem,
		type Door,
		type SceneObject
	} from '$lib/game/objects';
	import { canMoveToken, canUseDoor } from '$lib/game/permissions';
	import type { Role } from '$lib/game/protocol';
	import { tokenAt } from '$lib/game/token';
	import { roomAround, roomBoundary } from '$lib/game/rooms';
	import { cellIndex, decodeMask } from '$lib/game/visibility';
	import type { RoomConnection } from '$lib/net/room-connection.svelte';
	import { timeNow, type WorldLook } from '$lib/game/world';
	import Tabletop from '$lib/tabletop/Tabletop.svelte';
	import type { CuePlay, FloatText } from '$lib/tabletop/types';
	import type { CameraHold } from '$lib/tabletop/camera-rig';
	import {
		decodeFloor,
		FLOORS,
		type FloorId,
		decodeGrass,
		GRASS_DENSITIES,
		GRASS_HEIGHTS
	} from '$lib/game/floor';
	import { decodeLevels } from '$lib/game/terrain';
	import type { DiceThrow } from '$lib/tabletop/dice3d';
	import { diceToThrow } from '$lib/tabletop/dice-throw';
	import { ringsFor } from '$lib/tabletop/bases';
	import type { CameraView, HighlightKind, Pick, PreviewItem } from '$lib/tabletop/types';
	import { DEFAULT_LIGHT_RADIUS, LIGHT_COLORS, type Light } from '$lib/game/lights';
	import {
		ASSETS,
		footprintCells,
		footprintSize,
		obstaclesFor,
		placementProblem,
		propAt,
		type Prop,
		type Rotation
	} from '$lib/game/props';
	import { play, setAmbience, setMusic } from '$lib/audio/engine';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { fade, fly } from 'svelte/transition';
	import { ambienceFor, musicFor, SILENCE, soundsFor, type AudioState } from '$lib/audio/cues';
	import type { VfxState, VfxTracker } from '$lib/tabletop/vfx-cues';
	import ActionBar from './ActionBar.svelte';
	import AudioControls from './AudioControls.svelte';
	import { Backdrop, Icon, Portrait, type IconName } from '$lib/ui/game';
	import DiceSlot from './hud/DiceSlot.svelte';
	import IdentityPlate from './hud/IdentityPlate.svelte';
	import Notice from './hud/Notice.svelte';
	import RollCard, { momentOf } from './hud/RollCard.svelte';
	import RoomPlate from './hud/RoomPlate.svelte';
	import Satchel, { type SatchelTab } from './hud/Satchel.svelte';
	import TurnRibbon from './hud/TurnRibbon.svelte';
	import AdventurePanel from './AdventurePanel.svelte';
	import Decision from './Decision.svelte';
	import BuildPanel, { type BuildTool, type LightDraft, type PropDraft } from './BuildPanel.svelte';
	import type { GrassDraft } from './GrassPaint.svelte';
	import CharacterSelect from './CharacterSelect.svelte';
	import CharacterSheet from './CharacterSheet.svelte';
	import TutorialCoach from './TutorialCoach.svelte';
	import Welcome from './Welcome.svelte';
	import {
		currentStep,
		loadProgress,
		NEW_PLAYER,
		record,
		saveProgress,
		signalOf,
		type Signal,
		type TutorialProgress
	} from './tutorial';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import PropInspector from './PropInspector.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import TokenPanel, { type TokenDraft } from './TokenPanel.svelte';
	import GraphicsControls from './GraphicsControls.svelte';
	import CutBar, { AUTO_CUT, type Cut } from './CutBar.svelte';
	import { stepCut } from '$lib/tabletop/cut';
	import { gridModeOf } from './grid';
	import { TIPS } from '$lib/tabletop/TableLoading.svelte';
	import { overlayCells } from './reach';
	import { CAMERA_MODES, cameraSubject, parseView } from '$lib/tabletop/camera-modes';
	import { walkPlan } from './walk-plan';
	import { withGridSetting } from '$lib/tabletop/grid-modes';
	import { FLOAT_COLOURS } from '$lib/tabletop/labels';
	import { cameraActionForKey, cameraActionsForKey, toolForKey, type CameraAction } from './keys';
	import ControlsHelp from './ControlsHelp.svelte';
	import {
		loadGraphics,
		saveGraphics,
		type Backend,
		type GraphicsPrefs,
		type Tier
	} from '$lib/tabletop/quality';

	let { conn }: { conn: RoomConnection } = $props();

	// `?perf`: a measuring script drives the room from the page (it sends only what a player could).
	$effect(() => {
		if (!new URLSearchParams(location.search).has('perf')) return;
		(window as { thirdfoldRoom?: RoomConnection }).thirdfoldRoom = conn;
		return () => delete (window as { thirdfoldRoom?: RoomConnection }).thirdfoldRoom;
	});

	/** How close (in cells) the pointer must be to a grid line to target the wall or door on it. */
	const EDGE_REACH = 0.22;

	// Local UI state only. Shared state lives in conn.room and changes only via server broadcasts.
	/** Graphics settings (quality.ts), this browser's only: never sent to the room. */
	let graphics = $state<GraphicsPrefs>(loadGraphics(localStorage));
	/** The cut plane (#281): auto, following the camera, or locked by the height bar. */
	let cut = $state<Cut>(AUTO_CUT);
	/** The tier and backend the table draws with, for the Graphics menu to show. */
	let effectiveQuality = $state<{ tier: Tier; backend: Backend } | null>(null);

	function changeGraphics(next: GraphicsPrefs): void {
		graphics = next;
		// Keep what the table measured for this device (quality refinement) alongside.
		saveGraphics(localStorage, { ...loadGraphics(localStorage), ...next });
	}

	/** The camera view, remembered in this browser so a refresh keeps it. */
	let view = $state<CameraView>(savedView());
	/** Follow eases to the mini whose turn it is, when the viewer can see it (#289). */
	let followTurns = $state(false);

	/** The stored view, migrated (tabletop is explore, tactical and the rest overview, #289). */
	function savedView(): CameraView {
		try {
			return parseView(localStorage.getItem('thirdfold:view'));
		} catch {
			return 'overview';
		}
	}

	$effect(() => {
		try {
			localStorage.setItem('thirdfold:view', view);
		} catch {
			// Storage unavailable: the view just isn't remembered.
		}
	});

	/** Narrow screens (a phone): one panel at a time, as a bottom sheet over the table. */
	const phone = new MediaQuery('max-width: 48rem');

	/** The camera views (#289): the button's label, what it does, and its icon. */
	const VIEW_BUTTONS: { id: CameraView; label: string; hint: string; icon: IconName }[] = [
		{
			id: 'overview',
			label: 'Overview',
			hint: 'Overview: look down on the whole table to plan your moves',
			icon: 'map'
		},
		{
			id: 'explore',
			label: 'Explore',
			hint: 'Explore: come down to the miniatures and look around',
			icon: 'compass'
		},
		{
			id: 'eye',
			label: 'Eye level',
			hint: 'Eye level: stand at your mini and see what it sees',
			icon: 'eye'
		},
		{
			id: 'follow',
			label: 'Follow',
			hint: 'Follow: the camera trails the mini you picked',
			icon: 'cursor'
		}
	];

	/** The satchel: which panel it shows and whether it is unfolded; remembered in this browser. */
	type SatchelState = { tab: string; open: boolean };
	let satchel = $state<SatchelState>(savedSatchel());

	function savedSatchel(): SatchelState {
		try {
			const saved = JSON.parse(localStorage.getItem('thirdfold:satchel') ?? '{}');
			return {
				tab: typeof saved.tab === 'string' ? saved.tab : 'story',
				open: saved.open !== false
			};
		} catch {
			return { tab: 'story', open: true };
		}
	}

	$effect(() => {
		try {
			localStorage.setItem('thirdfold:satchel', JSON.stringify(satchel));
		} catch {
			// Storage unavailable: the satchel just opens at the story again.
		}
	});

	/** The chat scroll, unfolded or folded to its bell (a phone shows it as a sheet instead). */
	let chatFolded = $state(savedChatFolded());

	function savedChatFolded(): boolean {
		try {
			return localStorage.getItem('thirdfold:chat-folded') === 'true';
		} catch {
			return false;
		}
	}

	$effect(() => {
		try {
			localStorage.setItem('thirdfold:chat-folded', String(chatFolded));
		} catch {
			// Storage unavailable: the chat just opens unfolded again.
		}
	});

	/** Seconds until the next reconnect try, ticking while we wait. */
	let now = $state(Date.now());
	$effect(() => {
		if (conn.status !== 'reconnecting') return;
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});
	const retryIn = $derived(
		conn.retryAt === null ? null : Math.max(0, Math.ceil((conn.retryAt - now) / 1000))
	);
	let tool = $state<BuildTool>('select');
	let selectedId = $state<string | null>(null);
	let placing = $state<TokenDraft | null>(null);
	/** GM: the kind of enemy the next click on the table brings on. */
	let spawning = $state<string | null>(null);
	/** What is being placed is held for the GM's own fight (it spots nobody until the GM starts it). */
	let spawnHold = $state(false);
	/** Its name, for a monster not yet in the story. */
	let spawnName = $state<string | null>(null);
	let hover = $state<Pick | null>(null);
	/** The mini being dragged (#287): it stands for the selection until it is set down. */
	let dragging = $state<string | null>(null);
	/** The table, for the camera keys (#279). */
	let table = $state<ReturnType<typeof Tabletop> | null>(null);
	/** A left press on empty ground, to tell a drag (#279). */
	let press: PointerEvent | null = null;
	/** First corner of the wall being drawn. */
	let wallStart = $state<GridPos | null>(null);
	/** First cell of the area being revealed, hidden or shaped. */
	let areaStart = $state<GridPos | null>(null);
	/** The level the GM's height tool sets. */
	let heightLevel = $state(5);
	/** The floor the GM's floor tool paints. */
	let floorDraft = $state<FloorId>('stone');
	/** The grass the floor tool paints instead (M74), or null to paint floors. */
	let grassDraft = $state<GrassDraft | null>(null);

	let lightDraft = $state<LightDraft>({
		kind: 'torch',
		radius: DEFAULT_LIGHT_RADIUS,
		color: LIGHT_COLORS[0].color
	});
	let propDraft = $state<PropDraft>({ assetId: 'table', rotation: 0 });
	let selectedPropId = $state<string | null>(null);
	/** The light the GM is editing in the light inspector. */
	let selectedLightId = $state<string | null>(null);
	/** A light put back by undo that was off: switched off again once it reappears. */
	let restoringLight: { pos: GridPos; known: Set<string> } | null = null;
	let copied = $state(false);
	let toast = $state<string | null>(null);
	/** A one-step undo offered with the toast (a deleted prop, put back). */
	let undo = $state<{ label: string; run: () => void } | null>(null);
	/** A prop put back by undo: its scale and hidden flag follow once it reappears. */
	let restoring: (Prop & { known: Set<string> }) | null = null;
	/** Small screens show one panel at a time over the table. */
	let sheet = $state<'table' | 'side' | 'chat'>('table');
	let barHeight = $state(0);
	/** Where tokens are announced to screen readers after a keyboard move. */
	let moved = $state('');
	let rollCard = $state<RollEntry | null>(null);
	/** The roll being thrown as 3D dice; its card shows once they land. */
	let diceThrow = $state<DiceThrow | null>(null);
	let pendingCard: RollEntry | null = null;
	/** The end-of-section screen the viewer closed to look around (by stage and time). */
	let dismissedEnd = $state<string | null>(null);
	/** An action of my character waiting for a target. */
	let targeting = $state<string | null>(null);
	/** The slot level a spell being aimed is cast with (the action bar's choice); null for the lowest. */
	let castSlot = $state<number | null>(null);
	let sheetOpen = $state(false);
	/** Another party member's sheet, opened from the party list (the GM's, or a player's look). */
	let sheetFor = $state<string | null>(null);
	/** The character just taken, to introduce. */
	let introFor = $state<CharacterId | null>(null);
	/** My character as last seen; undefined until the room has loaded. */
	let knownCharacter: CharacterId | null | undefined = undefined;
	let floats = $state<FloatText[]>([]);
	/** The names key (N) is held: every name shows (#268). */
	let namesHeld = $state(false);
	/** The grid key (G) is held: the full grid shows (#279). */
	let gridHeld = $state(false);
	let floatSeq = 0;
	let cardTimer: ReturnType<typeof setTimeout> | undefined;
	// Only rolls that arrive while we're here pop up; history in the snapshot does not.
	let lastAnnouncedSeq: number | null = null;

	type RollEntry = Extract<ChatMessage, { kind: 'roll' | 'attack' | 'ability' | 'check' }>;

	const room = $derived(conn.room);
	// The GM's running clock (#324): the hour extrapolated from the server's anchor and offset,
	// drawn about once a second (every 30 s on the power saver). Only the server moves the band.
	const clockRuns = $derived(!!room && room.timeAt != null && room.world.rate > 0);
	let clockNow = $state(0);
	$effect(() => {
		if (!clockRuns) return;
		clockNow = conn.serverTime();
		const id = setInterval(
			() => (clockNow = conn.serverTime()),
			graphics.powerSaver ? 30_000 : 1000
		);
		return () => clearInterval(id);
	});
	const hour = $derived(room ? timeNow(room.world, clockRuns ? room.timeAt! : null, clockNow) : 0);
	const liveWorld = $derived<WorldLook | null>(
		room && clockRuns ? { ...room.world, time: hour } : (room?.world ?? null)
	);
	const FOG_TOOLS: BuildTool[] = ['reveal', 'hide', 'reveal-room', 'hide-room'];
	/** Every edge that closes off a room, for the room tools' preview. */
	const boundary = $derived(room ? roomBoundary(room.objects) : new Set<string>());
	/** The walled room under the cursor while a room tool is out, or null over open ground. */
	const hoveredRoom = $derived(
		room && hover?.cell && (tool === 'reveal-room' || tool === 'hide-room')
			? roomAround(room.grid, boundary, hover.cell)
			: null
	);

	/** Cell indices as horizontal runs, one rectangle per run, for drawing. */
	function rowRuns(cells: readonly number[], width: number): [GridPos, GridPos][] {
		const sorted = [...cells].sort((a, b) => a - b);
		const runs: [GridPos, GridPos][] = [];
		for (const i of sorted) {
			const at = { x: i % width, y: Math.floor(i / width) };
			const last = runs.at(-1);
			if (last && last[1].y === at.y && last[1].x === at.x - 1) last[1] = at;
			else runs.push([at, at]);
		}
		return runs;
	}
	const me = $derived(conn.me);

	/** A new player's way into the game (see tutorial.ts): the welcome, then learning by doing. */
	let tutorial = $state<TutorialProgress>(NEW_PLAYER);
	let tutorialRoom: string | null = null;
	$effect(() => {
		const id = room?.id;
		if (!id || me?.role !== 'player' || tutorialRoom === id) return;
		tutorialRoom = id;
		tutorial = loadProgress(localStorage, id);
	});

	function setTutorial(next: TutorialProgress) {
		tutorial = next;
		if (room) saveProgress(localStorage, room.id, next);
	}

	function learned(signal: Signal) {
		if (me?.role !== 'player') return;
		const next = record(tutorial, signal);
		if (next !== tutorial) setTutorial(next);
	}

	/** Sends an action to the server, noting what the tutorial is waiting for. */
	function act(action: RoomAction): boolean {
		const sent = conn.send(action);
		const kindOf = (id: string) => adventure?.interactables.find((o) => o.id === id)?.kind;
		const signal = sent ? signalOf(action, kindOf) : null;
		if (signal) learned(signal);
		return sent;
	}
	const isGm = $derived(me?.role === 'gm');
	/** The GM's seat has no connection right now. */
	const gmAway = $derived(!!room?.players.some((p) => p.role === 'gm' && !p.connected));
	const adventure = $derived(room?.adventure ?? null);
	/** The others in play, whom a character may hand things to. */
	function partyFor(id: string): { id: string; name: string }[] {
		return (adventure?.characters ?? [])
			.filter((c) => c.inPlay && c.id !== id && !c.dead)
			.map((c) => ({ id: c.id, name: c.def.name }));
	}
	const sheetShown = $derived(
		(sheetFor && adventure?.characters.find((c) => c.id === sheetFor && c.inPlay)) || null
	);
	const myCharacter = $derived(
		(me && adventure?.characters.find((c) => c.inPlay && c.playerId === me.id)) || null
	);
	const myCharacterToken = $derived(
		(myCharacter && room?.tokens.find((t) => t.id === myCharacter.tokenId)) || null
	);
	/** Cells my character may still move this round, while a fight is on and it is selected. */
	const movesLeft = $derived.by(() => {
		const encounter = adventure?.encounter;
		if (!encounter || !myCharacter || focusId !== myCharacter.tokenId) return null;
		// Only on its own turn, and only as far as this turn allows (half when slowed).
		if (encounter.order[encounter.current]?.characterId !== myCharacter.id) return 0;
		return Math.max(0, encounter.speed - (encounter.moved[myCharacter.id] ?? 0));
	});
	/** Whose turn it is in a fight, when this viewer can see their token. */
	const active = $derived.by(() => {
		const encounter = adventure?.encounter;
		const up = encounter?.order[encounter.current];
		return up?.tokenId ? { tokenId: up.tokenId, enemy: up.kind === 'enemy' } : null;
	});
	/** Each token's ring (#265): its owner's seat colour, red for the fight's enemies. */
	const rings = $derived(
		ringsFor(room?.tokens ?? [], {
			players: room?.players ?? [],
			viewer: me?.id ?? null,
			enemies: new Set(adventure?.encounter?.enemies.map((e) => e.tokenId))
		})
	);
	/** Fallen characters' tokens, drawn lying down. */
	const fallen = $derived(
		(adventure?.characters ?? []).flatMap((c) =>
			c.tokenId && (c.downed || c.dead) ? [c.tokenId] : []
		)
	);
	const endKey = $derived(
		adventure && (adventure.stage === 'complete' || adventure.stage === 'defeat')
			? `${adventure.stage}:${adventure.completedAt ?? adventure.begunAt}`
			: null
	);
	const hoverCell = $derived(hover?.cell ?? null);
	/** The ground's levels as far as this client knows them; null for a flat table. */
	const darkness = $derived(
		room?.darkness ? decodeMask(room.darkness, room.grid.width * room.grid.height) : null
	);
	/** Whether a cell is in one of the table's dark areas. */
	const isDark = (cell: GridPos) =>
		!!room && !!darkness && darkness[cellIndex(room.grid, cell)] === 1;
	/** The roofed cells this client knows (#203), or null for none. */
	const interior = $derived(
		room?.interior ? decodeMask(room.interior, room.grid.width * room.grid.height) : null
	);
	const isRoofed = (cell: GridPos) =>
		!!room && !!interior && interior[cellIndex(room.grid, cell)] === 1;
	const floor = $derived(
		room?.floor ? decodeFloor(room.floor, room.grid.width * room.grid.height) : null
	);
	const grass = $derived(
		room?.grass ? decodeGrass(room.grass, room.grid.width * room.grid.height) : null
	);
	const terrain = $derived(
		room?.terrain ? decodeLevels(room.terrain, room.grid.width * room.grid.height) : null
	);
	const blocked = $derived(
		room ? obstaclesFor(room.grid, room.objects, room.props, terrain, floor) : new Set<string>()
	);
	/** The last cinematic cue in the log, to play once. */
	let cuePlay = $state<CuePlay | null>(null);
	const selectedProp = $derived(
		(isGm && selectedPropId && room?.props.find((p) => p.id === selectedPropId)) || null
	);
	const selectedLight = $derived(
		(isGm && selectedLightId && room?.lights.find((l) => l.id === selectedLightId)) || null
	);
	const canMove = (tokenId: string | null) => {
		const token = tokenId && room?.tokens.find((t) => t.id === tokenId);
		return !!(token && me && canMoveToken(me, token));
	};
	// Selection drops by itself if the token is deleted or reassigned away from us.
	const ownTokenIds = $derived(
		room?.tokens.filter((t) => me && t.ownerId === me.id).map((t) => t.id) ?? []
	);
	/** The mini eye level stands at and follow follows: only one the server sent this viewer. */
	const viewSubject = $derived(
		cameraSubject(view, {
			selectedId,
			activeId: active?.tokenId ?? null,
			followTurns,
			visible: new Set(room?.tokens.map((t) => t.id)),
			own: ownTokenIds
		})
	);
	const focusId = $derived(dragging ?? selectedId);

	const selected = $derived(
		focusId && canMove(focusId) ? (room?.tokens.find((t) => t.id === focusId) ?? null) : null
	);
	const occupant = $derived(hoverCell && room ? tokenAt(room.tokens, hoverCell) : undefined);

	/** The wall or door the pointer targets: one it is over in 3D, else one on the grid line it is near. */
	function objectUnder(pick: Pick | null): SceneObject | undefined {
		if (!pick || !room) return undefined;
		if (pick.objectId) return room.objects.find((o) => o.id === pick.objectId);
		if (pick.edge && pick.edgeDistance <= EDGE_REACH) return objectOnEdge(room.objects, pick.edge);
		return undefined;
	}
	/** A light fixture under the pointer, or standing on the pointed-at cell. */
	function lightUnder(pick: Pick | null): Light | undefined {
		if (!pick || !room) return undefined;
		if (pick.lightId) return room.lights.find((l) => l.id === pick.lightId);
		const cell = pick.cell;
		return cell ? room.lights.find((l) => l.pos.x === cell.x && l.pos.y === cell.y) : undefined;
	}

	/** A prop under the pointer, or covering the pointed-at cell. */
	function propUnder(pick: Pick | null): Prop | undefined {
		if (!pick || !room) return undefined;
		if (pick.propId) return room.props.find((p) => p.id === pick.propId);
		return pick.cell ? propAt(room.props, pick.cell) : undefined;
	}

	/** A prop's footprint as a preview rectangle, green where it may stand and red where not. */
	function footprintPreview(placement: Omit<Prop, 'id' | 'scale'>, selfId?: string): PreviewItem[] {
		if (!room) return [];
		const { w, h } = footprintSize(placement.assetId, placement.rotation);
		const problem = placementProblem(room.grid, placement, room.tokens, room.props, selfId);
		return [
			{
				kind: 'area',
				from: placement.pos,
				to: { x: placement.pos.x + w - 1, y: placement.pos.y + h - 1 },
				tone: problem ? 'invalid' : 'valid'
			}
		];
	}

	const doorUnder = (pick: Pick | null): Door | undefined => {
		const o = objectUnder(pick);
		return o?.kind === 'door' ? o : undefined;
	};

	/** The far end of the wall being drawn, snapped onto a row or column through its start. */
	const wallEnd = $derived(
		wallStart && hover?.corner ? alignToAxis(wallStart, hover.corner) : null
	);
	const wallProblem = $derived(
		room && wallStart && wallEnd ? segmentProblem(room.grid, wallStart, wallEnd) : null
	);

	const preview = $derived.by((): PreviewItem[] => {
		if (!hover || placing) return [];
		if (tool === 'wall') {
			if (!wallStart) return hover.corner ? [{ kind: 'corner', at: hover.corner }] : [];
			const items: PreviewItem[] = [{ kind: 'corner', at: wallStart }];
			if (wallEnd && (wallEnd.x !== wallStart.x || wallEnd.y !== wallStart.y)) {
				items.push({
					kind: 'segment',
					a: wallStart,
					b: wallEnd,
					tone: wallProblem ? 'invalid' : 'valid'
				});
			}
			return items;
		}
		if (tool === 'prop' && hover.cell) return footprintPreview({ ...propDraft, pos: hover.cell });
		if (tool === 'select' && selectedProp && hover.cell && hover.propId !== selectedProp.id) {
			return footprintPreview({ ...selectedProp, pos: hover.cell }, selectedProp.id);
		}
		if ((tool === 'reveal' || tool === 'hide') && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: tool }];
		}
		if ((tool === 'reveal-room' || tool === 'hide-room') && hover.cell) {
			const cells = hoveredRoom;
			if (!cells) return [{ kind: 'area', from: hover.cell, to: hover.cell, tone: 'invalid' }];
			return rowRuns(cells, room!.grid.width).map(([from, to]) => ({
				kind: 'area',
				from,
				to,
				tone: tool === 'reveal-room' ? 'reveal' : 'hide'
			}));
		}
		if (tool === 'floor' && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: 'valid' }];
		}
		if (tool === 'height' && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: 'valid' }];
		}
		if (tool === 'dark' && hover.cell) {
			const from = areaStart ?? hover.cell;
			return [{ kind: 'area', from, to: hover.cell, tone: isDark(from) ? 'reveal' : 'hide' }];
		}
		if (tool === 'roof' && hover.cell) {
			// Nothing draws roofs yet, so the tool shows every roofed cell while it is out.
			const roofed = interior ? [...interior.keys()].filter((i) => interior[i]) : [];
			const from = areaStart ?? hover.cell;
			return [
				...rowRuns(roofed, room!.grid.width).map(([a, b]): PreviewItem => ({
					kind: 'area',
					from: a,
					to: b,
					tone: 'valid'
				})),
				{ kind: 'area', from, to: hover.cell, tone: isRoofed(from) ? 'invalid' : 'reveal' }
			];
		}
		if (tool === 'door' && hover.edge) {
			const existing = room && objectOnEdge(room.objects, hover.edge);
			return [
				{ kind: 'segment', ...hover.edge, tone: existing?.kind === 'door' ? 'invalid' : 'door' }
			];
		}
		return [];
	});

	const hoveredObjectId = $derived.by(() => {
		if (placing) return null;
		if (tool === 'erase') return objectUnder(hover)?.id ?? null;
		if (tool === 'select' && !hover?.tokenId) return doorUnder(hover)?.id ?? null;
		return null;
	});

	type AdventureTarget =
		| { kind: 'interact'; id: string; verb: string; name: string; inReach: boolean }
		| {
				kind: 'act';
				actionId: string;
				id: string | null;
				name: string;
				inReach: boolean;
				/** A spell: its slot, and the cell an area is aimed at. */
				cast?: { slot: number | null; at: GridPos | null };
		  };

	/**
	 * What clicking a pick would make my character do, if anything: the action
	 * being aimed, else the basic attack on an enemy, else talking to or
	 * examining something.
	 */
	function adventureTarget(pick: Pick | null): AdventureTarget | null {
		if (!pick || !room || !adventure || !myCharacter || !myCharacterToken || isGm) return null;
		if (myCharacter.downed || myCharacter.dead) return null;
		const def = myCharacter.def;
		const token = pick.tokenId ? room.tokens.find((t) => t.id === pick.tokenId) : undefined;
		const enemy = token && adventure.encounter?.enemies.find((e) => e.tokenId === token.id);
		const ally = token && adventure.characters.find((c) => c.tokenId === token.id && !c.dead);
		const aimed = targeting ? actionOf(def, targeting) : undefined;
		// An area spell is aimed at a cell: whatever stands there, or nothing.
		if (aimed?.cast?.area && pick.cell) {
			return {
				kind: 'act',
				actionId: aimed.id,
				id: null,
				name: aimed.name,
				inReach: true,
				cast: { slot: castSlot, at: pick.cell }
			};
		}
		if (aimed && token && (aimed.target === 'enemy' ? enemy : ally)) {
			const name = `${aimed.name} on ${enemy ? `the ${token.name}` : token.name}`;
			const inReach = inActionRange(blocked, myCharacterToken.pos, token.pos, aimed);
			return {
				kind: 'act',
				actionId: aimed.id,
				id: token.id,
				name,
				inReach,
				...(aimed.cast ? { cast: { slot: castSlot, at: null } } : {})
			};
		}
		if (token && enemy) {
			const basic = def.actions[0];
			const inReach = inActionRange(blocked, myCharacterToken.pos, token.pos, basic);
			const name = `${basic.name} on the ${token.name}`;
			return { kind: 'act', actionId: basic.id, id: token.id, name, inReach };
		}
		// Talking and searching wait until the fight is over (and until play has begun).
		if (adventure.encounter || adventure.stage === 'choosing') return null;
		const prop = !token && pick.propId ? room.props.find((p) => p.id === pick.propId) : undefined;
		const cells = token ? [token.pos] : prop ? footprintCells(prop) : [];
		const thing = adventure.interactables.find((i) =>
			i.cells.some((c) => cells.some((d) => d.x === c.x && d.y === c.y))
		);
		if (!thing) return null;
		const inReach = canReach(blocked, myCharacterToken.pos, thing.cells);
		const [verb] = thing.verbs;
		if (!verb) return null;
		return { kind: 'interact', id: thing.id, verb: verb.id, name: verb.label, inReach };
	}

	/** Floats what an attack or ability did over the tokens involved. */
	function floatResult(entry: RollEntry) {
		if (!room) return;
		const add = (tokenId: string | null | undefined, text: string, color: string) => {
			if (tokenId) floats = [...floats.slice(-19), { id: ++floatSeq, tokenId, text, color }];
		};
		if (entry.kind === 'attack') {
			if (!entry.hit) add(entry.targetId, 'Miss', FLOAT_COLOURS.miss);
			else add(entry.targetId, `-${entry.taken ?? entry.damage?.total ?? 0}`, FLOAT_COLOURS.damage);
			if (entry.effect) add(entry.targetId, entry.effect, FLOAT_COLOURS.effect);
		} else if (entry.kind === 'ability') {
			if (entry.amount !== null && entry.amount !== 0) {
				const color = entry.amount > 0 ? FLOAT_COLOURS.healing : FLOAT_COLOURS.burning;
				add(entry.targetId, `${entry.amount > 0 ? '+' : ''}${entry.amount}`, color);
			} else if (!entry.targetId) {
				// A guard: over the one who raised it.
				add(entry.sourceId, entry.ability, FLOAT_COLOURS.effect);
			}
		}
	}

	function showCard(entry: RollEntry) {
		rollCard = entry;
		floatResult(entry);
		// A natural 20 gets a flourish; the dice themselves already sounded when they landed.
		if (momentOf(entry) === 'crit') play([{ kind: 'ui', sound: 'fanfare' }]);
		vfx?.card(entry.seq);
	}

	const hoveredPropId = $derived.by(() => {
		if (!isGm && hover?.propId && adventureTarget(hover)) return hover.propId;
		if (!isGm || placing) return null;
		if (tool === 'erase' && !objectUnder(hover) && !lightUnder(hover)) {
			return propUnder(hover)?.id ?? null;
		}
		if (tool === 'select' && !selected && !selectedProp && !hover?.tokenId && !doorUnder(hover)) {
			return propUnder(hover)?.id ?? null;
		}
		return null;
	});

	/** Steps for the selected token to walk to the hovered cell (null: no way there). */
	const steps = $derived(
		selected && hoverCell && room && !isGm
			? walkDistance(room.grid, blocked, selected.pos, hoverCell)
			: null
	);
	const reachable = $derived(
		!!selected &&
			!!hoverCell &&
			(isGm || (steps !== null && (movesLeft === null || steps <= movesLeft)))
	);

	/** The cells a player has explored, or null when everything counts (the GM, or no fog). */
	const exploredMask = $derived(
		!isGm && room?.fog.enabled
			? decodeMask(room.fog.explored, room.grid.width * room.grid.height)
			: null
	);
	/** The walk to the hovered cell (#286): players only, for the token they would move. */
	const plan = $derived(
		selected && hoverCell && room && !isGm && tool === 'select' && !placing && !spawning
			? !selectedProp && (!occupant || occupant.id === selected.id)
				? walkPlan({
						grid: room.grid,
						blocked,
						explored: exploredMask,
						from: selected.pos,
						to: hoverCell,
						movesLeft
					})
				: null
			: null
	);
	/** Where a move would end, for the ghost and its count; the GM's drag has a ghost, no count. */
	const pathEnd = $derived(
		plan
			? { tokenId: selected!.id, cell: hoverCell!, label: plan.label }
			: isGm && dragging && selected && hoverCell && !occupant
				? { tokenId: selected.id, cell: hoverCell, label: '' }
				: null
	);
	$effect(() => {
		table?.camera()?.setPathPreview(plan?.cells ?? null, plan?.within ?? 0, pathEnd);
	});
	/** Reach, range and areas over the explored ground (#285, reach.ts): players only for walks. */
	const cellOverlay = $derived.by(() => {
		if (!room) return null;
		const mine = !isGm && !!myCharacter && !!myCharacterToken && focusId === myCharacterToken.id;
		const def = myCharacter ? myCharacter.def : null;
		const basic = adventure?.encounter && active?.tokenId === myCharacterToken?.id;
		const aimId = targeting ?? (basic ? def?.actions[0].id : null);
		const action = !mine || !def || myCharacter?.downed || !aimId ? null : actionOf(def, aimId);
		return overlayCells({
			grid: room.grid,
			blocked,
			explored: exploredMask,
			path: plan?.cells.slice(1),
			walkFrom: mine ? myCharacterToken!.pos : null,
			movesLeft,
			aimFrom: action ? myCharacterToken!.pos : null,
			aim: action,
			area:
				tool === 'prop' && hoverCell && isGm
					? footprintCells({ ...propDraft, pos: hoverCell })
					: undefined
		});
	});
	const highlight = $derived.by((): { cell: GridPos; kind: HighlightKind } | null => {
		if (!hoverCell || tool !== 'select' || selectedProp) return null;
		if (placing || spawning) return { cell: hoverCell, kind: occupant ? 'blocked' : 'place' };
		if (selected && !doorUnder(hover)) {
			const taken = occupant && occupant.id !== selected.id;
			return { cell: hoverCell, kind: taken || !reachable ? 'blocked' : 'move' };
		}
		return null;
	});

	const hint = $derived.by(() => {
		if (placing) return `Click an empty cell to place ${placing.name}. Esc to cancel.`;
		if (spawning) {
			const name = spawnName ?? adventure?.director?.enemies.find((e) => e.kind === spawning)?.name;
			return `Click an empty cell to bring on ${name ?? 'the enemy'}. Esc to stop.`;
		}
		if (tool === 'wall') {
			if (!wallStart) return 'Wall: click a grid corner to start.';
			return (
				wallProblem ?? 'Click another corner to finish this wall and start the next. Esc to stop.'
			);
		}
		if (tool === 'door') return 'Door: click a grid line. Placing a door in a wall cuts a doorway.';
		if (tool === 'erase') return 'Erase: click a wall, door, light or prop to remove it.';
		if (tool === 'prop') {
			const problem =
				hover?.cell && room
					? placementProblem(room.grid, { ...propDraft, pos: hover.cell }, room.tokens, room.props)
					: null;
			return problem?.message ?? 'Prop: click to place. [ and ] rotate. Esc to stop.';
		}
		if (selectedProp) {
			return 'Click a cell to move the prop. [ and ] rotate, Delete removes, Esc deselects.';
		}
		if (selectedLight) return 'Edit the light in its panel. Delete removes it, Esc deselects.';
		if (hoveredPropId && isGm) return 'Click to select this prop.';
		if (tool === 'light') {
			const existing = lightUnder(hover);
			return existing
				? `Click to switch this light ${existing.on ? 'off' : 'on'}.`
				: 'Light: click a cell to place a light of the chosen kind. Click a light to switch it on or off; select it (V) to edit it.';
		}
		if (tool === 'dark') {
			const lifting = areaStart && isDark(areaStart);
			return areaStart
				? `Click the opposite corner cell to ${lifting ? 'lift the dark from' : 'darken'} the area. Esc to cancel.`
				: 'Dark area: click a cell to start an area (a dark cell lifts the dark instead).';
		}
		if (tool === 'roof') {
			const lifting = areaStart && isRoofed(areaStart);
			return areaStart
				? `Click the opposite corner cell to ${lifting ? 'lift the roof from' : 'roof'} the area. Esc to cancel.`
				: 'Roof: click a cell to start an area (a roofed cell lifts the roof instead).';
		}
		if (tool === 'floor' && grassDraft) {
			const { density, height } = grassDraft;
			const name = [
				GRASS_DENSITIES.find((d) => d.id === density)!.name,
				'density and',
				GRASS_HEIGHTS.find((h) => h.id === height)!.name,
				'height'
			]
				.join(' ')
				.toLowerCase();
			return areaStart
				? `Click the opposite corner cell to grow grass of ${name} there. Esc to cancel.`
				: `Paint grass: click a cell to start an area of ${name}.`;
		}
		if (tool === 'floor') {
			const name = FLOORS.find((f) => f.id === floorDraft)!.name.toLowerCase();
			return areaStart
				? `Click the opposite corner cell to paint the area ${name}. Esc to cancel.`
				: `Paint floor: click a cell to start an area of ${name}.`;
		}
		if (tool === 'height') {
			return areaStart
				? `Click the opposite corner cell to set the area to level ${heightLevel}. Esc to cancel.`
				: `Shape ground: click a cell to start an area at level ${heightLevel}.`;
		}
		if (tool === 'reveal-room' || tool === 'hide-room') {
			if (hover?.cell && !hoveredRoom) return 'Open ground: pick a cell inside walls.';
			return `${tool === 'reveal-room' ? 'Reveal' : 'Hide'} room: click a cell inside a walled room to ${tool === 'reveal-room' ? 'reveal it to' : 'hide it from'} the players.`;
		}
		if (tool === 'reveal' || tool === 'hide') {
			const verb = tool === 'reveal' ? 'reveal to' : 'hide from';
			return areaStart
				? `Click the opposite corner cell to ${verb} the players. Esc to cancel.`
				: `${tool === 'reveal' ? 'Reveal' : 'Hide'}: click a cell to start an area.`;
		}
		if (hoveredObjectId && doorUnder(hover)) {
			const door = doorUnder(hover)!;
			return `Click to ${door.open ? 'close' : 'open'} the door.`;
		}
		const target = adventureTarget(hover);
		if (target) {
			if (!target.inReach) {
				return target.kind === 'act' ? 'Out of reach.' : 'Walk up to it to interact.';
			}
			return target.kind === 'act'
				? `Click: ${target.name}.`
				: `Click to ${target.name[0].toLowerCase()}${target.name.slice(1)}.`;
		}
		if (targeting) return 'Choose a target on the map or in the action bar. Esc to cancel.';
		if (selected) {
			const distance = hoverCell ? (steps ?? gridDistance(selected.pos, hoverCell)) : null;
			const suffix = distance ? ` · ${distance} ${distance === 1 ? 'cell' : 'cells'}` : '';
			const left = movesLeft === null ? '' : ` · ${movesLeft} left this round`;
			const way =
				hoverCell && !reachable ? (steps === null ? ' · no way through' : ' · too far') : '';
			return `Moving ${selected.name}: click a cell${suffix}${way}${left}.`;
		}
		if (me?.role === 'spectator') return 'You are watching this table.';
		if (!isGm && room?.fog.enabled && !room.tokens.some((t) => t.ownerId === me?.id)) {
			return 'Fog of war is on. You see what the GM reveals.';
		}
		if (!isGm && room && !room.tokens.some((t) => t.ownerId === me?.id)) {
			return 'Waiting for the GM to give you a token.';
		}
		return isGm
			? 'Click any token to move it, or open Build to add walls, props and light.'
			: 'Click one of your tokens to move it, or a door next to it to open it.';
	});

	function showToast(message: string, sound: 'notice' | 'error' = 'notice') {
		toast = message;
		play([{ kind: 'ui', sound }]);
	}

	$effect(() => {
		const err = conn.actionError;
		if (err) {
			// A refusal of content says how much more was found than its first problem.
			const more = (err.diagnostics ?? []).filter((d) => d.severity === 'error').length - 1;
			showToast(more > 0 ? `${err.message} (and ${more} more)` : err.message, 'error');
		}
	});

	// The table's sound, worked out from each change to the synced state (see audio/cues.ts).
	let heard: AudioState | null = null;
	let heardRoom: string | null = null;
	let heardSeq = -1;
	$effect(() => {
		if (!room || !me) return;
		const state = $state.snapshot({
			me: me.id,
			tokens: room.tokens,
			objects: room.objects,
			ambient: room.ambient,
			adventure
		}) as AudioState;
		if (heardRoom !== room.id) {
			heardRoom = room.id;
			heard = null;
			heardSeq = room.log.at(-1)?.seq ?? -1;
		}
		const fresh = room.log.filter((m) => m.seq > heardSeq);
		heardSeq = room.log.at(-1)?.seq ?? heardSeq;
		play(soundsFor(heard, state, fresh));
		heard = state;
		setMusic(musicFor(state.adventure, state.ambient));
		setAmbience(ambienceFor(state.adventure, state.ambient));
		void import('$lib/audio/weather-sound').then((m) => m.hear(room, state.adventure, conn)); // #325
	});
	$effect(() => () => {
		setMusic(SILENCE);
		setAmbience(null);
	});

	// The table's effects (tabletop/vfx-cues.ts, #313), from the same changes. The card entry's
	// wait for its card (showCard), to land with its float. Runs before the card's effect below,
	// which may show a card without dice at once. Loaded apart to keep the room page in budget.
	let vfx = $state<VfxTracker | null>(null);
	void import('$lib/tabletop/vfx-cues').then(
		(m) => (vfx = new m.VfxTracker((events) => table?.camera()?.playVfx?.(events) ?? false))
	);
	$effect(() => {
		if (!room || !me || !vfx) return;
		const view = $state.snapshot({ me: me.id, tokens: room.tokens, props: room.props, adventure });
		vfx.update(`${room.id}:${room.sceneName}`, view as Omit<VfxState, 'lastSeen'>, room.log);
	});

	$effect(() => {
		if (!room) return;
		const latest = room.log.at(-1);
		if (lastAnnouncedSeq === null) {
			lastAnnouncedSeq = latest?.seq ?? 0;
			return;
		}
		if (!latest || latest.seq <= lastAnnouncedSeq) return;
		const since = lastAnnouncedSeq;
		lastAnnouncedSeq = latest.seq;
		// Someone spoke while the chat was folded away: the bell rings.
		if (
			!chatVisible &&
			room.log.some((m) => m.seq > since && m.kind === 'chat' && m.authorId !== me?.id)
		) {
			play([{ kind: 'ui', sound: 'notice' }]);
		}
		// A cue can arrive among other entries (a move notice after it): look at all new ones.
		const cued = room.log.flatMap((m) =>
			m.seq > since && m.kind === 'narration' && (m.cue || m.shot)
				? [{ seq: m.seq, cue: m.cue, shot: m.shot }]
				: []
		);
		if (cued.length) {
			const bell = room.props.find((p) => p.assetId === 'belfry-bell');
			cuePlay = {
				seq: cued.at(-1)!.seq,
				cues: [...new Set(cued.flatMap((c) => (c.cue ? [c.cue] : [])))],
				swingPropId: bell?.id ?? null,
				shot: cued.findLast((c) => c.shot)?.shot ?? null
			};
		}
		if (
			latest.kind !== 'roll' &&
			latest.kind !== 'attack' &&
			latest.kind !== 'ability' &&
			latest.kind !== 'check'
		) {
			return;
		}
		const dice =
			latest.kind === 'roll' || latest.kind === 'check'
				? diceToThrow(latest.roll)
				: latest.kind === 'attack'
					? [...diceToThrow(latest.toHit), ...(latest.damage ? diceToThrow(latest.damage) : [])]
					: latest.roll
						? diceToThrow(latest.roll)
						: [];
		if (dice.length === 0) {
			showCard(latest);
			return;
		}
		// Dice in the acting token's colour (an enemy rolls in its own), else the roller's.
		const source = 'sourceId' in latest ? latest.sourceId : undefined;
		const color =
			(source
				? room.tokens.find((t) => t.id === source)
				: room.tokens.find((t) => t.ownerId === latest.authorId)
			)?.color ?? '#efe6d2';
		pendingCard = latest;
		diceThrow = { seq: latest.seq, dice, color };
	});

	function onDiceThrown(seq: number, ms: number) {
		const card = pendingCard;
		if (!card || card.seq !== seq) return;
		pendingCard = null;
		clearTimeout(cardTimer);
		cardTimer = setTimeout(() => showCard(card), ms);
	}

	$effect(() => () => clearTimeout(cardTimer));

	$effect(() => {
		if (!rollCard) return;
		const timer = setTimeout(() => (rollCard = null), 4000);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!toast) return;
		const timer = setTimeout(
			() => {
				toast = null;
				undo = null;
			},
			undo ? 8000 : 3500
		);
		return () => clearTimeout(timer);
	});

	function showUndo(message: string, label: string, run: () => void) {
		toast = message;
		undo = { label, run };
	}

	function deleteProp(prop: Prop) {
		act({ type: 'prop_delete', propId: prop.id });
		selectedPropId = null;
		showUndo(`${propName(prop)} removed.`, 'Undo', () => {
			restoring = { ...prop, known: new Set(room?.props.map((p) => p.id)) };
			act({ type: 'prop_create', assetId: prop.assetId, pos: prop.pos, rotation: prop.rotation });
		});
	}

	function deleteLight(light: Light) {
		act({ type: 'light_delete', lightId: light.id });
		selectedLightId = null;
		const { on, ...made } = light; // the server gives it a new id, and makes it lit
		showUndo('Light removed.', 'Undo', () => {
			if (!on) restoringLight = { pos: made.pos, known: new Set(room?.lights.map((l) => l.id)) };
			act({ type: 'light_create', ...made });
		});
	}

	// A restored light comes back lit, with a new id: find it and switch it off again.
	$effect(() => {
		const lights = room?.lights;
		const was = restoringLight;
		if (!lights || !was) return;
		const back = lights.find(
			(l) => !was.known.has(l.id) && l.pos.x === was.pos.x && l.pos.y === was.pos.y
		);
		if (!back) return;
		restoringLight = null;
		act({ type: 'light_update', lightId: back.id, patch: { on: false } });
	});

	// The server gives a restored prop a new id: find it, then give back what create can't carry.
	$effect(() => {
		const props = room?.props;
		const was = restoring;
		if (!props || !was) return;
		const back = props.find(
			(p) =>
				!was.known.has(p.id) &&
				p.assetId === was.assetId &&
				p.pos.x === was.pos.x &&
				p.pos.y === was.pos.y
		);
		if (!back) return;
		restoring = null;
		if (was.scale !== back.scale || !!was.hidden !== !!back.hidden) {
			act({
				type: 'prop_update',
				propId: back.id,
				patch: { scale: was.scale, hidden: !!was.hidden }
			});
		}
	});

	/** Keys typed on the table itself (it takes focus) drive the selected token. */
	function onTable(target: EventTarget | null) {
		return target instanceof HTMLCanvasElement;
	}

	function propName(prop: Prop) {
		return ASSETS[prop.assetId]?.name ?? 'Prop';
	}

	function setTool(next: BuildTool) {
		tool = next;
		spawning = null;
		wallStart = null;
		areaStart = null;
		placing = null;
		selectedId = null;
		selectedPropId = null;
		selectedLightId = null;
	}

	function rotateBy(rotation: Rotation, by: 1 | -1): Rotation {
		return ((rotation + by + 4) % 4) as Rotation;
	}

	function onClick(pick: Pick) {
		if (!room || !me) return;
		if (placing) {
			if (!pick.cell) return;
			if (tokenAt(room.tokens, pick.cell)) return showToast('That cell is taken.');
			act({ type: 'token_create', ...placing, pos: pick.cell });
			placing = null;
			return;
		}
		if (spawning) {
			if (!pick.cell) return;
			if (tokenAt(room.tokens, pick.cell)) return showToast('That cell is taken.');
			act({
				type: 'adventure_direct',
				direction: {
					op: 'spawn',
					kind: spawning,
					pos: pick.cell,
					...(spawnHold ? { waiting: true } : {})
				}
			});
			return;
		}
		switch (tool) {
			case 'wall':
				return clickWall(pick);
			case 'door':
				if (pick.edge) act({ type: 'object_create', kind: 'door', ...pick.edge });
				return;
			case 'floor': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act(
					grassDraft
						? { type: 'grass_set', from: areaStart, to: pick.cell, ...grassDraft }
						: { type: 'floor_set', from: areaStart, to: pick.cell, floor: floorDraft }
				);
				areaStart = null;
				return;
			}
			case 'height': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act({ type: 'terrain_set', from: areaStart, to: pick.cell, level: heightLevel });
				areaStart = null;
				return;
			}
			case 'reveal':
			case 'hide': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act({ type: 'fog_area', from: areaStart, to: pick.cell, reveal: tool === 'reveal' });
				areaStart = null;
				return;
			}
			case 'dark': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				const dark = !isDark(areaStart);
				act({ type: 'darkness_set', from: areaStart, to: pick.cell, dark });
				areaStart = null;
				return;
			}
			case 'roof': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				const roofed = !isRoofed(areaStart);
				act({ type: 'interior_set', from: areaStart, to: pick.cell, roofed });
				areaStart = null;
				return;
			}
			case 'reveal-room':
			case 'hide-room': {
				if (!pick.cell) return;
				act({ type: 'fog_room', cell: pick.cell, reveal: tool === 'reveal-room' });
				return;
			}
			case 'erase': {
				const target = objectUnder(pick);
				if (target) return void act({ type: 'object_delete', objectId: target.id });
				const light = lightUnder(pick);
				if (light) return void act({ type: 'light_delete', lightId: light.id });
				const prop = propUnder(pick);
				if (prop) act({ type: 'prop_delete', propId: prop.id });
				return;
			}
			case 'prop': {
				if (!pick.cell) return;
				const placement = { ...propDraft, pos: pick.cell };
				const problem = placementProblem(room.grid, placement, room.tokens, room.props);
				if (problem) return showToast(problem.message);
				act({ type: 'prop_create', ...placement });
				return;
			}
			case 'light': {
				const existing = lightUnder(pick);
				if (existing) {
					act({ type: 'light_update', lightId: existing.id, patch: { on: !existing.on } });
				} else if (pick.cell) {
					act({ type: 'light_create', pos: pick.cell, ...lightDraft });
				}
				return;
			}
			case 'select':
				return clickSelect(pick);
		}
	}

	function clickWall(pick: Pick) {
		if (!pick.corner) return;
		if (!wallStart) {
			wallStart = pick.corner;
			return;
		}
		const end = alignToAxis(wallStart, pick.corner);
		if (end.x === wallStart.x && end.y === wallStart.y) {
			wallStart = null;
			return;
		}
		if (wallProblem) return showToast(wallProblem);
		act({ type: 'object_create', kind: 'wall', a: wallStart, b: end });
		wallStart = end; // keep drawing from here
	}

	/** A press on a mini (#287): it may be dragged if it is the viewer's and they are moving things. */
	function onDragStart(pick: Pick): boolean {
		const id = pick.tokenId;
		if (!id || tool !== 'select' || placing || spawning || targeting || selectedProp) return false;
		if (!canMove(id)) return false;
		dragging = id;
		return true;
	}

	/** The mini is set down over `cell` (null: a click or a cancel): the server moves it, not us. */
	function onDrop(tokenId: string, cell: GridPos | null) {
		dragging = null;
		const token = room?.tokens.find((t) => t.id === tokenId);
		if (!token || !cell || (token.pos.x === cell.x && token.pos.y === cell.y)) return;
		selectedId = tokenId;
		if (tokenAt(room!.tokens, cell)) return showToast('That cell is taken.');
		act({ type: 'token_move', tokenId, to: cell });
	}

	function clickSelect(pick: Pick) {
		if (!room || !me) return;
		if (selectedProp && !pick.tokenId) {
			// A selected prop moves to wherever the GM clicks; clicking it again lets go.
			if (pick.propId === selectedProp.id || !pick.cell) {
				selectedPropId = null;
				return;
			}
			const moved = { ...selectedProp, pos: pick.cell };
			const problem = placementProblem(room.grid, moved, room.tokens, room.props, selectedProp.id);
			if (problem) return showToast(problem.message);
			act({ type: 'prop_update', propId: selectedProp.id, patch: { pos: pick.cell } });
			return;
		}
		const target = adventureTarget(pick);
		if (target) {
			if (!target.inReach) {
				return showToast(target.kind === 'act' ? 'Out of reach.' : 'Walk up to it first.');
			}
			act(
				target.kind === 'act'
					? {
							type: 'adventure_act',
							actionId: target.actionId,
							targetId: target.id,
							...(target.cast
								? { cast: { slot: target.cast.slot, targets: [], at: target.cast.at } }
								: {})
						}
					: { type: 'adventure_interact', targetId: target.id, verb: target.verb }
			);
			targeting = null;
			return;
		}
		if (pick.tokenId) {
			selectedPropId = null;
			selectedLightId = null;
			const id = pick.tokenId;
			if (canMove(id)) {
				selectedId = selectedId === id ? null : id;
				return;
			}
			const token = room.tokens.find((t) => t.id === id);
			if (token) showToast(`${token.name} isn't yours to move.`);
			return;
		}
		const door = doorUnder(pick);
		if (door) {
			if (!canUseDoor(me, door, room.tokens, room.grid)) {
				return showToast(
					me.role === 'player'
						? 'Move one of your tokens next to the door first.'
						: 'Spectators cannot open doors.'
				);
			}
			act({ type: 'door_toggle', objectId: door.id });
			return;
		}
		if (isGm && !selected) {
			const prop = propUnder(pick);
			if (prop) {
				selectedPropId = prop.id;
				selectedLightId = null;
				return;
			}
			// A light, by its fixture, its GM handle or its cell; clicking elsewhere lets go.
			const light = lightUnder(pick);
			if (light || selectedLight) {
				selectedLightId = light && light.id !== selectedLightId ? light.id : null;
				return;
			}
		}
		if (!selected || !pick.cell) return;
		if (selected.pos.x === pick.cell.x && selected.pos.y === pick.cell.y) return;
		act({ type: 'token_move', tokenId: selected.id, to: pick.cell });
	}

	function onKeydown(event: KeyboardEvent) {
		const typing = (event.target as HTMLElement | null)?.closest(
			'input, textarea, select, [contenteditable]'
		);
		if (isGm && !typing && (event.key === '[' || event.key === ']')) {
			const by = event.key === ']' ? 1 : -1;
			if (tool === 'prop') propDraft = { ...propDraft, rotation: rotateBy(propDraft.rotation, by) };
			else if (selectedProp) {
				const rotation = rotateBy(selectedProp.rotation, by);
				act({ type: 'prop_update', propId: selectedProp.id, patch: { rotation } });
			}
			return;
		}
		if (isGm && !typing && selectedProp && (event.key === 'Delete' || event.key === 'Backspace')) {
			deleteProp(selectedProp);
			return;
		}
		if (isGm && !typing && selectedLight && (event.key === 'Delete' || event.key === 'Backspace')) {
			deleteLight(selectedLight);
			return;
		}
		// Camera keys (#279): never while typing, never with Ctrl or Meta.
		const camera = typing ? null : cameraActionForKey(event);
		if (camera) {
			// Page keys and Home scroll the page, so they are ours only on the table or the page.
			if (isPageKey(event.key) && onPage(event.target)) event.preventDefault();
			if (!event.repeat) cameraKey(camera, true);
			return;
		}
		if (!typing && event.key.startsWith('Arrow') && onTable(event.target) && selected) {
			const step: Record<string, [number, number]> = {
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0]
			};
			const [dx, dy] = step[event.key] ?? [0, 0];
			const to = { x: selected.pos.x + dx, y: selected.pos.y + dy };
			event.preventDefault();
			if (!room || to.x < 0 || to.y < 0 || to.x >= room.grid.width || to.y >= room.grid.height) {
				moved = `${selected.name} is at the edge of the map.`;
				return;
			}
			act({ type: 'token_move', tokenId: selected.id, to });
			moved = `${selected.name}: moving to column ${to.x + 1}, row ${to.y + 1}.`;
			return;
		}
		if (event.key === 'Escape') {
			if (spawning) {
				spawning = null;
				return;
			}
			if (targeting) {
				targeting = null;
				return;
			}
			// With nothing else to let go, a locked cut goes back to auto (#281).
			const idle = !selectedPropId && !selectedLightId && !wallStart && !areaStart && !placing;
			if (idle && tool === 'select' && !selectedId && cut.locked) return void (cut = AUTO_CUT);
			selectedPropId = null;
			selectedLightId = null;
			if (wallStart || areaStart) {
				wallStart = null;
				areaStart = null;
			} else if (tool !== 'select') tool = 'select';
			placing = null;
			selectedId = null;
			return;
		}
		// Tool shortcuts, but never while typing.
		const target = event.target as HTMLElement | null;
		if (!isGm || event.ctrlKey || event.metaKey || event.altKey) return;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const next = toolForKey(event.key, !!room?.fog.enabled);
		if (next) setTool(next);
	}

	function onKeyup(event: KeyboardEvent) {
		for (const action of cameraActionsForKey(event.key)) cameraKey(action, false);
	}

	function releaseKeys() {
		namesHeld = false;
		gridHeld = false;
		table?.camera()?.holdCamera(null, false); // pan and turn keys held as the window lost focus
	}

	const isPageKey = (key: string) => ['PageUp', 'PageDown', 'Home'].includes(key);
	const onPage = (target: EventTarget | null) =>
		onTable(target) || target === document.body || target === document.documentElement;

	const HELD: Partial<Record<CameraAction, CameraHold>> = {
		pan_forward: 'pan_forward',
		pan_back: 'pan_back',
		pan_left: 'pan_left',
		pan_right: 'pan_right',
		turn_left: 'turn_left',
		turn_right: 'turn_right'
	};
	const DRAG_HINT_KEY = 'thirdfold:hint:left-drag';

	/** A camera key went down or up: names and grid are held here, the rest go to the camera (#279). */
	function cameraKey(action: CameraAction, down: boolean) {
		if (action === 'names') return void (namesHeld = down);
		if (action === 'grid') return void (gridHeld = down);
		const camera = table?.camera();
		if (!camera) return;
		const held = HELD[action];
		if (held) return camera.holdCamera(held, down);
		if (!down) return;
		if (action === 'snap_left') camera.snapTurn(1);
		else if (action === 'snap_right') camera.snapTurn(-1);
		else if (action === 'level_up') camera.raisePivot(1);
		else if (action === 'level_down') camera.raisePivot(-1);
		else if (action === 'cut_up' || action === 'cut_down') {
			const from = cut.locked ? cut.level : camera.cutLevel();
			cut = { level: stepCut(from, action === 'cut_up' ? 1 : -1), locked: true };
		} else if (action === 'reset') camera.cameraHome();
		else if (action === 'focus') focusCell(selected?.pos ?? hoverCell);
	}

	// The cut (#281): auto never cuts the floors of the viewer's own and selected minis; walls (#282).
	$effect(() => {
		const keep = room?.tokens.filter((t) => me && t.ownerId === me.id).map((t) => t.id) ?? [];
		if (selected) keep.push(selected.id);
		table?.camera()?.setCut(cut.locked ? cut.level : 'auto', keep);
	});
	$effect(() => table?.camera()?.setWalls(graphics.walls ?? 'cutaway'));

	function focusCell(cell: GridPos | null | undefined) {
		if (cell) table?.camera()?.focusCell(cell);
	}

	/** The first left-drag over empty ground: the left button no longer turns the camera (#279). */
	function dragHint(down: PointerEvent | null, up?: PointerEvent) {
		if (down) {
			press =
				down.button === 0 && down.pointerType === 'mouse' && !down.altKey && !hover?.tokenId
					? down
					: null; // a finger or pen pans with the left button (#288)
			return;
		}
		const start = press;
		press = null;
		if (!start || !up || Math.hypot(up.clientX - start.clientX, up.clientY - start.clientY) < 12) {
			return;
		}
		try {
			if (localStorage.getItem(DRAG_HINT_KEY)) return;
			localStorage.setItem(DRAG_HINT_KEY, '1');
		} catch {
			// No storage: the hint shows each session.
		}
		showToast('Right-drag moves the camera; middle-drag or Q/E turns it.');
	}

	// The tutorial's first step is done once the character has walked somewhere.
	let lastSpot: { id: string; x: number; y: number } | null = null;
	$effect(() => {
		const t = myCharacterToken;
		if (!t) return;
		const moved = lastSpot?.id === t.id && (lastSpot.x !== t.pos.x || lastSpot.y !== t.pos.y);
		lastSpot = { id: t.id, x: t.pos.x, y: t.pos.y };
		if (moved && adventure?.stage === 'playing') learned('move');
	});

	$effect(() => {
		if (sheetOpen) learned('sheet');
	});

	// The first find: coming up beside it, then finding what it holds (once the server says so).
	const firstFind = $derived(adventure?.firstFind ?? null);
	const foundFirst = $derived.by(() => {
		const id = firstFind?.clueId;
		const clue = id ? adventure?.clues.find((c) => c.id === id && c.mine) : undefined;
		return clue ? { title: clue.title, text: clue.text } : null;
	});
	$effect(() => {
		const t = myCharacterToken;
		if (!t || !firstFind || adventure?.stage !== 'playing') return;
		if (firstFind.cells.some((c) => gridDistance(c, t.pos) <= 1)) learned('approach');
	});
	$effect(() => {
		if (foundFirst) {
			learned('approach');
			learned('inspect');
		}
	});
	/** Where an area spell being aimed would land, under the pointer. */
	const spellArea = $derived.by((): PreviewItem[] => {
		const aimed = targeting && myCharacter ? actionOf(myCharacter.def, targeting) : undefined;
		const area = aimed?.cast?.area;
		if (!area || !hoverCell || !myCharacterToken || !room) return [];
		return areaCells(myCharacterToken.pos, hoverCell, area, room.grid).map((at) => ({
			kind: 'area',
			from: at,
			to: at,
			tone: 'invalid'
		}));
	});
	/** Onboarding's glow on the table, while the player is being shown to it. */
	/** The light being edited, marked on its cell. */
	const lightMark = $derived<PreviewItem[]>(
		selectedLight
			? [{ kind: 'area', from: selectedLight.pos, to: selectedLight.pos, tone: 'valid' }]
			: []
	);

	const beacon = $derived.by((): PreviewItem[] => {
		const step = tutorial.stage === 'tutorial' ? currentStep(tutorial, !!firstFind) : null;
		if (!firstFind || (step?.id !== 'approach' && step?.id !== 'inspect')) return [];
		return firstFind.cells.map((at) => ({ kind: 'beacon', at }));
	});

	const firstGoal = $derived(
		adventure?.objectives.find((o) => !o.done && !o.optional)?.text ?? null
	);
	const learning = $derived(
		me?.role === 'player' && !!myCharacter && adventure?.stage === 'playing'
	);

	// Introduce a character when this player takes it (not when a reload finds it already taken).
	$effect(() => {
		if (!room) return;
		const id = myCharacter?.id ?? null;
		if (knownCharacter !== undefined && id && id !== knownCharacter) introFor = id;
		knownCharacter = id;
	});

	// An aimed action is dropped when it can no longer be used.
	$effect(() => {
		const encounter = adventure?.encounter;
		const up = encounter?.order[encounter.current];
		const myTurn = !encounter || up?.characterId === myCharacter?.id;
		if (targeting && (!myCharacter || myCharacter.downed || !myTurn)) targeting = null;
	});

	// In an adventure, a player's own character is always the one ready to move.
	$effect(() => {
		if (myCharacterToken && !selectedId && !placing && tool === 'select') {
			selectedId = myCharacterToken.id;
		}
	});

	// ---- The HUD's own state: the satchel's tabs, the chat's bell, who you are ----------------

	const ROLE_LABEL: Record<Role, string> = { gm: 'GM', player: 'Player', spectator: 'Spectator' };

	const tabs = $derived.by((): SatchelTab[] => {
		const out: SatchelTab[] = [];
		if (adventure || isGm) {
			out.push({
				id: 'story',
				label: 'Story',
				icon: 'scroll',
				hint: 'the adventure, goals and clues'
			});
		}
		if (isGm && adventure && adventure.stage !== 'choosing') {
			out.push({
				id: 'direct',
				label: 'Direct',
				icon: 'wand',
				hint: 'pause, skip scenes, bring on foes'
			});
		}
		out.push({
			id: 'party',
			label: 'Party',
			icon: 'users',
			hint: 'who is at the table, and the tokens'
		});
		if (isGm) {
			out.push({
				id: 'build',
				label: 'Build',
				icon: 'cube',
				hint: 'walls, doors, props, lights and fog'
			});
		}
		if (selectedProp)
			out.push({ id: 'prop', label: 'Prop', icon: 'pencil', hint: 'the prop you picked' });
		if (selectedLight) {
			out.push({ id: 'light', label: 'Light', icon: 'flame', hint: 'the light you picked' });
		}
		out.push({
			id: 'table',
			label: 'Table',
			icon: 'gear',
			hint: isGm ? 'scenes, saves and graphics' : 'graphics'
		});
		return out;
	});

	const activeTab = $derived.by(() => {
		if (tabs.some((t) => t.id === satchel.tab)) return satchel.tab;
		// A picked prop or light was let go: back to the workshop it came from.
		if ((satchel.tab === 'prop' || satchel.tab === 'light') && isGm) return 'build';
		return tabs[0].id;
	});

	/** The GM's Build panel is out: the table shows its grid. */
	const building = $derived(
		activeTab === 'build' && (phone.current ? sheet === 'side' : satchel.open)
	);

	/** How much grid shows (#245): the moment's mode, then the Graphics menu's Grid on top. */
	const gridMode = $derived(
		withGridSetting(
			gridHeld
				? 'build'
				: gridModeOf({
						isGm,
						building,
						tooling: tool !== 'select',
						placing: !!placing,
						spawning: !!spawning,
						view,
						selected: !!selected
					}),
			graphics.grid
		)
	);
	function selectTab(id: string) {
		if (id !== activeTab) play([{ kind: 'ui', sound: 'select' }]);
		satchel.tab = id;
		if (!satchel.open) {
			satchel.open = true;
			play([{ kind: 'ui', sound: 'open' }]);
		}
	}

	function toggleSatchel() {
		satchel.open = !satchel.open;
		play([{ kind: 'ui', sound: satchel.open ? 'open' : 'close' }]);
	}

	function toggleChat() {
		chatFolded = !chatFolded;
		play([{ kind: 'ui', sound: chatFolded ? 'close' : 'open' }]);
	}

	// Picking a prop or a light on the table brings up its panel.
	let openedFor: { prop: string | null; light: string | null } = { prop: null, light: null };
	$effect(() => {
		const prop = selectedProp?.id ?? null;
		const light = selectedLight?.id ?? null;
		untrack(() => {
			if (prop && prop !== openedFor.prop)
				satchel = { tab: 'prop', open: satchel.open || !phone.current };
			else if (light && light !== openedFor.light) {
				satchel = { tab: 'light', open: satchel.open || !phone.current };
			}
			openedFor = { prop, light };
		});
	});

	/** The newest log entry the viewer has seen; later ones from others are unread. */
	let seenSeq = $state(-1);
	const chatVisible = $derived(phone.current ? sheet === 'chat' : !chatFolded);
	const unread = $derived(
		room
			? room.log.filter(
					(m) =>
						m.seq > seenSeq && m.kind !== 'system' && !('authorId' in m && m.authorId === me?.id)
				).length
			: 0
	);
	$effect(() => {
		if (!room) return;
		const latest = room.log.at(-1)?.seq ?? 0;
		if (untrack(() => seenSeq) < 0 || chatVisible) seenSeq = latest;
	});

	/** Each player's own token colour, for their medallion. */
	const colors = $derived(
		Object.fromEntries(
			(room?.tokens ?? []).flatMap((t) => (t.ownerId ? [[t.ownerId, t.color] as const] : []))
		)
	);

	/** The plate in the corner: your character when you have one, else your seat at the table. */
	const identity = $derived.by(() => {
		if (!me) return null;
		if (myCharacter) {
			const def = myCharacter.def;
			return {
				name: def.name,
				subtitle: `Played by ${me.name}`,
				color: def.color,
				hp: myCharacter.health
					? { value: myCharacter.health.value, max: myCharacter.health.max }
					: { value: myCharacter.hp, max: myCharacter.maxHp },
				healthName: myCharacter.health?.name,
				downed: myCharacter.downed,
				dead: myCharacter.dead,
				statuses: myCharacter.statuses.map((s) => STATUSES[s.id]),
				carrying: myCharacter.carrying.map((c) => c.name)
			};
		}
		return {
			name: me.name,
			subtitle: SEAT[me.role],
			color: colors[me.id] ?? '#8a6a3d',
			badge: isGm ? ('crown' as const) : null
		};
	});

	/** A tip for the loading screen, a different one each visit. */
	const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('[room] clipboard unavailable', err);
			showToast('Copy failed. Share the address bar link instead.');
		}
	}

	const SEAT: Record<Role, string> = {
		gm: 'Game Master',
		player: 'Player',
		spectator: 'Spectator'
	};
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onblur={releaseKeys} />

{#snippet identityPlate()}
	{#if identity}
		<IdentityPlate {...identity} onSheet={myCharacter ? () => (sheetOpen = true) : undefined} />
	{/if}
{/snippet}

<div
	class="room"
	data-conn={conn.status}
	data-folded={!satchel.open}
	style:--below-bar={barHeight ? `calc(${barHeight}px + 1.25rem)` : null}
>
	{#if room}
		<div
			class="stage"
			role="presentation"
			onpointerdown={(e) => dragHint(e)}
			onpointerup={(e) => dragHint(null, e)}
		>
			<Tabletop
				bind:this={table}
				onFocus={(pick) => focusCell(pick.cell)}
				onCamera={() => learned('camera')}
				grid={room.grid}
				tokens={room.tokens}
				objects={room.objects}
				fog={room.fog}
				ambient={room.ambient}
				world={liveWorld}
				lights={room.lights}
				props={room.props}
				{diceThrow}
				{onDiceThrown}
				selectedPropId={selectedProp?.id ?? null}
				{hoveredPropId}
				fogMode={isGm ? 'gm' : 'player'}
				{hoveredObjectId}
				preview={beacon.length || selectedLight || spellArea.length
					? [...preview, ...beacon, ...lightMark, ...spellArea]
					: preview}
				selectedId={selected?.id ?? null}
				ownTokens={room.tokens.filter((t) => me && t.ownerId === me.id).map((t) => t.id)}
				hoveredTokenId={hover?.tokenId ?? null}
				{rings}
				{fallen}
				{floats}
				{terrain}
				{floor}
				{grass}
				{darkness}
				{interior}
				environment={room.environment}
				cue={cuePlay}
				motion={conn.motion}
				{active}
				labels={{
					hovered: hover?.tokenId ?? null,
					held: namesHeld,
					also: CAMERA_MODES[view].labels === 'own' ? ownTokenIds : [],
					quiet: CAMERA_MODES[view].labels === 'hover'
				}}
				{highlight}
				gridView={[gridMode, [hoverCell, selected?.pos ?? null], cellOverlay]}
				{view}
				{viewSubject}
				cameraStore={`thirdfold:camera:${room.id}`}
				{graphics}
				onQuality={(q) => (effectiveQuality = q)}
				{onClick}
				onHover={(pick) => (hover = pick)}
				{onDragStart}
				{onDrop}
			/>
			<CutBar {cut} onchange={(next) => (cut = next)} />
		</div>
	{/if}

	{#if conn.status === 'reconnecting'}
		<div class="hush" aria-hidden="true"></div>
	{/if}

	<div class="bar" bind:clientHeight={barHeight}>
		<RoomPlate
			code={room?.id}
			status={conn.status}
			players={room?.players ?? []}
			myId={me?.id}
			{colors}
			{isGm}
			listed={room?.listed}
			{copied}
			onCopy={copyInvite}
			onListing={() => act({ type: 'room_listing', listed: !room!.listed })}
		/>
		<div class="tools g-frame">
			{#if room}
				<div class="views" role="group" aria-label="Camera">
					{#each VIEW_BUTTONS as v (v.id)}
						<button
							type="button"
							aria-pressed={view === v.id}
							title={v.hint}
							onclick={() => {
								if (view !== v.id) play([{ kind: 'ui', sound: 'select' }]);
								view = v.id;
							}}
						>
							<Icon name={v.icon} size="1.15rem" />
							<span class="word">{v.label}</span>
						</button>
					{/each}
				</div>
				<ControlsHelp gm={isGm} bind:followTurns />
			{/if}
			<AudioControls />
		</div>
	</div>

	{#if room && me}
		<div class="side" data-open={sheet === 'side'}>
			<Satchel
				{tabs}
				active={activeTab}
				open={satchel.open}
				onSelect={selectTab}
				onToggle={toggleSatchel}
			>
				{#snippet children(id)}
					{#if id === 'story' && (adventure || isGm)}
						<AdventurePanel
							{adventure}
							{isGm}
							players={room.players}
							adventures={room.adventures}
							send={act}
							upgrade={conn.upgradeReply}
							campaign={conn.campaignReply}
							sources={conn.sourcesReply}
							onSheet={(id) => {
								if (id === myCharacter?.id) sheetOpen = true;
								else sheetFor = id;
							}}
						/>
					{:else if id === 'direct' && isGm && adventure}
						<!-- The GM's Direct panel is only needed once play begins, so it loads then. -->
						{#await import('./DirectorPanel.svelte') then { default: DirectorPanel }}
							<DirectorPanel
								{adventure}
								paused={room.paused}
								ambient={room.ambient}
								world={room.world}
								hour={Math.floor(hour)}
								environment={room.environment}
								lights={room.lights}
								fogEnabled={room.fog.enabled}
								fogShared={room.fog.shared}
								{tool}
								{spawning}
								send={act}
								onTool={setTool}
								monsters={conn.monsterReply?.monsters ?? null}
								onSpawn={(kind, hold = false, name = null) => {
									setTool('select');
									spawning = kind;
									spawnHold = hold;
									spawnName = name;
								}}
								onSelectToken={(id) => {
									setTool('select');
									selectedId = id;
								}}
								onEditLight={(id) => {
									setTool('select');
									selectedLightId = id;
								}}
								onFogAll={(reveal) =>
									act({
										type: 'fog_area',
										from: { x: 0, y: 0 },
										to: { x: room.grid.width - 1, y: room.grid.height - 1 },
										reveal
									})}
								onError={showToast}
							/>
						{/await}
					{:else if id === 'party'}
						<section aria-label="Players">
							<h2 class="section-title">At the table</h2>
							<ul class="players">
								{#each room.players as player (player.id)}
									<li class:offline={!player.connected} in:fly={{ x: 12, duration: 260 }}>
										<span aria-hidden="true">
											<Portrait
												name={player.name}
												size={38}
												color={colors[player.id] ?? '#6b5a44'}
												badge={player.role === 'gm' ? 'crown' : null}
											/>
										</span>
										<span class="who">
											<span class="name">{player.name}{player.id === me.id ? ' (you)' : ''}</span>
											<span class="state" title={player.connected ? 'Online' : 'Offline'}>
												{player.connected ? 'Online' : 'Offline'}
											</span>
										</span>
										<span class="g-tag" class:brass={player.role === 'gm'}>
											{ROLE_LABEL[player.role]}
										</span>
									</li>
								{/each}
							</ul>
						</section>
						<!-- In an adventure a player's character is handled by the hotbar. -->
						{#if isGm || (me.role === 'player' && !adventure)}
							<hr class="g-rule" />
							<TokenPanel
								{isGm}
								tokens={room.tokens}
								players={room.players}
								myId={me.id}
								{selected}
								{placing}
								onSelect={(id) => {
									placing = null;
									tool = 'select';
									selectedId = id;
								}}
								onPlace={(draft) => {
									selectedId = null;
									tool = 'select';
									placing = draft;
								}}
								send={act}
							/>
						{/if}
					{:else if id === 'build' && isGm}
						<div class="build">
							{#if tool !== 'select'}
								<p class="g-tag brass now">{tool.replace('-', ' ')}</p>
							{/if}
							<BuildPanel
								{tool}
								fogEnabled={room.fog.enabled}
								fogShared={room.fog.shared}
								onFogShared={(shared) => act({ type: 'fog_share', shared })}
								ambient={room.ambient}
								{lightDraft}
								{propDraft}
								onTool={setTool}
								onPropDraft={(draft) => (propDraft = draft)}
								world={room.world}
								hour={Math.floor(hour)}
								send={act}
								environment={room.environment}
								onEnvironment={(environment) => act({ type: 'environment_set', environment })}
								onLightDraft={(draft) => (lightDraft = draft)}
								{heightLevel}
								onHeightLevel={(level) => (heightLevel = level)}
								{floorDraft}
								onFloorDraft={(next) => (floorDraft = next)}
								{grassDraft}
								onGrassDraft={(next) => (grassDraft = next)}
								onFog={(enabled) => {
									if (!enabled && FOG_TOOLS.includes(tool)) setTool('select');
									act({ type: 'fog_set', enabled });
								}}
								onFogAll={(reveal) =>
									act({
										type: 'fog_area',
										from: { x: 0, y: 0 },
										to: { x: room.grid.width - 1, y: room.grid.height - 1 },
										reveal
									})}
							/>
						</div>
					{:else if id === 'prop' && selectedProp}
						<PropInspector
							prop={selectedProp}
							send={act}
							onDone={() => (selectedPropId = null)}
							onRemove={() => selectedProp && deleteProp(selectedProp)}
						/>
					{:else if id === 'light' && selectedLight}
						{#await import('./LightInspector.svelte') then { default: LightInspector }}
							<LightInspector
								light={selectedLight}
								send={act}
								onDone={() => (selectedLightId = null)}
								onRemove={() => selectedLight && deleteLight(selectedLight)}
							/>
						{/await}
					{:else if id === 'table'}
						{#if isGm}
							<!-- The GM's own panel: loaded apart, so players never download it. -->
							{#await import('./ScenePanel.svelte') then { default: ScenePanel }}
								<ScenePanel
									sceneName={room.sceneName}
									reply={conn.sceneReply}
									send={act}
									onError={showToast}
								/>
							{/await}
							<hr class="g-rule" />
						{/if}
						<section class="settings" aria-label="Graphics">
							<h2 class="section-title">Look of the table</h2>
							<GraphicsControls
								{graphics}
								effective={effectiveQuality}
								inline
								expanded
								onchange={changeGraphics}
							/>
						</section>
					{/if}
				{/snippet}
			</Satchel>
		</div>

		<div class="dock-left">
			{#if !phone.current && chatFolded}
				<button
					type="button"
					class="bell"
					aria-label={unread ? `Unfold the chat: ${unread} unread` : 'Unfold the chat'}
					title="Unfold the chat"
					onclick={toggleChat}
				>
					{#key unread}<span class="ringer" class:rung={unread > 0}
							><Icon name="bell" size="1.5rem" /></span
						>{/key}
					{#if unread}<span class="count num">{unread > 9 ? '9+' : unread}</span>{/if}
				</button>
			{/if}
			<div class="chat-dock g-frame" data-open={sheet === 'chat'} data-folded={chatFolded}>
				<header class="chat-head">
					<Icon name="scroll" size="1.1rem" />
					<span class="title">Chat</span>
					<button
						type="button"
						class="ghost fold"
						aria-label="Fold the chat away"
						title="Fold away to a bell"
						onclick={toggleChat}
					>
						<Icon name="chevron" size="1.1rem" />
					</button>
				</header>
				<div class="chat-body">
					<ChatPanel log={room.log} myId={me.id} send={act} onError={showToast} />
				</div>
			</div>
			{#if !phone.current}{@render identityPlate()}{/if}
		</div>

		<nav class="dock-tabs g-frame" aria-label="Panels">
			<button type="button" aria-pressed={sheet === 'table'} onclick={() => (sheet = 'table')}>
				<Icon name="map" size="1.3rem" />
				<span>Map</span>
			</button>
			<button type="button" aria-pressed={sheet === 'side'} onclick={() => (sheet = 'side')}>
				<Icon name={isGm ? 'crown' : 'users'} size="1.3rem" />
				<span>{isGm ? 'GM tools' : 'Party'}</span>
			</button>
			<button type="button" aria-pressed={sheet === 'chat'} onclick={() => (sheet = 'chat')}>
				<Icon name="chat" size="1.3rem" />
				<span>Chat</span>
				{#if unread && sheet !== 'chat'}
					<span class="count num" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span
					>
				{/if}
			</button>
		</nav>

		<p class="visually-hidden" aria-live="polite">{moved}</p>

		{#if myCharacter && (introFor === myCharacter.id || sheetOpen)}
			<CharacterSheet
				character={myCharacter.def}
				card={myCharacter.card}
				status={myCharacter}
				intro={introFor === myCharacter.id}
				send={act}
				sheetReply={conn.sheetReply}
				party={partyFor(myCharacter.id)}
				gm={isGm}
				onClose={() => {
					introFor = null;
					sheetOpen = false;
				}}
			/>
		{:else if sheetShown}
			{#key sheetShown.id}
				<CharacterSheet
					character={sheetShown.def}
					card={sheetShown.card}
					status={sheetShown}
					send={act}
					sheetReply={conn.sheetReply}
					party={partyFor(sheetShown.id)}
					gm={isGm}
					onClose={() => (sheetFor = null)}
				/>
			{/key}
		{/if}

		{#if rollCard}
			{#key rollCard.seq}
				<RollCard entry={rollCard} />
			{/key}
		{/if}

		{#if adventure?.decision && !adventure.encounter}
			<Decision
				decision={adventure.decision}
				canAnswer={isGm || (!!myCharacter && !myCharacter.downed && !myCharacter.dead)}
				send={act}
			/>
		{/if}

		{#if learning && adventure && myCharacter && tutorial.stage === 'welcome' && introFor === null && !sheetOpen}
			<Welcome
				{adventure}
				characterName={myCharacter.def.name}
				onLearn={() => setTutorial({ ...tutorial, stage: 'tutorial' })}
				onSkip={() => setTutorial({ ...tutorial, stage: 'done' })}
			/>
		{/if}

		{#if learning && tutorial.stage === 'tutorial' && !adventure?.encounter}
			<TutorialCoach
				progress={tutorial}
				hasFind={!!firstFind || tutorial.done.includes('inspect')}
				found={foundFirst}
				goal={firstGoal}
				onDone={learned}
				onStart={() => setTutorial({ ...tutorial, stage: 'done' })}
				onSkip={() => setTutorial({ ...tutorial, stage: 'done' })}
			/>
		{/if}

		{#if adventure && me.role === 'player' && !myCharacter && adventure.stage !== 'complete' && adventure.stage !== 'defeat'}
			<CharacterSelect
				{adventure}
				players={room.players}
				send={act}
				roomId={room.id}
				creatorReply={conn.creatorReply}
				myName={conn.me?.name ?? ''}
			/>
		{/if}

		{#if adventure && endKey && dismissedEnd !== endKey}
			<!-- The end screen is shown once a story is over, so it loads then. -->
			{#await import('./SectionEnd.svelte') then { default: SectionEnd }}
				<SectionEnd
					{adventure}
					players={room.players}
					me={me.id}
					{isGm}
					send={act}
					onClose={() => (dismissedEnd = endKey)}
				/>
			{/await}
		{/if}
	{:else}
		<Backdrop variant="hall" />
		<div class="loading" role="status">
			<picture>
				<source
					srcset={asset('/brand/thirdfold-mark.svg')}
					media="(prefers-reduced-motion: reduce)"
				/>
				<img src={asset('/brand/thirdfold-mark-animated.svg')} alt="" />
			</picture>
			<p class="word">thirdfold</p>
			{#if conn.error}
				<p class="problem">{conn.error.message}</p>
			{:else}
				<p class="line">Connecting to the table…</p>
			{/if}
			<span class="progress" aria-hidden="true"><span></span></span>
			<p class="tip"><span class="g-tag">Tip</span> {tip}</p>
		</div>
	{/if}

	<!-- Notices over the table stack in its free space, between the chat and the side panels. -->
	<div class="hud hud-top">
		{#if room && me}
			{#if adventure?.encounter}
				<TurnRibbon encounter={adventure.encounter} characters={adventure.characters} />
				{#if adventure.encounter.handoff}
					{@const encounter = adventure.encounter}
					{@const handoff = adventure.encounter.handoff}
					{@const by = adventure.characters.find((c) => c.id === handoff.by)}
					<!-- Fights where the players choose who goes next: the one holding the baton picks. -->
					<div class="handoff g-frame" role="status" transition:fly={{ y: -8, duration: 220 }}>
						<span class="line">
							<Icon name="hourglass" size="1.2rem" />
							{#if handoff.mine}
								{handoff.fresh ? 'Who starts the next exchange?' : 'Who goes next?'}
								Pick a name.
							{:else}
								{by?.def.name ?? 'Someone'} picks who goes next.
							{/if}
						</span>
						{#if handoff.mine}
							<span class="picks">
								{#each handoff.options as i (i)}
									{@const t = encounter.order[i]}
									{#if t}
										<button
											class="pick"
											type="button"
											title={`${t.name} goes next`}
											onclick={() => act({ type: 'adventure_handoff', index: i })}
										>
											{t.name}
										</button>
									{/if}
								{/each}
							</span>
						{/if}
					</div>
				{/if}
			{/if}
			{#if room.paused || (gmAway && !isGm)}
				<p class="pause g-frame" role="status" transition:fly={{ y: -10, duration: 240 }}>
					<span class="glyph"><Icon name={room.paused ? 'hourglass' : 'warn'} size="1.8rem" /></span
					>
					<span class="words">
						{#if room.paused && gmAway && !isGm}
							<strong>The GM lost their connection.</strong> The game waits for them.
						{:else if room.paused}
							<strong>Paused</strong>{isGm
								? ': players can’t move or act until you carry on'
								: ' by the GM'}
						{:else}
							<strong>The GM is away.</strong>
						{/if}
					</span>
				</p>
			{/if}
		{/if}
		{#if room && view === 'eye' && !viewSubject}
			<div class="slide" transition:fly={{ y: -10, duration: 240 }}>
				<Notice tone="info" icon="eye">No mini to stand at: showing Explore.</Notice>
			</div>
		{/if}
		{#if conn.status === 'reconnecting'}
			<div class="slide" transition:fly={{ y: -10, duration: 240 }}>
				<Notice tone="warn" icon="warn" role="alert">
					Connection lost. {retryIn === null || retryIn === 0
						? 'Reconnecting…'
						: `Trying again in ${retryIn}s`}{conn.attempt > 1 ? ` (attempt ${conn.attempt})` : ''}.
					The table below is as you last saw it.
					{#snippet action()}
						<button type="button" onclick={() => conn.retryNow()} disabled={conn.retryAt === null}>
							Try now
						</button>
					{/snippet}
				</Notice>
			</div>
		{/if}
		{#if room && me}
			{#if adventure && endKey && dismissedEnd === endKey}
				<button
					class="summary-plate"
					type="button"
					in:fly={{ y: -8, duration: 220 }}
					onclick={() => (dismissedEnd = null)}
				>
					<Icon name={adventure.stage === 'complete' ? 'flag' : 'skull'} size="1.2rem" />
					{adventure.stage === 'complete' ? 'Adventure complete' : 'Adventure failed'} · Summary
				</button>
			{/if}
			{#if me.role === 'player' && !adventure}
				<p class="waiting g-frame" role="status">
					You’re at the table. The GM is setting up; the story starts soon. Say hello in the chat
					meanwhile.
				</p>
			{/if}
		{/if}
		{#if toast}
			<div class="slide" out:fade={{ duration: 160 }}>
				<Notice tone="bad" icon="warn" clock={undo ? 8000 : undefined}>
					{toast}
					{#snippet action()}
						{#if undo}
							<button
								type="button"
								onclick={() => {
									undo?.run();
									undo = null;
									toast = null;
								}}
							>
								{undo.label}
							</button>
						{/if}
					{/snippet}
				</Notice>
			</div>
		{/if}
	</div>

	<div class="hud hud-bottom">
		{#if room && me}
			{#if adventure && myCharacter && myCharacterToken}
				<div class="action-dock" data-hidden={sheet !== 'table'}>
					<ActionBar
						{adventure}
						character={myCharacter}
						token={myCharacterToken}
						tokens={room.tokens}
						{blocked}
						{targeting}
						bind:slot={castSlot}
						onTargeting={(id) => (targeting = id)}
						onSheet={() => (sheetOpen = true)}
						send={act}
					/>
				</div>
			{:else}
				<div class="action-dock" data-hidden={sheet !== 'table'}>
					<div class="solo g-frame">
						<DiceSlot onRoll={() => act({ type: 'dice_roll', expression: '1d20' })} />
					</div>
				</div>
			{/if}
			<p class="hint" aria-live="polite" data-hidden={sheet !== 'table'}>{hint}</p>
			{#if phone.current}{@render identityPlate()}{/if}
		{/if}
	</div>

	{#if conn.status === 'closed' && conn.error}
		<div class="lost g-frame" role="alert" in:fly={{ y: 14, duration: 280 }}>
			<svg class="out" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M9.5 4.5a2.5 2.5 0 0 1 5 0M8 7h8l1.4 10.5H6.6zM6.6 17.5h10.8M7.5 20.5h9" />
				<path d="m5 4.5 14 15" />
			</svg>
			<h2>The table is out of reach</h2>
			<p>{conn.error.message}</p>
			<button type="button" class="primary" onclick={() => location.reload()}>Reconnect</button>
		</div>
	{/if}
</div>

<style>
	/*
	 * The room's HUD: a plate and a tool rail across the top corners, the satchel down the right,
	 * the chat scroll and your portrait at the bottom left, the hotbar at the bottom centre, and
	 * everything else over the table in the free space between them.
	 */
	.room {
		--below-bar: 5rem;
		--tabs-h: 0rem;
		--edge: 0.75rem;
		--side-w: 17rem;
		--rail-w: 2.9rem;
		--chat-w: 20rem;
		--free-left: calc(var(--chat-w) + var(--edge) * 2);
		--free-right: calc(var(--side-w) + var(--rail-w) + var(--edge) * 2 + var(--sp-3));
		position: fixed;
		inset: 0;
		overflow: hidden;
	}

	.room[data-folded='true'] {
		--free-right: calc(var(--rail-w) + var(--edge) * 2);
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	/* A lost connection: the table dims at its edges, the way a room does when the lamp gutters. */
	.hush {
		position: absolute;
		inset: 0;
		z-index: var(--z-hud);
		pointer-events: none;
		background: radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(10, 6, 3, 0.7));
		animation: g-rise 600ms var(--ease-out) both;
	}

	.bar {
		position: absolute;
		top: var(--edge);
		left: var(--edge);
		right: var(--edge);
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-4);
		pointer-events: none;
		/* Above the side column, so the Sound menu that opens from here is over it. */
		z-index: var(--z-overlay);
	}

	.tools {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		margin-left: auto;
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--radius-bar, var(--radius-md));
		pointer-events: auto;
	}

	.views {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		z-index: 1;
	}

	.views button {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 2.5rem;
		padding: var(--sp-2) var(--sp-5);
		font-size: var(--fs-sm);
	}

	.tools :global(.audio) {
		z-index: 1;
	}

	@media (max-width: 80rem) {
		.views .word {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.views button {
			padding: var(--sp-2) var(--sp-4);
		}
	}

	/* The satchel's column: it hugs the right edge and never swallows the table. */
	.side {
		position: absolute;
		top: var(--below-bar);
		right: var(--edge);
		bottom: var(--edge);
		display: flex;
		justify-content: flex-end;
		align-items: flex-start;
		pointer-events: none;
		z-index: var(--z-panel);
	}

	.players {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.players li {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
	}

	.players li.offline {
		opacity: 0.55;
	}

	.players .who {
		display: grid;
		flex: 1;
		min-width: 0;
		line-height: 1.2;
	}

	.players .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.players .state {
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.players li:not(.offline) .state {
		color: var(--ok);
	}

	.build {
		display: grid;
		gap: var(--sp-4);
	}

	.build .now {
		justify-self: start;
		margin: 0;
		text-transform: capitalize;
	}

	/* The satchel's tab names the panel; its own heading would say it twice. */
	.build :global(> section > h2:first-child) {
		display: none;
	}

	/* The chat scroll and your portrait share the bottom left; the scroll sits above. */
	.dock-left {
		position: absolute;
		left: var(--edge);
		bottom: var(--edge);
		width: min(var(--chat-w), calc(100% - var(--edge) * 2));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--sp-4);
		pointer-events: none;
		z-index: var(--z-hud);
	}

	.chat-dock {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: min(20rem, 34vh);
		border-radius: var(--radius-lg);
		pointer-events: auto;
		animation: g-slide-left 360ms var(--spring) both;
	}

	.chat-dock[data-folded='true'] {
		display: none;
	}

	.chat-head {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-5);
		border-bottom: 1px solid var(--gilt-line);
		color: var(--gilt);
	}

	.chat-head .title {
		flex: 1;
		font-family: var(--font-label);
		font-size: var(--fs-md);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
	}

	.chat-head .fold {
		min-height: 2rem;
		min-width: 2rem;
		padding: 0;
		transform: rotate(180deg);
	}

	.chat-body {
		position: relative;
		z-index: 1;
		flex: 1;
		min-height: 0;
		padding: var(--sp-4) var(--sp-5) var(--sp-5);
	}

	/* Folded: a bell on its bracket, with the unread count as a brass badge. */
	.bell {
		position: relative;
		display: grid;
		place-items: center;
		width: 3.2rem;
		height: 3.2rem;
		min-height: 0;
		padding: 0;
		border-radius: 50%;
		pointer-events: auto;
		color: var(--gilt-hi);
	}

	.ringer {
		display: grid;
		transform-origin: 50% 10%;
	}

	.ringer.rung {
		animation: ring 900ms ease-in-out both;
	}

	.count {
		position: absolute;
		top: -0.25rem;
		right: -0.25rem;
		display: grid;
		place-items: center;
		min-width: 1.4rem;
		height: 1.4rem;
		padding: 0 0.3rem;
		border-radius: 0.7rem;
		background: var(--gilt-grad);
		box-shadow:
			0 0 0 1px var(--ink-line),
			0 0 12px var(--ember-glow);
		font-family: var(--font-label);
		font-size: var(--fs-xs);
		font-weight: 700;
		line-height: 1;
		color: var(--accent-text);
		text-shadow: none;
	}

	@keyframes ring {
		0%,
		100% {
			transform: rotate(0);
		}
		15% {
			transform: rotate(18deg);
		}
		35% {
			transform: rotate(-15deg);
		}
		55% {
			transform: rotate(10deg);
		}
		75% {
			transform: rotate(-6deg);
		}
	}

	/* The loading screen before the table's state arrives. */
	.loading {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--sp-5);
		padding: var(--sp-6);
		text-align: center;
	}

	.loading img {
		display: block;
		width: min(13rem, 52vw);
		height: auto;
		filter: drop-shadow(0 0 28px var(--ember-glow));
	}

	.loading p {
		margin: 0;
	}

	.loading .word {
		font-family: var(--font-label);
		font-size: var(--fs-2xl);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--gilt-hi);
		text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
	}

	.loading .line {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		color: var(--text);
	}

	.loading .problem {
		max-width: 28rem;
		padding: var(--sp-4) var(--sp-6);
		border: 1px solid #6b2f26;
		border-radius: var(--radius-md);
		background: rgba(60, 24, 16, 0.85);
		color: #ffd7cf;
	}

	.loading .tip {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		max-width: 30rem;
		margin-top: var(--sp-5);
		color: var(--muted);
		text-align: left;
	}

	/* An unending bar: a brass glint travelling a groove, as the loading screens of games do. */
	.progress {
		position: relative;
		width: min(18rem, 70vw);
		height: 0.7rem;
		overflow: hidden;
		border: 1px solid var(--ink-line);
		border-radius: 999px;
		background: var(--panel-sunk);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.7),
			0 1px 0 var(--gilt-line);
	}

	.progress span {
		position: absolute;
		inset: 0 auto 0 0;
		width: 38%;
		border-radius: inherit;
		background: var(--gilt-grad);
		box-shadow: 0 0 12px var(--ember-glow);
		animation: travel 1.5s ease-in-out infinite;
	}

	@keyframes travel {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(270%);
		}
	}

	.hud {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-4);
		pointer-events: none;
		z-index: var(--z-hud);
	}

	.hud > :global(*) {
		max-width: 100%;
	}

	.hud :global(button) {
		pointer-events: auto;
	}

	.hud-top {
		top: var(--below-bar);
		left: var(--free-left);
		right: var(--free-right);
	}

	.hud-bottom {
		bottom: var(--edge);
		left: var(--free-left);
		right: var(--free-right);
	}

	.slide {
		max-width: 100%;
	}

	/* The pause plate: a gilt plate with an hourglass, over the table's top. */
	.pause {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		margin: 0;
		padding: var(--sp-4) var(--sp-7) var(--sp-4) var(--sp-5);
		border-radius: var(--radius-lg);
		box-shadow:
			inset 0 0 0 2px var(--gilt),
			inset 0 0 0 6px rgba(0, 0, 0, 0.3),
			var(--shadow-md),
			0 0 26px rgba(224, 164, 88, 0.25);
		pointer-events: none;
	}

	.pause .glyph {
		display: grid;
		place-items: center;
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 50%;
		background: var(--gilt-grad);
		color: var(--accent-text);
		box-shadow: 0 0 0 1px var(--ink-line);
		z-index: 1;
	}

	.pause .words {
		z-index: 1;
		font-size: var(--fs-md);
	}

	.pause strong {
		font-family: var(--font-label);
		font-size: var(--fs-lg);
		letter-spacing: 0.06em;
		color: var(--gilt-hi);
	}

	/* Who goes next, where the players choose: a plate under the ribbon with a button per name. */
	.handoff {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		max-width: 100%;
		margin: 0;
		padding: var(--sp-3) var(--sp-6);
		border-radius: var(--radius-lg);
		box-shadow:
			inset 0 0 0 1px var(--gilt-line),
			inset 0 0 0 5px rgba(0, 0, 0, 0.28),
			var(--shadow-md);
	}

	.handoff .line {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		z-index: 1;
		font-size: var(--fs-md);
		color: var(--gilt-hi);
	}

	.handoff .picks {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
		z-index: 1;
		pointer-events: auto;
	}

	.handoff .pick {
		min-height: 2.5rem;
	}

	.waiting {
		margin: 0;
		padding: var(--sp-5) var(--sp-7);
		max-width: 36rem;
		border-radius: var(--radius-lg);
		text-align: center;
		pointer-events: none;
	}

	.summary-plate {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		font-size: var(--fs-md);
	}

	/* What the cursor would do: a caption plate over the hotbar. */
	.hint {
		order: -2;
		margin: 0;
		padding: var(--sp-2) var(--sp-6);
		max-width: 100%;
		border: 1px solid var(--ink-line);
		border-radius: var(--radius-sm);
		background: rgba(20, 14, 10, 0.82);
		box-shadow: inset 0 0 0 1px var(--gilt-line);
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: center;
		pointer-events: none;
	}

	.action-dock {
		max-width: 100%;
		pointer-events: auto;
	}

	.solo {
		display: grid;
		place-items: center;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--radius-lg);
		animation: g-pop 460ms var(--spring) both;
	}

	.solo :global(.d20) {
		z-index: 1;
	}

	/* Cut off from the table for good: a plate in the middle of the room, in the dark. */
	.lost {
		position: absolute;
		top: 40%;
		left: 50%;
		z-index: var(--z-modal);
		display: grid;
		justify-items: center;
		gap: var(--sp-4);
		width: min(26rem, calc(100% - 2rem));
		padding: var(--sp-7) var(--sp-8);
		transform: translate(-50%, -50%);
		border-radius: var(--radius-lg);
		text-align: center;
		box-shadow:
			inset 0 0 0 2px rgba(226, 122, 107, 0.65),
			inset 0 0 0 6px rgba(0, 0, 0, 0.3),
			var(--shadow-lg);
	}

	.lost > * {
		z-index: 1;
		margin: 0;
	}

	.lost .out {
		width: 3.2rem;
		height: 3.2rem;
		fill: none;
		stroke: var(--danger);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.lost h2 {
		font-family: var(--font-label);
		font-size: var(--fs-xl);
		letter-spacing: 0.04em;
		color: var(--gilt-hi);
	}

	.lost p {
		color: var(--muted);
	}

	.dock-tabs {
		display: none;
	}

	/* A wide screen gives the side panels more room. */
	@media (min-width: 80rem) {
		.room {
			--side-w: 19rem;
			--chat-w: 21rem;
		}
	}

	@media (max-width: 64rem) {
		.room {
			--chat-w: 17rem;
		}
	}

	/* Small screens: the table fills the screen and one panel at a time rises over it as a sheet. */
	@media (max-width: 48rem) {
		.room {
			--tabs-h: 4rem;
			--free-left: var(--sp-4);
			--free-right: var(--sp-4);
			--edge: var(--sp-4);
		}

		.bar {
			gap: var(--sp-3);
		}

		.bar > :global(*:first-child) {
			flex: 1 1 100%;
		}

		.tools {
			flex: 1 1 100%;
			justify-content: space-between;
			padding: var(--sp-2) var(--sp-3);
		}

		.views button {
			min-height: 2.75rem;
			min-width: 2.75rem;
		}

		.tools :global(.audio button) {
			min-height: 2.75rem;
			min-width: 2.75rem;
		}

		.dock-tabs {
			position: absolute;
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: var(--sp-4);
			z-index: var(--z-panel);
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: var(--sp-3);
			padding: var(--sp-2) var(--sp-3);
			border-radius: var(--radius-lg);
		}

		.dock-tabs button {
			position: relative;
			display: grid;
			justify-items: center;
			align-content: center;
			gap: 0;
			min-height: 2.75rem;
			padding: var(--sp-2) var(--sp-3);
			font-size: var(--fs-xs);
			z-index: 1;
		}

		.dock-tabs .count {
			top: 0.1rem;
			right: 0.6rem;
		}

		.dock-left {
			display: contents;
		}

		.side,
		.chat-dock {
			display: none;
		}

		.side[data-open='true'],
		.chat-dock[data-open='true'] {
			display: flex;
			position: absolute;
			top: auto;
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: calc(var(--tabs-h) + var(--sp-4));
			width: auto;
			z-index: var(--z-panel);
			animation: sheet-up 340ms var(--spring) both;
		}

		.side[data-open='true'] {
			height: min(72vh, calc(100% - var(--below-bar) - var(--tabs-h) - 1rem));
		}

		.chat-dock[data-open='true'] {
			height: min(28rem, 60vh);
		}

		.chat-head .fold {
			display: none;
		}

		.hint[data-hidden='true'],
		.action-dock[data-hidden='true'] {
			display: none;
		}

		.hint {
			font-size: var(--fs-xs);
			padding: var(--sp-2) var(--sp-4);
		}

		.hud-top {
			left: var(--sp-4);
			right: var(--sp-4);
		}

		.hud-bottom {
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: calc(var(--tabs-h) + var(--sp-4));
			align-items: stretch;
		}

		.action-dock {
			align-self: center;
		}

		.hud-bottom > :global(.id) {
			order: -1;
		}

		.pause {
			padding: var(--sp-3) var(--sp-5);
		}

		.views button {
			min-height: 2.75rem;
			min-width: 2.75rem;
		}
	}

	@keyframes sheet-up {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hush,
		.chat-dock,
		.solo,
		.ringer.rung,
		.progress span {
			animation: none;
		}

		.progress span {
			width: 100%;
			opacity: 0.6;
		}

		@media (max-width: 48rem) {
			.side[data-open='true'],
			.chat-dock[data-open='true'] {
				animation: none;
			}
		}
	}
</style>
