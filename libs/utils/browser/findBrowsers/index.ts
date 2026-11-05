import { existsSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';

/** A Chromium-family browser that can run headless. */
export interface Browser {
  /** What it was found as: the command name, `$CHROME_PATH`, or the app's name. */
  name: string;
  /** Absolute path of the executable. */
  bin: string;
}

/** Chromium-family commands looked up on PATH, in the order they are preferred. */
export const CHROMIUM_COMMANDS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'brave',
  'brave-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
  'chrome',
];

//? macOS apps are rarely on PATH
const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export interface FindBrowsersDeps {
  which?: (command: string) => string | null;
  exists?: (path: string) => boolean;
  realpath?: (path: string) => string;
  env?: Record<string, string | undefined>;
}

const safeRealpath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * The headless-capable browsers already installed — `$CHROME_PATH` first, then the PATH commands,
 * then the macOS apps. Nothing is ever downloaded. Two names for the same executable
 * (`google-chrome` and `google-chrome-stable`) are listed once, under the first.
 */
export const findBrowsers = ({
  which = Bun.which,
  exists = existsSync,
  realpath = safeRealpath,
  env = process.env,
}: FindBrowsersDeps = {}) => {
  const found: Browser[] = [];
  const seen = new Set<string>();
  const add = (name: string, bin: string | null | undefined) => {
    if (!bin || !exists(bin)) return;
    const real = realpath(bin);
    if (seen.has(real)) return;
    seen.add(real);
    found.push({ name, bin });
  };

  add('$CHROME_PATH', env.CHROME_PATH);
  for (const command of CHROMIUM_COMMANDS) add(command, which(command));
  for (const app of MAC_APPS) add(basename(app), app);
  return found;
};

export default findBrowsers;
