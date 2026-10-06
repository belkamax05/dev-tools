import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

export interface DeviConfig {
  /** Your own shortcuts: alias → command line, e.g. `"kp": "porti kill"`. */
  aliases: Record<string, string>;
}

/** Words the launcher answers itself; an alias of the same name could never be reached. */
export const RESERVED = ['help', 'list', 'alias', 'aliases'] as const;

/**
 * `~/.config/devi/config.json` — the aliases you add. A tracked-dotfile kind of file: it only
 * changes when you change it, so it is safe to stow.
 */
export const configStore = createConfigStore<DeviConfig>({
  appName: 'devi',
  defaults: { aliases: {} },
  coerce: (raw) => {
    const aliases: Record<string, string> = {};
    if (raw.aliases && typeof raw.aliases === 'object') {
      for (const [alias, target] of Object.entries(raw.aliases as Record<string, unknown>)) {
        if (typeof target === 'string' && target.trim() && /^[\w.:-]+$/.test(alias)) {
          aliases[alias] = target.trim();
        }
      }
    }
    return { aliases };
  },
});
