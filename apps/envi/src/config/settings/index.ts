import { join } from 'node:path';
import { appStateDir } from '@/dev-tools/utils/config/configHome';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { isValidKey } from '../../core/parse';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['shell', 'resolved', 'files', 'vars', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** The env files read from the current folder when nothing says otherwise, in order. */
export const DEFAULT_FILES = ['.env', '.env.user'] as const;

/**
 * Name fragments that mark a variable as a secret — its value is masked until revealed.
 * Matched case-insensitively anywhere in the key.
 */
export const DEFAULT_MASK_PATTERNS = [
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'PRIVATE',
  'CREDENTIAL',
  'API_KEY',
  'ACCESS_KEY',
  'AUTH',
  'COOKIE',
  'SESSION',
] as const;

/**
 * Where `envi set` / `envi unset` write when no flag says otherwise:
 * - `.env.user` / `.env`: that file in the folder envi runs in (`.env.user` is the default — it is
 *   the one meant to stay out of git);
 * - `config`: your vars in `~/.config/envi/config.json` — every folder, and the file dotfiles keep;
 * - `state`: machine vars in `~/.local/state/envi/state.json` — every folder, this machine only.
 */
export const SET_TARGETS = ['.env.user', '.env', 'config', 'state'] as const;
export type SetTarget = (typeof SET_TARGETS)[number];

/** How a target reads in the UI and in what `set` prints. */
export const SET_TARGET_LABELS: Record<SetTarget, string> = {
  '.env.user': '.env.user here',
  '.env': '.env here',
  config: 'your vars (config)',
  state: 'machine vars (state)',
};

export interface EnviConfig {
  theme: string;
  /** Where `envi set` writes by default — see `SET_TARGETS`. */
  setTarget: SetTarget;
  /**
   * The env files read from the folder envi runs in, in order — a later file wins. Relative
   * paths are taken from that folder; absolute and `~/` ones are used as they are.
   */
  files: string[];
  /**
   * Files not to read: a name as written in some list (`.env.user`), a bare file name (matches
   * it in any folder) or an absolute path (that one file only).
   */
  disabled: string[];
  /** Your own variables: under every folder's files, set in every shell envi is hooked into. */
  vars: Record<string, string>;
  /**
   * Whether envi's layers replace a value the shell already exports. Off, as in dotenv: a
   * variable you set by hand for one command (`FOO=1 envi run …`) is not silently undone.
   */
  override: boolean;
  /** `$VAR` / `${VAR:-x}` expansion in values. */
  expand: boolean;
  maskPatterns: string[];
}

export interface EnviState {
  tab: TabId;
  /**
   * Machine vars: like your vars (every folder, under the env files) but kept here, so they never
   * travel with dotfiles. Applied after your vars — the machine's own value wins.
   */
  vars: Record<string, string>;
}

const stringList = (raw: unknown, fallback: readonly string[]): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.filter((item): item is string => typeof item === 'string' && !!item.trim()))]
    : [...fallback];

/** Keep the string values of well-named keys; a number or boolean is written as text. */
export const coerceVars = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidKey(key)) continue;
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
};

/**
 * `~/.config/envi/config.json`: the files read, the ones switched off, your own variables and
 * how layers merge. Kept apart from the state file because this is the one that ends up in
 * dotfiles — and since `vars` may hold tokens, keep it out of a public repository.
 */
export const configStore = createConfigStore<EnviConfig>({
  appName: 'envi',
  defaults: {
    theme: 'lagoon',
    setTarget: '.env.user',
    files: [...DEFAULT_FILES],
    disabled: [],
    vars: {},
    override: false,
    expand: true,
    maskPatterns: [...DEFAULT_MASK_PATTERNS],
  },
  coerce: (raw, defaults) => ({
    theme: typeof raw.theme === 'string' ? raw.theme : defaults.theme,
    setTarget: SET_TARGETS.includes(raw.setTarget as SetTarget)
      ? (raw.setTarget as SetTarget)
      : defaults.setTarget,
    //? An emptied list stays empty — someone who removed both defaults meant it
    files: stringList(raw.files, defaults.files),
    disabled: stringList(raw.disabled, []),
    vars: coerceVars(raw.vars),
    override: typeof raw.override === 'boolean' ? raw.override : defaults.override,
    expand: typeof raw.expand === 'boolean' ? raw.expand : defaults.expand,
    maskPatterns: stringList(raw.maskPatterns, defaults.maskPatterns),
  }),
});

/** `~/.local/state/envi/state.json`: the tab envi was left on, and your machine vars. */
export const stateStore = createConfigStore<EnviState>({
  appName: 'envi',
  kind: 'state',
  defaults: { tab: 'resolved', vars: {} },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
    vars: coerceVars(raw.vars),
  }),
});

/** Save the state file and tell hooked shells — machine vars live in it. */
export const saveState = async (state: EnviState) => {
  await stateStore.save(state);
  await touchStamp();
};

/**
 * A file whose content changes whenever envi changes something a hooked shell should pick up —
 * the config, an env file. The shell hook compares it to `$ENVI_STAMP` before each prompt, a
 * read with no process started, and only re-runs envi when it moved.
 */
export const stampPath = () => join(appStateDir('envi'), 'stamp');

export const touchStamp = async () => {
  try {
    await Bun.write(stampPath(), `${Date.now()}\n`);
  } catch {}
};

/** Save the config and tell hooked shells to re-read it. */
export const saveConfig = async (config: EnviConfig) => {
  await configStore.save(config);
  await touchStamp();
};

export const isSecretKey = (key: string, patterns: readonly string[]) => {
  const upper = key.toUpperCase();
  return patterns.some((pattern) => upper.includes(pattern.toUpperCase()));
};

/** `••••••••  (40 chars)` — enough to tell set from empty, nothing to read off a screenshot. */
export const maskValue = (value: string) =>
  value ? `${'•'.repeat(Math.min(8, value.length))}  (${value.length} chars)` : '';

export const withVar = (vars: Record<string, string>, key: string, value: string) => ({
  ...vars,
  [key]: value,
});

export const withoutVar = (vars: Record<string, string>, key: string) => {
  const { [key]: _gone, ...rest } = vars;
  return rest;
};
