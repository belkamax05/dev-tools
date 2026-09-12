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

export default configHome;
