import { spawn } from 'node:child_process';

/**
 * A git remote's address as a web page: `git@host:owner/repo.git` and
 * `ssh://git@host/owner/repo.git` become `https://host/owner/repo`; an
 * http(s) one loses its `.git`. Undefined for anything else (a path, a
 * `file://` remote) — there is no page to open.
 */
export const remoteWebUrl = (remote: string): string | undefined => {
  const trimmed = remote.trim().replace(/\.git$/, '');
  const scp = trimmed.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = trimmed.match(/^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return /^https?:\/\//.test(trimmed) ? trimmed.replace(/^(https?:\/\/)[^@/]+@/, '$1') : undefined;
};

/** Open a URL in the desktop's browser, detached — the caller never waits on it. */
export const openUrl = (url: string): void => {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  const [bin = '', ...args] = command;
  spawn(bin, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
};

export default openUrl;
