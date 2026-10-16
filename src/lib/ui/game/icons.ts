/**
 * thirdfold's icon set: one hand-set family, drawn on a 24 grid with a 1.75 stroke, round caps and
 * joins, so every glyph on every screen has the same weight. Each value is the inner markup of an
 * `<svg viewBox="0 0 24 24">` that strokes in `currentColor`; solid details use `fill="currentColor"
 * stroke="none"`. These are static strings written here, never user input.
 */
const dot = (x: number, y: number, r = 1.1) =>
	`<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
	d20: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><path d="M12 2.8 7.5 15.5h9z"/><path d="M4 7.4l3.5 8.1M20 7.4l-3.5 8.1M7.5 15.5 12 21.2l4.5-5.7"/>',
	dice: `<rect x="4" y="4" width="16" height="16" rx="3.5"/>${dot(9, 9)}${dot(15, 9)}${dot(12, 12)}${dot(9, 15)}${dot(15, 15)}`,
	scroll:
		'<path d="M8 4h9a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H7a3 3 0 0 0 3-3V6a2 2 0 0 0-2-2z"/><path d="M8 4a2 2 0 0 0-2 2v1.5h4"/><path d="M13 9h3.5M13 12.5h3.5"/>',
	book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
	sword:
		'<path d="M20.5 3.5 9.5 14.5"/><path d="M16 3.5h4.5V8"/><path d="m6.5 13 4.5 4.5"/><path d="m4 20 3-3"/>',
	shield:
		'<path d="M12 3 5 5.5v6c0 4.2 2.9 7.4 7 9.5 4.1-2.1 7-5.3 7-9.5v-6z"/><path d="M12 7v9"/>',
	flame:
		'<path d="M12 3c1 3.2 4.5 5 4.5 9.2A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.8c0-1.6.8-2.7 1.6-3.6.3 1.2.9 1.8 1.6 2C10.7 8 11 5.5 12 3z"/><path d="M12 17v4"/>',
	chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z"/>',
	map: '<path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
	sound:
		'<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
	mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 4 5M20 9.5l-4 5"/>',
	eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
	eyeoff:
		'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="m4 4 16 16"/>',
	door: `<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M4 21h16"/>${dot(14.5, 12.5, 0.9)}`,
	crown: '<path d="M4 17 3.5 7.5l4.5 4 4-6.5 4 6.5 4.5-4L20 17z"/><path d="M5 20.5h14"/>',
	heart:
		'<path d="M12 20.5S3.5 15.3 3.5 9.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 8.5 1.8c0 6.1-8.5 11.3-8.5 11.3z"/>',
	star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
	lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
	key: '<circle cx="8" cy="15.5" r="3.5"/><path d="m10.5 13 9-9M16 8l2.5 2.5M13.5 10.5 16 13"/>',
	play: '<path d="M7 4.5v15l12-7.5z"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	close: '<path d="m6 6 12 12M18 6 6 18"/>',
	check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
	trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6"/>',
	copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
	link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 10 18.7l1-1"/>',
	user: '<circle cx="12" cy="8" r="3.7"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
	users:
		'<circle cx="9" cy="8.5" r="3.2"/><path d="M2.8 20c.7-3.6 3.2-5.4 6.2-5.4s5.5 1.8 6.2 5.4"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6.2M18 14.8c1.9.7 3 2.5 3.4 5.2"/>',
	skull: `<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.6 1.3 4.4 3 5.4V19h9v-3.1c1.7-1 3-2.8 3-5.4 0-4-3.1-7-7.5-7z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 19v-2M13.5 19v-2"/>`,
	hourglass:
		'<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5"/>',
	back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
	chevron: '<path d="m9 5 7 7-7 7"/>',
	flag: '<path d="M5.5 21V3.5M5.5 4.5h11l-2 4 2 4h-11"/>',
	pencil: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="m14.5 6 3 3"/>',
	wand: '<path d="m5 19 11-11"/><path d="m14.5 3.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7zM19.5 10l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
	compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
	bell: '<path d="M6 17.5c1-1.2 1.5-2.5 1.5-5V10a4.5 4.5 0 0 1 9 0v2.5c0 2.5.5 3.8 1.5 5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
	upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
	save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
	menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
	refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.5-5.6M19.5 4v4.5H15"/>',
	cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>',
	grid: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h16M12 4v16"/>',
	sparkle:
		'<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>',
	home: '<path d="m3.5 11.5 8.5-7.5 8.5 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
	warn: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
	search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
	pause: '<path d="M8.5 5v14M15.5 5v14"/>',
	cursor: '<path d="M5.5 3.5v15l4-3.7 2.7 5.7 2.4-1.1-2.7-5.6h5.6z"/>',
	download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
	info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>'
} as const;

export type IconName = keyof typeof ICONS;
