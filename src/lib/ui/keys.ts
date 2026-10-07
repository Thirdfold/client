// The key map as one pure table (#279): camera keys and the GM's build tools.
// RoomView looks keys up here, BuildPanel prints them, the Controls popover lists
// them, and keys.spec.ts checks that nothing is bound twice. Camera keys use the
// letters the build tools used to, so tools live on digits, with V, L, P, I and the
// fog keys kept as aliases. Tab is never bound; camera keys never act with Ctrl or Meta.

import type { BuildTool } from './BuildPanel.svelte';

export interface ToolKey {
	tool: BuildTool;
	label: string;
	/** The digit, in the Build panel's order (none for the fog tools). */
	digit: string;
	/** Single letters that also pick it. */
	aliases: string[];
	/** Only while fog of war is on. */
	fog?: true;
}

export const TOOL_KEYS: readonly ToolKey[] = [
	{ tool: 'select', label: 'Select', digit: '1', aliases: ['v'] },
	{ tool: 'wall', label: 'Wall', digit: '2', aliases: [] },
	{ tool: 'door', label: 'Door', digit: '3', aliases: [] },
	{ tool: 'erase', label: 'Erase', digit: '4', aliases: [] },
	{ tool: 'prop', label: 'Place prop', digit: '5', aliases: ['p'] },
	{ tool: 'dark', label: 'Dark area', digit: '6', aliases: [] },
	{ tool: 'floor', label: 'Paint floor', digit: '7', aliases: [] },
	{ tool: 'height', label: 'Shape ground', digit: '8', aliases: [] },
	{ tool: 'light', label: 'Place light', digit: '9', aliases: ['l'] },
	{ tool: 'roof', label: 'Roof', digit: '0', aliases: ['i'] },
	{ tool: 'reveal', label: 'Reveal', digit: '', aliases: ['r'], fog: true },
	{ tool: 'hide', label: 'Hide', digit: '', aliases: ['h'], fog: true },
	{ tool: 'reveal-room', label: 'Reveal room', digit: '', aliases: ['o'], fog: true },
	{ tool: 'hide-room', label: 'Hide room', digit: '', aliases: ['k'], fog: true }
];

/** The tool a key picks (`key` is `KeyboardEvent.key`), or null. Fog tools only while fog is on. */
export function toolForKey(key: string, fogOn: boolean): BuildTool | null {
	const k = key.toLowerCase();
	const hit = TOOL_KEYS.find((t) => (t.digit && t.digit === k) || t.aliases.includes(k));
	return hit && (!hit.fog || fogOn) ? hit.tool : null;
}

/** A tool's keys for display: its digit first, then its aliases, upper-cased. */
export function keysOfTool(tool: BuildTool): string[] {
	const t = TOOL_KEYS.find((x) => x.tool === tool);
	return t ? [...(t.digit ? [t.digit] : []), ...t.aliases.map((a) => a.toUpperCase())] : [];
}

export type CameraAction =
	| 'pan_forward'
	| 'pan_back'
	| 'pan_left'
	| 'pan_right'
	| 'turn_left'
	| 'turn_right'
	| 'snap_left'
	| 'snap_right'
	| 'level_up'
	| 'level_down'
	| 'focus'
	| 'reset'
	| 'grid'
	| 'names';

export interface CameraKey {
	action: CameraAction;
	label: string;
	/** `KeyboardEvent.key`, lower-cased. */
	key: string;
	/** Needs Shift (true); absent means it must not be down. */
	shift?: true;
	/** Active while the key is down (grid, names) rather than on each press. */
	held?: true;
}

export const CAMERA_KEYS: readonly CameraKey[] = [
	{ action: 'pan_forward', label: 'Move forward', key: 'w' },
	{ action: 'pan_left', label: 'Move left', key: 'a' },
	{ action: 'pan_back', label: 'Move back', key: 's' },
	{ action: 'pan_right', label: 'Move right', key: 'd' },
	{ action: 'turn_left', label: 'Turn left', key: 'q' },
	{ action: 'turn_right', label: 'Turn right', key: 'e' },
	{ action: 'snap_left', label: 'Turn 45° left', key: 'q', shift: true },
	{ action: 'snap_right', label: 'Turn 45° right', key: 'e', shift: true },
	{ action: 'level_up', label: 'Up one storey', key: 'pageup' },
	{ action: 'level_down', label: 'Down one storey', key: 'pagedown' },
	{ action: 'focus', label: 'Focus the selection or hovered cell', key: 'f' },
	{ action: 'reset', label: 'Reset the view', key: 'home' },
	{ action: 'grid', label: 'Show the full grid (hold)', key: 'g', held: true },
	{ action: 'names', label: 'Show every name (hold)', key: 'n', held: true }
];

const KEY_LABEL: Record<string, string> = { pageup: 'PgUp', pagedown: 'PgDn', home: 'Home' };
const show = (c: CameraKey) =>
	`${c.shift ? 'Shift+' : ''}${KEY_LABEL[c.key] ?? c.key.toUpperCase()}`;

/** The camera action a key press means, or null. Never with Ctrl, Meta or Alt. */
export function cameraActionForKey(e: {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey?: boolean;
}): CameraAction | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	const k = e.key.toLowerCase();
	return CAMERA_KEYS.find((c) => c.key === k && !!c.shift === e.shiftKey)?.action ?? null;
}

/** Every action a released key may have started (Shift can change before the key does). */
export function cameraActionsForKey(key: string): CameraAction[] {
	const k = key.toLowerCase();
	return CAMERA_KEYS.filter((c) => c.key === k).map((c) => c.action);
}

/** The Controls popover's rows: a label and the keys or gestures for it. */
export interface ControlGroup {
	title: string;
	rows: { label: string; keys: string[] }[];
}

/** Everything the Controls popover lists. `gm` adds the build tools. */
export function controlGroups(gm: boolean): ControlGroup[] {
	const groups: ControlGroup[] = [
		{
			title: 'Mouse',
			rows: [
				{ label: 'Pick up and move your mini', keys: ['Left-drag'] },
				{ label: 'Move the camera', keys: ['Right-drag'] },
				{ label: 'Turn the camera', keys: ['Middle-drag', 'Alt+Left-drag'] },
				{ label: 'Zoom to the cursor', keys: ['Scroll'] },
				{ label: 'Focus on a cell or mini', keys: ['Double-click'] }
			]
		},
		{ title: 'Camera', rows: CAMERA_KEYS.map((c) => ({ label: c.label, keys: [show(c)] })) },
		{
			title: 'Table',
			rows: [
				{ label: 'Step the selected mini one cell', keys: ['↑', '↓', '←', '→'] },
				{ label: 'Let go', keys: ['Esc'] }
			]
		}
	];
	if (gm) {
		groups.push({
			title: 'Build tools',
			rows: TOOL_KEYS.map((t) => ({ label: t.label, keys: keysOfTool(t.tool) }))
		});
	}
	return groups;
}
