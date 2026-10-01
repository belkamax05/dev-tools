/**
 * The bookmark model, shared by both lists bmi reads: the static list shipped with it
 * (`apps/bmi/bookmarks.json`) and the user's own (`~/.config/bmi/config.json`). Both are written
 * the same way —
 *
 * ```jsonc
 * {
 *   "bookmarks": ["https://bun.sh", { "url": "https://ink.dev", "tags": ["tui"] }],
 *   "groups": [
 *     {
 *       "name": "jira",
 *       "description": "The tracker",
 *       "tags": ["tickets"],
 *       "bookmarks": [{ "url": "https://acme.atlassian.net/jira/your-work", "title": "My work" }]
 *     }
 *   ]
 * }
 * ```
 *
 * — and only `url` (and a group's `name`) is ever required. `keywords` is accepted as another
 * name for `tags`, and either may be one comma-separated string.
 */

export interface Bookmark {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface BookmarkGroup {
  name: string;
  description?: string;
  /** Tags every page in the group is found by, on top of its own. */
  tags?: string[];
  bookmarks: Bookmark[];
}

/** One list as it is written in a file. */
export interface BookmarkList {
  /** Pages in no group — raindrop's "Unsorted". */
  bookmarks: Bookmark[];
  groups: BookmarkGroup[];
}

export type Source = 'static' | 'user';

/** A page as the dashboard shows it: both lists merged, its group's tags folded in. */
export interface Entry {
  /** Unique across the merged list: the group key and the page's normalised URL. */
  id: string;
  url: string;
  title?: string;
  description?: string;
  /** The page's own tags. */
  tags: string[];
  /** The group's name as written, or undefined for an ungrouped page. */
  group?: string;
  /** Which lists mention this page — a static page the user also wrote down is both. */
  sources: Source[];
}

export interface Group {
  /** Lower-cased name, what the two lists are matched on. */
  key: string;
  name: string;
  description?: string;
  tags: string[];
  sources: Source[];
  entries: Entry[];
}

export interface Library {
  groups: Group[];
  /** Ungrouped pages first, then each group's, in list order. */
  entries: Entry[];
}

export const emptyList = (): BookmarkList => ({ bookmarks: [], groups: [] });

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** `["a", "b"]`, `"a, b"`, or both fields at once — lower-cased, de-duplicated. */
export const coerceTags = (...raw: unknown[]): string[] => {
  const out = new Set<string>();
  for (const value of raw) {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    for (const part of parts) {
      const tag = text(part)?.replace(/^#/, '').toLowerCase();
      if (tag) out.add(tag);
    }
  }
  return [...out];
};

/**
 * A URL as it was meant: one with no scheme gets `https://` (`github.com/x` is a page, not a
 * path). Undefined for anything that is still not a URL after that.
 */
export const normalizeUrl = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    //? `foo:bar` parses as a URL with scheme foo; only schemes with a host are pages to open
    if (!url.host && url.protocol !== 'file:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

/**
 * What two spellings of one page have in common, so a page in both lists is listed once:
 * no scheme, no `www.`, no trailing slash, no fragment.
 */
export const urlKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** The page's host without `www.` — the shortest name a page always has. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A bookmark's title, or the URL without its scheme when it has none. */
export const displayTitle = (entry: Pick<Entry, 'title' | 'url'>): string =>
  entry.title ?? entry.url.replace(/^[a-z]+:\/\/(www\.)?/i, '').replace(/\/$/, '');

export const coerceBookmark = (raw: unknown): Bookmark | undefined => {
  const record = (typeof raw === 'string' ? { url: raw } : raw) as Record<string, unknown> | null;
  if (!record || typeof record !== 'object') return undefined;
  const url = typeof record.url === 'string' ? normalizeUrl(record.url) : undefined;
  if (!url) return undefined;
  const title = text(record.title) ?? text(record.name);
  const description = text(record.description);
  const tags = coerceTags(record.tags, record.keywords);
  return {
    url,
    ...(title && { title }),
    ...(description && { description }),
    ...(tags.length && { tags }),
  };
};

const coerceBookmarks = (raw: unknown): Bookmark[] =>
  Array.isArray(raw)
    ? raw.map(coerceBookmark).filter((entry): entry is Bookmark => Boolean(entry))
    : [];

/**
 * Keep the well-formed parts of a hand-edited list. A bookmark without a usable URL and a group
 * without a name are dropped; nothing else is required. A group named twice is one group.
 */
export const coerceList = (raw: unknown): BookmarkList => {
  const record = (raw ?? {}) as Record<string, unknown>;
  const groups = new Map<string, BookmarkGroup>();
  for (const value of Array.isArray(record.groups) ? record.groups : []) {
    const group = (value ?? {}) as Record<string, unknown>;
    const name = text(group.name) ?? text(group.title);
    if (!name) continue;
    const description = text(group.description);
    const tags = coerceTags(group.tags, group.keywords);
    const existing = groups.get(name.toLowerCase());
    const bookmarks = coerceBookmarks(group.bookmarks ?? group.pages);
    if (existing) {
      existing.bookmarks.push(...bookmarks);
      continue;
    }
    groups.set(name.toLowerCase(), {
      name,
      ...(description && { description }),
      ...(tags.length && { tags }),
      bookmarks,
    });
  }
  return {
    bookmarks: coerceBookmarks(record.bookmarks),
    groups: [...groups.values()],
  };
};

/** Field by field: what the later list says wins, tags are the union of both. */
const mergeEntry = (into: Entry, page: Bookmark, source: Source) => {
  if (page.title) into.title = page.title;
  if (page.description) into.description = page.description;
  into.tags = coerceTags(into.tags, page.tags);
  if (!into.sources.includes(source)) into.sources.push(source);
};

/**
 * The static list and the user's as one library.
 *
 * Groups are matched by name, regardless of case, and a page by its `urlKey` within its group —
 * the same page in two groups is two entries, on purpose: a page can belong to jira *and* to a
 * release checklist. Where both lists describe the same thing the user's words win, so writing a
 * static page down again with a better title is how it is renamed.
 */
export const mergeLists = (lists: { source: Source; list: BookmarkList }[]): Library => {
  const ungrouped = new Map<string, Entry>();
  const groups = new Map<string, Group & { byUrl: Map<string, Entry> }>();

  const addTo = (
    bucket: Map<string, Entry>,
    group: string | undefined,
    page: Bookmark,
    source: Source,
  ) => {
    const key = urlKey(page.url);
    const existing = bucket.get(key);
    if (existing) {
      mergeEntry(existing, page, source);
      return;
    }
    const entry: Entry = {
      id: `${group?.toLowerCase() ?? ''}\u0000${key}`,
      url: page.url,
      tags: [],
      ...(group !== undefined && { group }),
      sources: [],
    };
    mergeEntry(entry, page, source);
    bucket.set(key, entry);
  };

  for (const { source, list } of lists) {
    for (const page of list.bookmarks) addTo(ungrouped, undefined, page, source);
    for (const written of list.groups) {
      const key = written.name.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          name: written.name,
          tags: [],
          sources: [],
          entries: [],
          byUrl: new Map(),
        };
        groups.set(key, group);
      }
      if (written.description) group.description = written.description;
      group.tags = coerceTags(group.tags, written.tags);
      if (!group.sources.includes(source)) group.sources.push(source);
      for (const page of written.bookmarks) addTo(group.byUrl, group.name, page, source);
    }
  }

  const merged: Group[] = [...groups.values()].map(({ byUrl, ...group }) => ({
    ...group,
    entries: [...byUrl.values()],
  }));
  return {
    groups: merged,
    entries: [...ungrouped.values(), ...merged.flatMap((group) => group.entries)],
  };
};

/* Edits — always to the user's list; the static one is never written by bmi. */

const sameGroup = (a: string | undefined, b: string | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/**
 * The user's list with `page` added to `group`, or — when it is already there — its fields
 * updated in place. `replace` swaps the whole record instead, which is how a field is cleared.
 */
export const withBookmark = (
  list: BookmarkList,
  page: Bookmark,
  group?: string,
  { replace = false }: { replace?: boolean } = {},
): BookmarkList => {
  const upsert = (pages: Bookmark[]) => {
    const key = urlKey(page.url);
    const at = pages.findIndex((existing) => urlKey(existing.url) === key);
    if (at < 0) return [...pages, page];
    return pages.map((existing, index) =>
      index === at ? (replace ? page : { ...existing, ...page }) : existing,
    );
  };
  if (group === undefined) return { ...list, bookmarks: upsert(list.bookmarks) };
  const exists = list.groups.some((written) => sameGroup(written.name, group));
  return {
    ...list,
    groups: exists
      ? list.groups.map((written) =>
          sameGroup(written.name, group)
            ? { ...written, bookmarks: upsert(written.bookmarks) }
            : written,
        )
      : [...list.groups, { name: group, bookmarks: [page] }],
  };
};

/** The user's list without `url` in `group`. Groups are left in place, even when emptied. */
export const withoutBookmark = (list: BookmarkList, url: string, group?: string): BookmarkList => {
  const key = urlKey(url);
  const drop = (pages: Bookmark[]) => pages.filter((page) => urlKey(page.url) !== key);
  if (group === undefined) return { ...list, bookmarks: drop(list.bookmarks) };
  return {
    ...list,
    groups: list.groups.map((written) =>
      sameGroup(written.name, group) ? { ...written, bookmarks: drop(written.bookmarks) } : written,
    ),
  };
};

/** The user's own record of `url` in `group`, if they wrote one down. */
export const findBookmark = (
  list: BookmarkList,
  url: string,
  group?: string,
): Bookmark | undefined => {
  const key = urlKey(url);
  const pages =
    group === undefined
      ? list.bookmarks
      : (list.groups.find((written) => sameGroup(written.name, group))?.bookmarks ?? []);
  return pages.find((page) => urlKey(page.url) === key);
};

/** Whether the user's list has `url` in `group` — what decides if it can be removed. */
export const hasBookmark = (list: BookmarkList, url: string, group?: string): boolean =>
  findBookmark(list, url, group) !== undefined;

/** Add a group, or update its description and tags. Its pages are kept. */
export const withGroup = (
  list: BookmarkList,
  group: Omit<BookmarkGroup, 'bookmarks'>,
): BookmarkList => {
  const exists = list.groups.some((written) => sameGroup(written.name, group.name));
  if (!exists) return { ...list, groups: [...list.groups, { ...group, bookmarks: [] }] };
  return {
    ...list,
    groups: list.groups.map((written) =>
      sameGroup(written.name, group.name) ? { ...written, ...group, name: written.name } : written,
    ),
  };
};

/** Remove the user's group and every page in it. */
export const withoutGroup = (list: BookmarkList, name: string): BookmarkList => ({
  ...list,
  groups: list.groups.filter((written) => !sameGroup(written.name, name)),
});

export default mergeLists;
