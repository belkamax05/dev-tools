/**
 * The bookmark model, shared by both lists bmi reads: the project's own (`bookmarks.config.json`
 * at its root, or under `config/`) and the user's own (`~/.config/bmi/config.json`). Both are written
 * the same way —
 *
 * ```jsonc
 * {
 *   "tags": {
 *     "jira": { "description": "The tracker", "order": 1 },
 *     "repositories/gitlab": {}
 *   },
 *   "bookmarks": [
 *     "https://bun.sh",
 *     { "url": "https://acme.atlassian.net/jira/your-work", "title": "My work", "tags": ["jira", "sprint"] }
 *   ]
 * }
 * ```
 *
 * — and only a bookmark's `url` is ever required. There is one way to file a page: a tag. A tag
 * written down under `tags` is *declared*, which makes it a category — a section of its own, with a
 * description — and every other tag is a plain label, for search. Tags nest with `/`:
 * `repositories/gitlab` implies `repositories`. `keywords` is accepted as another name for `tags`,
 * and either may be one comma-separated string.
 *
 * The `groups` this file used to have (`[{ name, description, tags, bookmarks }]`) are still read:
 * each group is a declared tag, put on each of its pages along with the group's own tags.
 */

import { coerceRepoToggles, type RepoToggles } from '../repoLinks';

export interface Bookmark {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  /** For a GitHub repository: which of its feature links the detail pane offers — see `repoLinks`. */
  github?: RepoToggles;
}

/** What a declared tag says about itself. */
export interface TagMeta {
  description?: string;
  /** Sorts declared tags among their siblings: lower first, then the ones without, in list order. */
  order?: number;
}

/** One list as it is written in a file. */
export interface BookmarkList {
  /** The declared tags — the categories — by tag. */
  tags: Record<string, TagMeta>;
  bookmarks: Bookmark[];
}

export type Source = 'workspace' | 'user';

/** A page as the dashboard shows it: both lists' records of one URL, merged. */
export interface Entry {
  /** The page's `urlKey`: one entry per page, however many categories it is in. */
  id: string;
  url: string;
  title?: string;
  description?: string;
  /** Every tag either list gives the page, as written — not their implied parents. */
  tags: string[];
  /** Which lists mention this page — a workspace page the user also wrote down is both. */
  sources: Source[];
  /** Both lists' `github` toggles, the user's winning key by key. */
  github?: RepoToggles;
}

export interface Tag {
  /** The whole path, `repositories/gitlab`. */
  key: string;
  /** The last segment, `gitlab`. */
  name: string;
  /** The declared tag above it, for a declared one; undefined at the top. */
  parent?: string;
  /** How deep it sits under declared tags: 0 at the top. */
  depth: number;
  description?: string;
  order?: number;
  /** Written down under `tags` in either list: a category. Otherwise a plain label. */
  declared: boolean;
  /** Which lists declare it — empty for a plain label. */
  sources: Source[];
  /** The pages tagged with it or with anything under it. */
  entries: Entry[];
}

export interface Library {
  /** Every page, in list order: the workspace's first, then the user's. */
  entries: Entry[];
  /** The declared tags as a tree (each parent before its children), then the plain ones, A–Z. */
  tags: Tag[];
}

export const emptyList = (): BookmarkList => ({ tags: {}, bookmarks: [] });

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** `" Repositories / GitLab "` → `repositories/gitlab`; undefined when nothing is left. */
export const normalizeTag = (raw: unknown): string | undefined => {
  const path = text(raw)
    ?.replace(/^#/, '')
    .toLowerCase()
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
  return path || undefined;
};

/** `["a", "b"]`, `"a, b"`, or both fields at once — normalised, de-duplicated. */
export const coerceTags = (...raw: unknown[]): string[] => {
  const out = new Set<string>();
  for (const value of raw) {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    for (const part of parts) {
      const tag = normalizeTag(part);
      if (tag) out.add(tag);
    }
  }
  return [...out];
};

/** A tag and every tag it implies: `a/b/c` → `a`, `a/b`, `a/b/c`. */
export const expandTag = (tag: string): string[] => {
  const segments = tag.split('/');
  return segments.map((_, at) => segments.slice(0, at + 1).join('/'));
};

/** Whether `tag` is `ancestor` or sits under it. */
export const isUnder = (tag: string, ancestor: string): boolean =>
  tag === ancestor || tag.startsWith(`${ancestor}/`);

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

/** Whether the project's list ships this page or tag — even when the user's list adds to it. */
export const isFromWorkspace = (item: Pick<Entry, 'sources'>): boolean =>
  item.sources.includes('workspace');

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
  const github = coerceRepoToggles(record.github);
  return {
    url,
    ...(title && { title }),
    ...(description && { description }),
    ...(tags.length && { tags }),
    ...(github && { github }),
  };
};

/** Field by field: what comes later wins, the tags are the union of both. */
const mergeBookmark = (into: Bookmark, page: Bookmark): Bookmark => {
  const tags = coerceTags(into.tags, page.tags);
  const github = into.github || page.github ? { ...into.github, ...page.github } : undefined;
  return {
    url: into.url,
    ...((page.title ?? into.title) && { title: page.title ?? into.title }),
    ...((page.description ?? into.description) && {
      description: page.description ?? into.description,
    }),
    ...(tags.length && { tags }),
    ...(github && { github }),
  };
};

const coerceMeta = (raw: unknown): TagMeta => {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const description = text(record.description) ?? (typeof raw === 'string' ? text(raw) : undefined);
  const order = typeof record.order === 'number' && Number.isFinite(record.order) ? record.order : undefined;
  return {
    ...(description && { description }),
    ...(order !== undefined && { order }),
  };
};

/**
 * Keep the well-formed parts of a hand-edited list. A bookmark without a usable URL is dropped;
 * one page written twice is one page, its tags joined.
 *
 * `tags` may be the map (`{ "jira": { "description": "…" } }`) or a list of names or of
 * `{ name, description?, order? }`. The old `groups` are read too — see the module comment.
 */
export const coerceList = (raw: unknown): BookmarkList => {
  const record = (raw ?? {}) as Record<string, unknown>;
  const tags: Record<string, TagMeta> = {};
  const declare = (rawKey: unknown, meta: TagMeta) => {
    const key = normalizeTag(rawKey);
    if (key) tags[key] = { ...tags[key], ...meta };
    return key;
  };

  if (Array.isArray(record.tags)) {
    for (const value of record.tags) {
      if (typeof value === 'string') declare(value, {});
      else if (value && typeof value === 'object') {
        declare((value as Record<string, unknown>).name, coerceMeta(value));
      }
    }
  } else if (record.tags && typeof record.tags === 'object') {
    for (const [key, value] of Object.entries(record.tags)) declare(key, coerceMeta(value));
  }

  const pages = new Map<string, Bookmark>();
  const file = (page: Bookmark) => {
    const key = urlKey(page.url);
    const existing = pages.get(key);
    pages.set(key, existing ? mergeBookmark(existing, page) : page);
  };
  for (const value of Array.isArray(record.bookmarks) ? record.bookmarks : []) {
    const page = coerceBookmark(value);
    if (page) file(page);
  }

  //? The old shape: a group is a declared tag, and its own tags were every page's tags
  for (const value of Array.isArray(record.groups) ? record.groups : []) {
    const group = (value ?? {}) as Record<string, unknown>;
    const key = declare(group.name ?? group.title, coerceMeta(group));
    if (!key) continue;
    const implied = [key, ...coerceTags(group.tags, group.keywords)];
    const written = group.bookmarks ?? group.pages;
    for (const each of Array.isArray(written) ? written : []) {
      const page = coerceBookmark(each);
      if (page) file({ ...page, tags: coerceTags(implied, page.tags) });
    }
  }

  return { tags, bookmarks: [...pages.values()] };
};

/** Field by field: what the later list says wins, tags are the union of both. */
const mergeEntry = (into: Entry, page: Bookmark, source: Source) => {
  if (page.title) into.title = page.title;
  if (page.description) into.description = page.description;
  into.tags = coerceTags(into.tags, page.tags);
  if (page.github) into.github = { ...into.github, ...page.github };
  if (!into.sources.includes(source)) into.sources.push(source);
};

interface Declaration extends TagMeta {
  key: string;
  sources: Source[];
}

/**
 * The tags a library shows, from its pages and what is declared: the declared ones as a tree, then
 * every other tag a page carries.
 */
const indexTags = (entries: Entry[], declarations: Declaration[]): Tag[] => {
  const declared = new Map(declarations.map((each) => [each.key, each]));
  const parentOf = (key: string) =>
    expandTag(key)
      .slice(0, -1)
      .reverse()
      .find((candidate) => declared.has(candidate));
  const entriesUnder = (key: string) =>
    entries.filter((entry) => entry.tags.some((tag) => isUnder(tag, key)));

  const byOrder = (a: Declaration, b: Declaration) =>
    (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY);
  const tree: Tag[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    const children = declarations.filter((each) => parentOf(each.key) === parent).sort(byOrder);
    for (const each of children) {
      tree.push({
        key: each.key,
        name: each.key.slice(parent ? parent.length + 1 : 0),
        ...(parent !== undefined && { parent }),
        depth,
        ...(each.description && { description: each.description }),
        ...(each.order !== undefined && { order: each.order }),
        declared: true,
        sources: each.sources,
        entries: entriesUnder(each.key),
      });
      walk(each.key, depth + 1);
    }
  };
  walk(undefined, 0);

  const plain = [...new Set(entries.flatMap((entry) => entry.tags))]
    .filter((tag) => !declared.has(tag))
    .sort()
    .map(
      (key): Tag => ({
        key,
        name: key,
        depth: 0,
        declared: false,
        sources: [],
        entries: entriesUnder(key),
      }),
    );
  return [...tree, ...plain];
};

const declarationsOf = (library: Library): Declaration[] =>
  library.tags
    .filter((tag) => tag.declared)
    .map((tag) => ({
      key: tag.key,
      sources: tag.sources,
      ...(tag.description && { description: tag.description }),
      ...(tag.order !== undefined && { order: tag.order }),
    }));

/**
 * The workspace list and the user's as one library.
 *
 * A page is one entry, matched by its `urlKey` across both lists; a declared tag is matched by
 * name. Where both describe the same thing the user's words win, so writing a workspace page down
 * again with a better title is how it is renamed — and its tags are the union, so the user can add
 * tags (and categories) to a workspace page but not take the workspace's away.
 */
export const mergeLists = (lists: { source: Source; list: BookmarkList }[]): Library => {
  const pages = new Map<string, Entry>();
  const declared = new Map<string, Declaration>();

  for (const { source, list } of lists) {
    for (const [key, meta] of Object.entries(list.tags)) {
      const existing = declared.get(key) ?? { key, sources: [] };
      declared.set(key, {
        ...existing,
        ...meta,
        sources: existing.sources.includes(source)
          ? existing.sources
          : [...existing.sources, source],
      });
    }
    for (const page of list.bookmarks) {
      const id = urlKey(page.url);
      let entry = pages.get(id);
      if (!entry) {
        entry = { id, url: page.url, tags: [], sources: [] };
        pages.set(id, entry);
      }
      mergeEntry(entry, page, source);
    }
  }

  const entries = [...pages.values()];
  return { entries, tags: indexTags(entries, [...declared.values()]) };
};

/**
 * Only what the project's list ships: the user's own pages and categories left out, while a
 * workspace page the user retitled or tagged stays, with their words.
 */
export const workspaceOnly = (library: Library): Library => {
  const entries = library.entries.filter(isFromWorkspace);
  return {
    entries,
    tags: indexTags(entries, declarationsOf(library).filter(isFromWorkspace)),
  };
};

/** The declared tags — the categories — in tree order. */
export const categoriesOf = (library: Library): Tag[] => library.tags.filter((tag) => tag.declared);

export const findTag = (library: Library, key: string | undefined): Tag | undefined =>
  key === undefined ? undefined : library.tags.find((tag) => tag.key === key);

/**
 * Where a page is filed: for each of its tags, the deepest declared one at or above it — and of
 * those, only the most specific, so a page in `repositories/gitlab` is not also listed under
 * `repositories`. Empty for a page in no category: "Unsorted".
 */
export const placementOf = (entry: Entry, library: Library): string[] => {
  const declared = new Set(categoriesOf(library).map((tag) => tag.key));
  const found = new Set<string>();
  for (const tag of entry.tags) {
    const deepest = expandTag(tag)
      .reverse()
      .find((candidate) => declared.has(candidate));
    if (deepest) found.add(deepest);
  }
  return [...found].filter(
    (key) => ![...found].some((other) => other !== key && isUnder(other, key)),
  );
};

/** The entries tagged with `key` or anything under it. */
export const entriesTagged = (library: Library, key: string): Entry[] =>
  library.entries.filter((entry) => entry.tags.some((tag) => isUnder(tag, key)));

/* Edits — always to the user's list; the workspace one is never written by bmi. */

/**
 * The user's list with `page` added, or — when it is already there — its fields updated in place.
 * `replace` swaps the whole record instead, which is how a field is cleared.
 */
export const withBookmark = (
  list: BookmarkList,
  page: Bookmark,
  { replace = false }: { replace?: boolean } = {},
): BookmarkList => {
  const key = urlKey(page.url);
  const at = list.bookmarks.findIndex((existing) => urlKey(existing.url) === key);
  if (at < 0) return { ...list, bookmarks: [...list.bookmarks, page] };
  return {
    ...list,
    bookmarks: list.bookmarks.map((existing, index) =>
      index === at ? (replace ? page : { ...existing, ...page }) : existing,
    ),
  };
};

/** The user's list without `url`. */
export const withoutBookmark = (list: BookmarkList, url: string): BookmarkList => {
  const key = urlKey(url);
  return { ...list, bookmarks: list.bookmarks.filter((page) => urlKey(page.url) !== key) };
};

/** The user's own record of `url`, if they wrote one down. */
export const findBookmark = (list: BookmarkList, url: string): Bookmark | undefined => {
  const key = urlKey(url);
  return list.bookmarks.find((page) => urlKey(page.url) === key);
};

/** Whether the user's list has `url` — what decides if it can be removed. */
export const hasBookmark = (list: BookmarkList, url: string): boolean =>
  findBookmark(list, url) !== undefined;

/** Declare a tag — make it a category — or update its description and order. */
export const withTag = (list: BookmarkList, rawKey: string, meta: TagMeta = {}): BookmarkList => {
  const key = normalizeTag(rawKey);
  if (!key) return list;
  return { ...list, tags: { ...list.tags, [key]: { ...list.tags[key], ...meta } } };
};

/**
 * Take the user's declaration of `key` away, and the tag off the user's own pages. The pages stay:
 * a page in no other category goes to "Unsorted", it is not deleted.
 */
export const withoutTag = (list: BookmarkList, key: string): BookmarkList => {
  const { [key]: _gone, ...tags } = list.tags;
  return {
    tags,
    bookmarks: list.bookmarks.map((page) => {
      if (!page.tags?.includes(key)) return page;
      const { tags: pageTags = [], ...rest } = page;
      const left = pageTags.filter((tag) => tag !== key);
      return left.length ? { ...rest, tags: left } : rest;
    }),
  };
};

export default mergeLists;
