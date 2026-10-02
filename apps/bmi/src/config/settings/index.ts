import { resolve } from 'node:path';

import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import {
  type BookmarkList,
  coerceList,
  emptyList,
  type Library,
  mergeLists,
} from '../../core/bookmarks';

/**
 * The dashboard's tabs, in order. bmi always opens on the first, search focused, the way a
 * launcher does — so unlike the other apps it does not remember the last tab.
 */
export const TAB_IDS = ['bookmarks', 'groups', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** `~/.config/bmi/config.json`: the theme, and the user's own bookmarks in the static list's shape. */
export interface BmiConfig extends BookmarkList {
  theme: string;
  /** Fetch a page's preview and favicon when the cursor lands on it. Off: only on `f` / `bmi fetch`. */
  autoPreview: boolean;
  bookmarkLayout: 'list' | 'grid';
}

/**
 * The list shipped with bmi, beside its `package.json` — the team's shared links, kept in git.
 * `BMI_STATIC_FILE` points at another one, for a list that lives in some other repository.
 */
export const staticListPath = (env: Record<string, string | undefined> = process.env): string =>
  env.BMI_STATIC_FILE
    ? resolve(env.BMI_STATIC_FILE)
    : resolve(import.meta.dir, '..', '..', '..', 'bookmarks.json');

export const configStore = createConfigStore<BmiConfig>({
  appName: 'bmi',
  defaults: { theme: 'classic', autoPreview: true, bookmarkLayout: 'list', ...emptyList() },
  coerce: (raw, defaults) => ({
    theme: typeof raw.theme === 'string' ? raw.theme : defaults.theme,
    autoPreview: typeof raw.autoPreview === 'boolean' ? raw.autoPreview : defaults.autoPreview,
    bookmarkLayout: raw.bookmarkLayout === 'grid' ? 'grid' : 'list',
    ...coerceList(raw),
  }),
});

export interface StaticListResult {
  list: BookmarkList;
  path: string;
  /** Why the file could not be read — reported, never thrown. A missing file is no error. */
  error?: string;
}

/** The static list. Read-only: bmi never writes it, edits always land in the user's config. */
export const loadStaticList = async (path = staticListPath()): Promise<StaticListResult> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return { list: emptyList(), path };
  try {
    return { list: coerceList(await file.json()), path };
  } catch (error) {
    return { list: emptyList(), path, error: (error as Error).message };
  }
};

/** The static list under the user's: on anything both describe, the user's words win. */
export const buildLibrary = (staticList: BookmarkList, user: BookmarkList): Library =>
  mergeLists([
    { source: 'static', list: staticList },
    { source: 'user', list: user },
  ]);

/** Just the bookmark part of the config — what the editing helpers take and give back. */
export const userList = (config: BmiConfig): BookmarkList => ({
  bookmarks: config.bookmarks,
  groups: config.groups,
});
