import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { findIdeBinary, getIde, IDES } from '../../core/ides';

/** The dashboard's tabs, in order — also what `lastTab` may hold. */
export const TAB_IDS = ['agents', 'mcp', 'skills', 'ide'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** How the IDE tab draws logos — `g` steps through them, `auto` first. */
export const LOGO_MODES = ['auto', 'kitty', 'braille', 'ascii'] as const;
export type LogoMode = (typeof LOGO_MODES)[number];

export interface RepoSettings {
  ide?: string;
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
      const ide = (value as RepoSettings | null)?.ide;
      if (typeof ide === 'string' && getIde(ide)) out.repos[root] = { ide };
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
 * The IDE a repository is on: its own choice, else the last one picked
 * anywhere, else the first installed, else the first known.
 */
export const resolveIdeId = (settings: AgentiSettings, root: string): string => {
  const own = settings.repos[root]?.ide;
  if (own && getIde(own)) return own;
  if (settings.defaultIde && getIde(settings.defaultIde)) return settings.defaultIde;
  return (IDES.find((ide) => findIdeBinary(ide)) ?? IDES[0])?.id ?? '';
};

/** Whether this repository has made a choice yet, as opposed to inheriting one. */
export const hasOwnIde = (settings: AgentiSettings, root: string): boolean =>
  Boolean(settings.repos[root]?.ide);

export const withRepoIde = (
  settings: AgentiSettings,
  root: string,
  ide: string,
): AgentiSettings => ({
  ...settings,
  defaultIde: ide,
  repos: { ...settings.repos, [root]: { ...settings.repos[root], ide } },
});

export default settingsStore;
