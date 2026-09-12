import { join } from 'node:path';

import { appConfigDir } from '../configHome';

export interface ConfigStoreOptions<T extends object> {
  /** Names the directory under the platform's config home. */
  appName: string;
  /** What a first run, an unreadable file, or a missing key gets. */
  defaults: T;
  /** File inside the app's config directory. */
  fileName?: string;
  /**
   * Turn whatever was parsed into a valid `T`.
   *
   * Defaults to taking each key of `defaults` when the stored value has the same
   * `typeof`, which covers the flags and strings a settings screen writes. Pass
   * your own when a value needs validating against something — an id that must
   * name a theme this build actually has, a number with a range.
   */
  coerce?: (raw: Record<string, unknown>, defaults: T) => T;
}

export interface ConfigStore<T extends object> {
  /**
   * The file itself. Worth showing in a settings screen, so it is never a mystery.
   *
   * Resolved on every read rather than once at import. `XDG_CONFIG_HOME` is an
   * environment variable, and a host is entitled to set it after this module has
   * loaded — which every test that redirects the config into a temp directory
   * does. A path captured at import would point at the real home for the rest of
   * the process, and the test would write to the user's actual config.
   */
  readonly path: string;
  readonly directory: string;
  defaults: T;
  load: () => Promise<T>;
  save: (config: T) => Promise<void>;
}

/**
 * Coerce each key by the shape of its default.
 *
 * A hand-edited config is the normal case for a file like this, so a key that is
 * missing, misspelled or the wrong type has to leave the app running on its
 * default rather than putting `undefined` into a boolean.
 */
const coerceByType = <T extends object>(raw: Record<string, unknown>, defaults: T): T => {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = raw[key as string];
    if (value !== undefined && typeof value === typeof defaults[key]) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
};

/**
 * A JSON settings file an app owns, read and written whole.
 *
 * Neither call throws. A missing file is the first run and a corrupt one is not
 * worth refusing to start over — either way the defaults are a working app, and
 * the next save rewrites the file properly. `save` is the one that can fail, and
 * the caller is expected to apply a setting *before* persisting it, so a config
 * directory that cannot be written costs you persistence and not the setting.
 */
export const createConfigStore = <T extends object>({
  appName,
  defaults,
  fileName = 'config.json',
  coerce = coerceByType,
}: ConfigStoreOptions<T>): ConfigStore<T> => {
  const directory = () => appConfigDir(appName);
  const path = () => join(directory(), fileName);

  return {
    get path() {
      return path();
    },
    get directory() {
      return directory();
    },
    defaults,

    async load() {
      try {
        const parsed: unknown = JSON.parse(await Bun.file(path()).text());
        if (typeof parsed !== 'object' || parsed === null) return { ...defaults };
        return coerce(parsed as Record<string, unknown>, defaults);
      } catch {
        return { ...defaults };
      }
    },

    async save(config: T) {
      //? Trailing newline and two-space indent because this file is meant to be
      //? opened and edited by hand as readily as by a settings screen.
      await Bun.write(path(), `${JSON.stringify(config, null, 2)}\n`);
    },
  };
};

export default createConfigStore;
