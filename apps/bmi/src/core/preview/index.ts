import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import decodePng from '@/dev-tools/terminal-canvas/decodePng';
import encodePng from '@/dev-tools/terminal-canvas/encodePng';
import { appCacheDir } from '@/dev-tools/utils/config/configHome';

import { urlKey } from '../bookmarks';
import { type DecodedImage, decodeIcon, fitIcon } from '../icon';

/** What a page says about itself — its Open Graph tags, or its plain `<title>` and description. */
export interface Preview {
  /** The bookmark's URL, as fetched. */
  url: string;
  /** Where the redirects ended — a different host usually means a login page. */
  finalUrl?: string;
  status?: number;
  title?: string;
  description?: string;
  siteName?: string;
  /** `og:image`, absolute. Linked, not drawn: it is a JPEG more often than not. */
  image?: string;
  /** Where the favicon came from, and the PNG it was cached as (inside the cache directory). */
  iconUrl?: string;
  iconFile?: string;
  fetchedAt: number;
  error?: string;
}

/** Re-fetched after this long; a failure is retried sooner, since it is often a flaky network. */
export const PREVIEW_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
/** Enough for any `<head>`; a page is never read past this, or past `</head>`. */
const MAX_HTML_BYTES = 512 * 1024;
const MAX_ICON_BYTES = 256 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; bmi/1.0; +link preview)';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/** `<meta a="1" b='2' c=3>` → `{ a: '1', b: '2', c: '3' }`, names lower-cased. */
const attributes = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const [, name = '', , double, single, bare] = match;
    out[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return out;
};

const clean = (text: string | undefined) => {
  const value = text?.replace(/\s+/g, ' ').trim();
  return value ? value : undefined;
};

export interface IconLink {
  href: string;
  rel: string;
  type?: string;
  sizes?: string;
}

export interface ParsedHead {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  icons: IconLink[];
}

/**
 * The parts of a page's `<head>` a preview is made of. A regex reading of the tags, not a parse —
 * which is all `<meta>` and `<link>` need, and survives the half-page the fetch stops at.
 */
export const parseHead = (html: string, baseUrl: string): ParsedHead => {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const meta: Record<string, string> = {};
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const absolute = (href: string | undefined) => {
    if (!href) return undefined;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return undefined;
    }
  };
  const icons: IconLink[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const rel = attrs.rel?.toLowerCase() ?? '';
    const href = absolute(attrs.href);
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel) || rel.includes('mask-icon')) continue;
    icons.push({
      href,
      rel,
      type: attrs.type?.toLowerCase(),
      sizes: attrs.sizes?.toLowerCase(),
    });
  }
  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? decodeEntities(titleTag ?? '')),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description),
    siteName: clean(meta['og:site_name'] ?? meta['application-name']),
    image: absolute(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image']),
    icons,
  };
};

/**
 * The favicons worth trying, best first: a PNG near 32-64px, then any other PNG (an
 * apple-touch-icon is 180px and always PNG), then an ICO, then `/favicon.ico` — which is where
 * browsers look when a page names none. SVG is left out: there is nothing here to rasterise it.
 */
export const iconCandidates = (icons: IconLink[], pageUrl: string): string[] => {
  const isSvg = (icon: IconLink) => icon.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(icon.href);
  const size = (icon: IconLink) => {
    const match = icon.sizes?.match(/(\d+)x\d+/);
    return match ? Number(match[1]) : icon.rel.includes('apple') ? 180 : 0;
  };
  const rank = (icon: IconLink) => {
    const px = size(icon);
    const png = icon.type === 'image/png' || /\.png(\?|$)/i.test(icon.href);
    if (png && px >= 32 && px <= 64) return 0;
    if (png) return 1;
    return 2;
  };
  const ordered = icons
    .filter((icon) => !isSvg(icon))
    .sort((a, b) => rank(a) - rank(b) || Math.abs(size(a) - 48) - Math.abs(size(b) - 48))
    .map((icon) => icon.href);
  try {
    ordered.push(new URL('/favicon.ico', pageUrl).href);
  } catch {}
  return [...new Set(ordered)];
};

/** Read at most `limit` bytes of a response, stopping early once `until` has been seen. */
const readCapped = async (response: Response, limit: number, until?: RegExp) => {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const decoder = until ? new TextDecoder() : undefined;
  let tail = '';
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (decoder && until) {
      tail = (tail + decoder.decode(value, { stream: true })).slice(-4096);
      if (until.test(tail)) break;
    }
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) break;
  }
  return out;
};

const get = (url: string, accept: string) =>
  fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en' },
  });

/** Fetch a page and its favicon, and say what they are. Never throws; a failure is `error`. */
export const fetchPreview = async (
  url: string,
  saveIcon: (key: string, image: DecodedImage) => Promise<string>,
): Promise<Preview> => {
  const preview: Preview = { url, fetchedAt: Date.now() };
  let head: ParsedHead = { icons: [] };
  let base = url;
  try {
    const response = await get(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
    preview.status = response.status;
    preview.finalUrl = response.url || url;
    base = preview.finalUrl;
    const type = response.headers.get('content-type') ?? '';
    if (/html|xml/i.test(type) || !type) {
      const bytes = await readCapped(response, MAX_HTML_BYTES, /<\/head\s*>/i);
      head = parseHead(new TextDecoder().decode(bytes), base);
    } else response.body?.cancel().catch(() => {});
    for (const key of ['title', 'description', 'siteName', 'image'] as const) {
      if (head[key]) preview[key] = head[key];
    }
    if (!response.ok) preview.error = `HTTP ${response.status}`;
  } catch (error) {
    preview.error = (error as Error).message || 'fetch failed';
  }

  //? Tried even when the page failed — a 401 page or a timeout on a heavy one still has a host
  //? whose /favicon.ico answers
  for (const candidate of iconCandidates(head.icons, base)) {
    try {
      const response = await get(candidate, 'image/png,image/x-icon,image/*;q=0.8');
      if (!response.ok) continue;
      const image = fitIcon(decodeIcon(await readCapped(response, MAX_ICON_BYTES)));
      preview.iconUrl = candidate;
      preview.iconFile = await saveIcon(candidate, image);
      break;
    } catch {}
  }
  return preview;
};

/** Whether a cached preview is still good, or should be fetched again. */
export const isFresh = (preview: Preview | undefined, now = Date.now()): boolean =>
  Boolean(preview) &&
  now - (preview as Preview).fetchedAt <
    ((preview as Preview).error && !(preview as Preview).title ? FAILURE_TTL_MS : PREVIEW_TTL_MS);

export interface PreviewCache {
  readonly directory: string;
  /** Read the index from disk; `get` sees nothing until this (or an `ensure`) has run. */
  load: () => Promise<void>;
  get: (url: string) => Preview | undefined;
  /** The cached preview when fresh, else a fetch — one at a time per page, however often asked. */
  ensure: (url: string, options?: { force?: boolean }) => Promise<Preview>;
  /** The favicon's pixels, for a preview that has one. */
  icon: (preview: Preview | undefined) => Promise<DecodedImage | undefined>;
  clear: () => Promise<void>;
}

/**
 * `~/.cache/bmi`: `previews.json`, one record per page, and `icons/`, each favicon re-encoded as a
 * small PNG — whatever it was served as — so drawing one never decodes an ICO twice. Icons are
 * keyed on the icon's own URL, so every page on one host shares a file.
 *
 * Everything here can be fetched again, which is why it is cache and not state.
 */
export const createPreviewCache = (directory = appCacheDir('bmi')): PreviewCache => {
  const indexPath = join(directory, 'previews.json');
  const iconsDir = join(directory, 'icons');
  let records: Record<string, Preview> | undefined;
  const pending = new Map<string, Promise<Preview>>();
  const icons = new Map<string, DecodedImage>();
  let saving: Promise<void> = Promise.resolve();

  const load = async () => {
    if (records) return records;
    try {
      const parsed: unknown = await Bun.file(indexPath).json();
      records = parsed && typeof parsed === 'object' ? (parsed as Record<string, Preview>) : {};
    } catch {
      records = {};
    }
    return records;
  };

  //? Chained so two previews finishing together cannot interleave their writes of one file
  const persist = () => {
    saving = saving
      .then(() => Bun.write(indexPath, `${JSON.stringify(records ?? {}, null, 2)}\n`))
      .then(
        () => {},
        () => {},
      );
    return saving;
  };

  const saveIcon = async (iconUrl: string, image: DecodedImage) => {
    const name = `${createHash('sha1').update(iconUrl).digest('hex').slice(0, 16)}.png`;
    await mkdir(iconsDir, { recursive: true });
    await Bun.write(join(iconsDir, name), encodePng(image.rgba, image.width, image.height));
    icons.set(name, image);
    return name;
  };

  return {
    directory,
    load: async () => {
      await load();
    },
    get: (url) => records?.[urlKey(url)],
    async ensure(url, { force = false } = {}) {
      const all = await load();
      const key = urlKey(url);
      const cached = all[key];
      if (!force && cached && isFresh(cached)) return cached;
      const running = pending.get(key);
      if (running) return running;
      const job = fetchPreview(url, saveIcon).then(async (preview) => {
        all[key] = preview;
        pending.delete(key);
        await persist();
        return preview;
      });
      pending.set(key, job);
      return job;
    },
    async icon(preview) {
      const name = preview?.iconFile;
      if (!name) return undefined;
      const cached = icons.get(name);
      if (cached) return cached;
      try {
        const image = decodePng(new Uint8Array(await Bun.file(join(iconsDir, name)).arrayBuffer()));
        icons.set(name, image);
        return image;
      } catch {
        return undefined;
      }
    },
    async clear() {
      records = {};
      icons.clear();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

/** A cache with its index already read, so `get` answers from the first render. */
export const openPreviewCache = async (directory?: string): Promise<PreviewCache> => {
  const cache = createPreviewCache(directory);
  await cache.load();
  return cache;
};

export default createPreviewCache;
