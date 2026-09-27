import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where this platform keeps per-user config.
 *
 * `XDG_CONFIG_HOME` first on Linux because a user who has set it means it. The
 * macOS and Windows branches follow each platform's own convention rather than
 * putting a dotfile in the home directory on all three.
 */
export const configHome = (): string => {
  const home = homedir();

  if (process.platform === 'win32') return process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(home, 'Library', 'Preferences');
  return process.env.XDG_CONFIG_HOME || join(home, '.config');
};

/** The directory an app owns under it. */
export const appConfigDir = (appName: string): string => join(configHome(), appName);

/**
 * Where this platform keeps per-user *state*: what an app remembers between runs on its own
 * (the last tab, window sizes, history), as opposed to settings a person chose.
 *
 * Kept apart from `configHome` on purpose. Config is often a tracked dotfile — stow-linked, as
 * giti's is — and state that rewrites itself on every run would churn that file in git. On Linux
 * this is `XDG_STATE_HOME`, the XDG base directory made for exactly this; macOS and Windows have
 * no separate state location, so it lands in each platform's per-user app-data directory, which
 * nobody version-controls either.
 */
export const stateHome = (): string => {
  const home = homedir();

  if (process.platform === 'win32')
    return process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support');
  return process.env.XDG_STATE_HOME || join(home, '.local', 'state');
};

/** The state directory an app owns. */
export const appStateDir = (appName: string): string => join(stateHome(), appName);

export default configHome;
