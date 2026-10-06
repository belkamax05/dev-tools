import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['watched', 'listening', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Seconds between re-reads of the socket table; 0 switches them off. */
export const REFRESH_CHOICES = [0, 1, 2, 5, 10] as const;
export const DEFAULT_REFRESH_SECONDS = 2;

export interface WatchedPort {
  port: number;
  /** What usually runs there — shown next to the number, never required. */
  name?: string;
  /** A longer note on what it is for — shown by `porti status`, never required. */
  description?: string;
}

/** What a first run watches: the three ports local dev servers fight over most. */
export const DEFAULT_PORTS: WatchedPort[] = [
  { port: 3000, name: 'dev server (Next, Vite preview, Express, Rails)' },
  { port: 4200, name: 'Angular / Nx' },
  { port: 8080, name: 'HTTP alternate / proxies' },
];

export interface PortiConfig {
  theme: string;
  refreshSeconds: number;
  ports: WatchedPort[];
}

export interface PortiState {
  tab: TabId;
}

export const isPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;

/** `"3000"` → 3000; anything that is not a whole number in 1-65535 → undefined. */
export const parsePort = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const port = Number(value.trim());
  return isPort(port) ? port : undefined;
};

/**
 * Keep the well-formed entries of a hand-edited `ports` list, first mention winning.
 *
 * An empty list is honoured: someone who removed every default meant it, and putting them back on
 * the next run would make the list impossible to empty. Only a missing (or non-array) key means
 * "never configured" and gets the defaults.
 */
export const coercePorts = (raw: unknown): WatchedPort[] => {
  if (!Array.isArray(raw)) return DEFAULT_PORTS.map((entry) => ({ ...entry }));
  const seen = new Set<number>();
  const out: WatchedPort[] = [];
  for (const entry of raw) {
    //? A bare number is accepted too — the shortest way to write the file by hand
    const port = typeof entry === 'number' ? entry : (entry as WatchedPort | null)?.port;
    if (!isPort(port) || seen.has(port)) continue;
    seen.add(port);
    const { name, description } = (entry ?? {}) as Partial<WatchedPort>;
    out.push({
      port,
      ...(typeof name === 'string' && name.trim() && { name: name.trim() }),
      ...(typeof description === 'string' &&
        description.trim() && { description: description.trim() }),
    });
  }
  return out;
};

/**
 * `~/.config/porti/config.json`: what a person chose — the theme, the refresh rate and the ports
 * they watch. Kept apart from the state file for the reason giti's is: the config is the kind of
 * file that ends up stow-linked into dotfiles, and the last tab changes on every run.
 */
export const configStore = createConfigStore<PortiConfig>({
  appName: 'porti',
  defaults: { theme: 'classic', refreshSeconds: DEFAULT_REFRESH_SECONDS, ports: DEFAULT_PORTS },
  coerce: (raw, defaults) => ({
    theme: typeof raw.theme === 'string' ? raw.theme : defaults.theme,
    refreshSeconds:
      typeof raw.refreshSeconds === 'number' && raw.refreshSeconds >= 0
        ? raw.refreshSeconds
        : defaults.refreshSeconds,
    ports: coercePorts(raw.ports),
  }),
});

/** `~/.local/state/porti/state.json`: what porti remembers by itself — the tab it was left on. */
export const stateStore = createConfigStore<PortiState>({
  appName: 'porti',
  kind: 'state',
  defaults: { tab: 'watched' },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
  }),
});

/** Add a port, or rename it when it is already watched. Kept in ascending order. */
export const withPort = (ports: WatchedPort[], entry: WatchedPort): WatchedPort[] =>
  [...ports.filter((existing) => existing.port !== entry.port), entry].sort(
    (a, b) => a.port - b.port,
  );

export const withoutPort = (ports: WatchedPort[], port: number): WatchedPort[] =>
  ports.filter((entry) => entry.port !== port);
