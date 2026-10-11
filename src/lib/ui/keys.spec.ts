import { describe, expect, it } from 'vitest';
import { CAMERA_KEYS, TOOL_KEYS, cameraActionForKey, controlGroups, toolForKey } from './keys';

const BUILD_TOOLS = [
	'select',
	'wall',
	'door',
	'erase',
	'prop',
	'dark',
	'floor',
	'height',
	'light',
	'roof',
	'reveal',
	'hide',
	'reveal-room',
	'hide-room'
];
const CAMERA_KEYS_USED = [
	'w',
	'a',
	's',
	'd',
	'q',
	'e',
	'f',
	'g',
	'n',
	'home',
	'pageup',
	'pagedown'
];

describe('the key map', () => {
	it('binds no key twice among tools, or twice among camera keys', () => {
		const tools = TOOL_KEYS.flatMap((t) => [t.digit, ...t.aliases]).filter(Boolean);
		expect(new Set(tools).size).toBe(tools.length);
		const camera = CAMERA_KEYS.map((c) => `${c.shift ? 'shift+' : ''}${c.key}`);
		expect(new Set(camera).size).toBe(camera.length);
	});

	it('gives tools no key the camera uses', () => {
		for (const t of TOOL_KEYS) {
			for (const k of [t.digit, ...t.aliases]) expect(CAMERA_KEYS_USED).not.toContain(k);
		}
		for (const k of CAMERA_KEYS_USED) expect(toolForKey(k, true)).toBeNull();
	});

	it('covers every build tool, with a digit unless it is a fog tool', () => {
		expect(TOOL_KEYS.map((t) => t.tool).sort()).toEqual([...BUILD_TOOLS].sort());
		for (const t of TOOL_KEYS) if (!t.fog) expect(t.digit).toMatch(/^[0-9]$/);
	});

	it('picks tools by digit and alias, fog tools only with fog on', () => {
		expect(toolForKey('2', false)).toBe('wall');
		expect(toolForKey('V', false)).toBe('select');
		expect(toolForKey('r', false)).toBeNull();
		expect(toolForKey('r', true)).toBe('reveal');
	});

	it('maps camera keys, never with Ctrl or Meta, and never Tab', () => {
		const e = { key: 'q', shiftKey: false, ctrlKey: false, metaKey: false };
		expect(cameraActionForKey(e)).toBe('turn_left');
		expect(cameraActionForKey({ ...e, shiftKey: true })).toBe('snap_left');
		expect(cameraActionForKey({ ...e, ctrlKey: true })).toBeNull();
		expect(cameraActionForKey({ ...e, metaKey: true })).toBeNull();
		expect(cameraActionForKey({ ...e, key: 'Tab' })).toBeNull();
		const page = { ...e, key: 'PageUp' };
		expect(cameraActionForKey(page)).toBe('level_up');
		expect(cameraActionForKey({ ...page, shiftKey: true })).toBe('cut_up'); // #281
	});

	it('lists every binding in the popover', () => {
		const rows = controlGroups(true).flatMap((g) => g.rows);
		expect(rows.length).toBeGreaterThanOrEqual(CAMERA_KEYS.length + TOOL_KEYS.length);
		expect(controlGroups(false).some((g) => g.title === 'Build tools')).toBe(false);
	});
});
