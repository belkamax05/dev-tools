import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { findIdeBinary, getIde, IDES } from '../../core/ides';

/** The dashboard's tabs, in order — also what `lastTab` may hold. */
export const TAB_IDS = ['agents', 'mcp', 'skills', 'health', 'ide'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** How the IDE tab draws logos — `g` steps through them, `auto` first. */
export const LOGO_MODES = ['auto', 'kitty', 'braille', 'ascii'] as const;
export type LogoMode = (typeof LOGO_MODES)[number];

export interface RepoSettings {
  /** The IDEs this repository is kept in step with; the first is the one tabs open on. */
  ides: string[];
}

export interface AgentiSettings {
  theme: string;
  /** The IDE picked most recently anywhere — what a repo with no choice of its own starts on. */
  defaultIde: string;
  /** Keyed by absolute repository root. */
  repos: Record<string, RepoSettings>;
  /** The tab a bare `agenti` opens on — whichever was open last. */
  lastTab: TabId;
  logoMode: LogoMode;
}

const DEFAULTS: AgentiSettings = {
  theme: 'classic',
  defaultIde: '',
  repos: {},
  lastTab: 'agents',
  logoMode: 'auto',
};

/**
 * Keeps what is well-formed and drops the rest.
 *
 * The stock coercion compares `typeof` with the default, which would accept any
 * object as `repos` — including one whose entries name IDEs this build has never
 * heard of. An unknown id is dropped here rather than surfacing later as a
 * selection nothing in the IDE list matches.
 */
const coerce = (raw: Record<string, unknown>): AgentiSettings => {
  const out: AgentiSettings = { ...DEFAULTS, repos: {} };
  if (typeof raw.theme === 'string') out.theme = raw.theme;
  if (TAB_IDS.includes(raw.lastTab as TabId)) out.lastTab = raw.lastTab as TabId;
  if (LOGO_MODES.includes(raw.logoMode as LogoMode)) out.logoMode = raw.logoMode as LogoMode;
  if (typeof raw.defaultIde === 'string' && getIde(raw.defaultIde)) out.defaultIde = raw.defaultIde;
  if (raw.repos && typeof raw.repos === 'object') {
    for (const [root, value] of Object.entries(raw.repos as Record<string, unknown>)) {
      const entry = value as { ide?: unknown; ides?: unknown } | null;
      //? `{ ide }` is the single-IDE shape this file had before; read as a list of one
      const listed = Array.isArray(entry?.ides) ? entry.ides : entry?.ide ? [entry.ide] : [];
      const ides = listed.filter(
        (id): id is string => typeof id === 'string' && Boolean(getIde(id)),
      );
      if (ides.length) out.repos[root] = { ides: [...new Set(ides)] };
    }
  }
  return out;
};

/**
 * `~/.config/agenti/config.json` (the platform's config home — see
 * `configHome`), which holds each repository's IDE and the theme.
 *
 * Per user rather than in the repository: which IDE someone works in is theirs,
 * and a file in the repo would either be committed — imposing it on everyone
 * else — or need ignoring in every repo agenti is ever run in.
 */
export const settingsStore = createConfigStore<AgentiSettings>({
  appName: 'agenti',
  defaults: DEFAULTS,
  coerce,
});

/**
 * The IDEs a repository (or, keyed by the home directory, the user scope) is
 * kept in step with: its own list, else the last one picked anywhere, else the
 * first installed, else the first known. Never empty.
 */
export const ideIdsFor = (settings: AgentiSettings, root: string): string[] => {
  const own = settings.repos[root]?.ides.filter((id) => getIde(id)) ?? [];
  if (own.length) return own;
  if (settings.defaultIde && getIde(settings.defaultIde)) return [settings.defaultIde];
  const fallback = (IDES.find((ide) => findIdeBinary(ide)) ?? IDES[0])?.id;
  return fallback ? [fallback] : [];
};

/** The one the tabs open on — the first of `ideIdsFor`. */
export const resolveIdeId = (settings: AgentiSettings, root: string): string =>
  ideIdsFor(settings, root)[0] ?? '';

/** Whether this repository has made a choice yet, as opposed to inheriting one. */
export const hasOwnIde = (settings: AgentiSettings, root: string): boolean =>
  Boolean(settings.repos[root]?.ides.length);

const withIds = (settings: AgentiSettings, root: string, ides: string[]): AgentiSettings => ({
  ...settings,
  defaultIde: ides[0] ?? settings.defaultIde,
  repos: { ...settings.repos, [root]: { ides } },
});

/** Make `ide` the primary, adding it if it was not in the list. */
export const withRepoIde = (settings: AgentiSettings, root: string, ide: string): AgentiSettings =>
  //? The repository's own list only — a first pick replaces an inherited
  //? default rather than joining it
  withIds(settings, root, [ide, ...(settings.repos[root]?.ides ?? []).filter((id) => id !== ide)]);

/**
 * Add or remove one IDE from the repository's list. The last one cannot be
 * removed — a repository with no IDE has nothing for the other tabs to show.
 */
export const toggleRepoIde = (
  settings: AgentiSettings,
  root: string,
  ide: string,
): AgentiSettings => {
  const current = ideIdsFor(settings, root);
  if (!current.includes(ide)) return withIds(settings, root, [...current, ide]);
  if (current.length === 1) return settings;
  return withIds(
    settings,
    root,
    current.filter((id) => id !== ide),
  );
};

export default settingsStore;
