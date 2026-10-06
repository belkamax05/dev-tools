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
export const TAB_IDS = ['bookmarks', 'tags', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/**
 * How the Bookmarks tab draws its pages, in the order `g` steps through them: rows, cards with a
 * preview image, and tiles — a favicon and a title, several to a card's width.
 */
export const BOOKMARK_LAYOUTS = ['list', 'grid', 'tiles'] as const;
export type BookmarkLayout = (typeof BOOKMARK_LAYOUTS)[number];

/**
 * What favicons and previews can be drawn with, as the Settings picker offers them: `auto` is the
 * best this terminal supports, the rest are terminal-canvas techniques by id.
 */
export const GRAPHICS_CHOICES = ['auto', 'kitty', 'sixel', 'iterm2', 'halfblock'] as const;
export type GraphicsChoice = (typeof GRAPHICS_CHOICES)[number];

/** `~/.config/bmi/config.json`: the theme, and the user's own bookmarks in the workspace list's shape. */
export interface BmiConfig extends BookmarkList {
  theme: string;
  /** Fetch a page's preview and favicon when the cursor lands on it. Off: only on `f` / `bmi fetch`. */
  autoPreview: boolean;
  bookmarkLayout: BookmarkLayout;
  /** Off: grid cards drop their preview image, keeping the favicon, title and URL. */
  showThumbnails: boolean;
  /** How images are drawn; `auto` for the best the terminal supports. */
  graphics: GraphicsChoice;
  /** Off: only the workspace list is shown — the user's own pages are kept, just hidden. */
  showUserBookmarks: boolean;
}

/** Where a project keeps its list, in the order they are tried: the first one present is the only one read. */
export const WORKSPACE_FILES = ['bookmarks.config.json', 'config/bookmarks.config.json'] as const;

/**
 * The project bmi was opened for: `$BMI_WORKSPACE_ROOT` — what a launcher that knows its project
 * root (a project CLI's `bookmarks` command) sets — or else the directory bmi was started in.
 */
export const workspaceRoot = (env: Record<string, string | undefined> = process.env): string =>
  resolve(env.BMI_WORKSPACE_ROOT || process.cwd());

/**
 * The project's list: `$BMI_WORKSPACE_FILE` when set, else the first of `WORKSPACE_FILES` under the
 * workspace root that exists. When none does, the place one would go (`config/…`), so Settings
 * can still offer to create it.
 */
export const workspaceListPath = async (
  env: Record<string, string | undefined> = process.env,
): Promise<string> => {
  if (env.BMI_WORKSPACE_FILE) return resolve(env.BMI_WORKSPACE_FILE);
  const root = workspaceRoot(env);
  const candidates = WORKSPACE_FILES.map((file) => resolve(root, file));
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return candidates[candidates.length - 1] as string;
};

export const configStore = createConfigStore<BmiConfig>({
  appName: 'bmi',
  defaults: {
    theme: 'classic',
    autoPreview: true,
    bookmarkLayout: 'list',
    showThumbnails: true,
    graphics: 'auto',
    showUserBookmarks: true,
    ...emptyList(),
  },
  coerce: (raw, defaults) => ({
    theme: typeof raw.theme === 'string' ? raw.theme : defaults.theme,
    autoPreview: typeof raw.autoPreview === 'boolean' ? raw.autoPreview : defaults.autoPreview,
    bookmarkLayout: BOOKMARK_LAYOUTS.includes(raw.bookmarkLayout as BookmarkLayout)
      ? (raw.bookmarkLayout as BookmarkLayout)
      : defaults.bookmarkLayout,
    showThumbnails:
      typeof raw.showThumbnails === 'boolean' ? raw.showThumbnails : defaults.showThumbnails,
    graphics: GRAPHICS_CHOICES.includes(raw.graphics as GraphicsChoice)
      ? (raw.graphics as GraphicsChoice)
      : defaults.graphics,
    showUserBookmarks:
      typeof raw.showUserBookmarks === 'boolean'
        ? raw.showUserBookmarks
        : defaults.showUserBookmarks,
    ...coerceList(raw),
  }),
});

export interface WorkspaceListResult {
  list: BookmarkList;
  path: string;
  /** Whether the project has a list at all — without one bmi shows only the user's. */
  exists: boolean;
  /** Why the file could not be read — reported, never thrown. A missing file is no error. */
  error?: string;
}

/** The project's list. Read-only: bmi never writes it, edits always land in the user's config. */
export const loadWorkspaceList = async (path?: string): Promise<WorkspaceListResult> => {
  const at = path ?? (await workspaceListPath());
  const file = Bun.file(at);
  if (!(await file.exists())) return { list: emptyList(), path: at, exists: false };
  try {
    return { list: coerceList(await file.json()), path: at, exists: true };
  } catch (error) {
    return { list: emptyList(), path: at, exists: true, error: (error as Error).message };
  }
};

/** The project's list under the user's: on anything both describe, the user's words win. */
export const buildLibrary = (workspaceList: BookmarkList, user: BookmarkList): Library =>
  mergeLists([
    { source: 'workspace', list: workspaceList },
    { source: 'user', list: user },
  ]);

/** The technique id the setting asks terminal-canvas for — none for `auto`. */
export const preferredTechniqueOf = (config: Pick<BmiConfig, 'graphics'>) =>
  config.graphics === 'auto' ? undefined : config.graphics;

/** Just the bookmark part of the config — what the editing helpers take and give back. */
export const userList = (config: BmiConfig): BookmarkList => ({
  tags: config.tags,
  bookmarks: config.bookmarks,
});
