// Where the CC0 packs come from (docs/ASSETS.md "CC0 packs (milestone 76)"): one pinned download
// per source, a file or a zip, fetched once and kept by its SHA-256 in art/_packs/ (gitignored),
// so every model of a pack reads the same copy. Hosts are listed one by one; a redirect to any
// other host is refused. itch.io has no static URL, only a three-step anonymous flow whose last
// link is signed for a minute, so there the page is the URL and the hash is the whole pin.
// Sketchfab (a model's page, `https://sketchfab.com/models/<uid>`) is the same: its glTF archive is
// a signed link too, got through the v3 API with the owner's token (`SKETCHFAB_TOKEN`, never
// logged or sent past api.sketchfab.com), only for a model whose licence the API says is CC0.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Exact hosts (docs/ART.md section 12: CC0 only), by who serves what. */
export const HOSTS: readonly string[] = [
	'dl.polyhaven.org',
	'api.polyhaven.com',
	'ambientcg.com',
	'opengameart.org',
	'kenney.nl',
	'raw.githubusercontent.com',
	'github.com',
	'codeload.github.com',
	'static.poly.pizza',
	'api.sketchfab.com'
];

const ITCH_PAGE = /^[a-z0-9-]+\.itch\.io$/;
/** itch.io's download mirror: signed, short-lived URLs on Cloudflare R2. */
const ITCH_MIRROR = /^itchio-mirror\.[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/;

/** Sketchfab's signed download links: its media bucket on S3. */
const SKETCHFAB_MEDIA = 'sketchfab-prod-media.s3.amazonaws.com';
const SKETCHFAB_API = 'https://api.sketchfab.com/v3/models';
const SKETCHFAB_MODEL = /^\/(?:models\/|3d-models\/(?:[a-z0-9-]*-)?)([0-9a-f]{32})\/?$/;

export const hostAllowed = (host: string) =>
	HOSTS.includes(host) ||
	host === SKETCHFAB_MEDIA ||
	ITCH_PAGE.test(host) ||
	ITCH_MIRROR.test(host);

export const isItch = (url: string) => ITCH_PAGE.test(new URL(url).hostname);

/** A Sketchfab model's uid, from its page URL; null for any other URL. */
export function sketchfabUid(url: string): string | null {
	const u = new URL(url);
	if (u.protocol !== 'https:' || u.hostname !== 'sketchfab.com') return null;
	return SKETCHFAB_MODEL.exec(u.pathname)?.[1] ?? null;
}

export const UNPINNED = '0'.repeat(64);
const MAX_BYTES = 400 * 1024 * 1024;
const MAX_HOPS = 5;

export interface Pin {
	url: string;
	sha256: string;
}

export interface FetchOptions {
	/** Where packs are kept by hash. */
	cache: string;
	/** Accept a pin of all zeros and report the hash (the meta is then rewritten by the caller). */
	record?: (sha256: string) => void;
	/** itch.io: which upload of the page, when it has several. */
	upload?: string;
	/** Sketchfab's API token (`SKETCHFAB_TOKEN` when absent). Sent to api.sketchfab.com only. */
	token?: string;
	/** For tests. */
	fetchFn?: typeof fetch;
	log?: (message: string) => void;
}

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

type Get = (url: string, init?: RequestInit) => Promise<Response>;

/** A GET that follows redirects by hand, so each hop's host is checked. */
function getter(fetchFn: typeof fetch, jar: Map<string, string>): Get {
	const hop = async (url: string, init: RequestInit, hops: number): Promise<Response> => {
		if (!hostAllowed(new URL(url).hostname))
			throw new Error(`${url} is not a CC0 host we fetch from`);
		const headers = new Headers(init.headers);
		headers.set('User-Agent', 'thirdfold');
		if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
		const res = await fetchFn(url, { ...init, headers, redirect: 'manual' });
		for (const c of res.headers.getSetCookie?.() ?? []) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
		}
		const next = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && next) {
			if (hops >= MAX_HOPS) throw new Error(`${url}: too many redirects`);
			return hop(new URL(next, url).href, {}, hops + 1); // a redirect is followed with a GET
		}
		if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
		return res;
	};
	return (url, init = {}) => hop(url, init, 0);
}

async function bytes(res: Response): Promise<Uint8Array> {
	if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('download too large');
	const data = new Uint8Array(await res.arrayBuffer());
	if (data.length > MAX_BYTES) throw new Error('download too large');
	return data;
}

/**
 * The glTF archive of a Sketchfab model, through the v3 API: the model's record first, refused
 * unless its licence is CC0 and it can be downloaded, then `/download`, whose signed link (good
 * for five minutes) is fetched without the token.
 */
export async function sketchfabDownload(
	uid: string,
	token: string | undefined,
	fetchFn: typeof fetch = fetch
): Promise<Uint8Array> {
	if (!token) throw new Error('Sketchfab needs SKETCHFAB_TOKEN (in .env or the environment)');
	const get = getter(fetchFn, new Map());
	const auth = { headers: { Authorization: `Token ${token}` } };
	const model = (await (await get(`${SKETCHFAB_API}/${uid}`, auth)).json()) as {
		license?: { slug?: string; label?: string } | null;
		isDownloadable?: boolean;
	};
	if (model.license?.slug !== 'cc0') {
		throw new Error(
			`Sketchfab ${uid}: licence is "${model.license?.label ?? 'unknown'}", not CC0: refused`
		);
	}
	if (model.isDownloadable === false) throw new Error(`Sketchfab ${uid}: not downloadable`);
	const links = (await (await get(`${SKETCHFAB_API}/${uid}/download`, auth)).json()) as {
		gltf?: { url?: string };
	};
	if (!links.gltf?.url) throw new Error(`Sketchfab ${uid}: no glTF archive`);
	return bytes(await get(links.gltf.url));
}

const csrfOf = (html: string) => /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
const form = (csrf: string) => ({
	method: 'POST',
	headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	body: `csrf_token=${encodeURIComponent(csrf)}`
});

/**
 * itch.io's anonymous download of a free or name-your-own-price page: the page's csrf token,
 * POST /download_url, the download page, POST /file/<upload>, and a signed URL good for a minute.
 */
export async function itchDownload(
	page: string,
	upload: string | undefined,
	fetchFn: typeof fetch = fetch
): Promise<Uint8Array> {
	const get = getter(fetchFn, new Map());
	const base = page.replace(/\/$/, '');
	const csrf = csrfOf(await (await get(base)).text());
	if (!csrf) throw new Error(`${page}: no csrf token`);
	const { url } = (await (await get(`${base}/download_url`, form(csrf))).json()) as {
		url?: string;
	};
	if (!url) throw new Error(`${page}: no download page`);
	const html = await (await get(url)).text();
	const csrf2 = csrfOf(html);
	const ids = [...html.matchAll(/data-upload_id="(\d+)"/g)].map((m) => m[1]);
	const id = upload ?? ids[0];
	if (!csrf2 || !id || (upload && !ids.includes(upload))) {
		throw new Error(
			`${page}: upload ${upload ?? '?'} not found (it has ${ids.join(', ') || 'none'})`
		);
	}
	const query = 'source=view_game&as_props=1&after_download_lightbox=true';
	const signed = (await (await get(`${base}/file/${id}?${query}`, form(csrf2))).json()) as {
		url?: string;
	};
	if (!signed.url) throw new Error(`${page}: no signed download`);
	return bytes(await get(signed.url));
}

/**
 * The pinned download's bytes: kept in `<cache>/<sha256>.<ext>` once fetched, so a pack is read
 * from disk after that and by every model of it. A hash that doesn't match is an error and
 * nothing is kept.
 */
export async function fetchPinned(pin: Pin, opts: FetchOptions): Promise<Uint8Array> {
	const url = new URL(pin.url);
	const uid = sketchfabUid(pin.url);
	if (url.protocol !== 'https:' || !(uid || hostAllowed(url.hostname))) {
		throw new Error(`${pin.url} is not a CC0 host we fetch from (docs/ASSETS.md "CC0 packs")`);
	}
	const itch = isItch(pin.url);
	const ext = itch || uid ? 'zip' : path.extname(url.pathname).slice(1).toLowerCase() || 'bin';
	const local = path.join(opts.cache, `${pin.sha256}.${ext}`);
	if (pin.sha256 !== UNPINNED && existsSync(local)) return readFileSync(local);
	opts.log?.(`fetching ${pin.url}`);
	const data = uid
		? await sketchfabDownload(uid, opts.token ?? process.env.SKETCHFAB_TOKEN, opts.fetchFn)
		: itch
			? await itchDownload(pin.url, opts.upload, opts.fetchFn)
			: await bytes(await getter(opts.fetchFn ?? fetch, new Map())(pin.url));
	const got = sha256(data);
	if (pin.sha256 === UNPINNED && opts.record) opts.record(got);
	else if (got !== pin.sha256) {
		throw new Error(`${pin.url}: the download's SHA-256 is ${got}, not ${pin.sha256}`);
	}
	mkdirSync(opts.cache, { recursive: true });
	writeFileSync(path.join(opts.cache, `${got}.${ext}`), data);
	return data;
}
