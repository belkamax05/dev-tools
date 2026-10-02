import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stampPath } from '../../config/settings';
import { formatDotenv } from '../envFile';
import type { Resolution } from '../resolve';

/**
 * What envi exported into a hooked shell, and what each name held before: `{ KEY: previous }`,
 * `null` for a name that was not set. The hook reads it back on the next run to undo exactly its
 * own changes — so leaving a project takes its variables away again, and a value the shell had
 * before envi comes back — the way direnv's `DIRENV_DIFF` does.
 */
export const APPLIED_VAR = 'ENVI_APPLIED';
/** The stamp file's content when the shell last ran the hook — see `stampPath`. */
export const STAMP_VAR = 'ENVI_STAMP';

const OWN_VARS = [APPLIED_VAR, STAMP_VAR];

export type Applied = Record<string, string | null>;

export const readApplied = (env: Record<string, string | undefined>): Applied => {
  const raw = env[APPLIED_VAR];
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Applied = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' || value === null) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

/**
 * The shell's environment as it would be without envi: what the hook applied is put back to
 * what it was, and envi's own bookkeeping is dropped. Resolving against this rather than the raw
 * environment is what keeps `override: false` from treating envi's *own* earlier export as
 * something the user set by hand.
 */
export const shellBase = (env: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  for (const [key, previous] of Object.entries(readApplied(env))) {
    if (previous === null) delete out[key];
    else out[key] = previous;
  }
  for (const key of OWN_VARS) delete out[key];
  return out;
};

/**
 * The environment this process was *started* with — the shell's, exactly.
 *
 * Not `process.env`: Bun loads `.env`, `.env.local` and friends from the working directory into
 * it before any code runs, so in a project folder it already holds the very values envi is
 * meant to layer, and envi would report them as exported by the shell ("same", "shell wins").
 * `bin/envi` turns that off with `--no-env-file`, but envi also runs inside devi's process and
 * as a library. On Linux `/proc/self/environ` is the exec-time environment, untouched by
 * anything the process did since; elsewhere `process.env` is the best there is.
 */
export const launchEnv = (): Record<string, string> => {
  try {
    const out: Record<string, string> = {};
    for (const pair of readFileSync('/proc/self/environ', 'utf8').split('\0')) {
      const at = pair.indexOf('=');
      if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
    }
    if (Object.keys(out).length) return out;
  } catch {}
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
};

export const SHELLS = ['zsh', 'bash', 'sh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

export const EXPORT_FORMATS = [...SHELLS, 'dotenv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const fishQuote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const setLine = (shell: Shell, key: string, value: string) =>
  shell === 'fish' ? `set -gx ${key} ${fishQuote(value)};` : `export ${key}=${shQuote(value)};`;
const unsetLine = (shell: Shell, key: string) =>
  shell === 'fish' ? `set -e ${key};` : `unset ${key};`;

/** What envi changes relative to the shell: the `new` and `changed` variables. */
export const changes = (resolution: Resolution): Record<string, string> =>
  Object.fromEntries(
    resolution.vars
      .filter((entry) => entry.status === 'new' || entry.status === 'changed')
      .map((entry) => [entry.key, entry.value]),
  );

/** envi's changes as shell code, a dotenv file or JSON — for `eval "$(envi export)"` and pipes. */
export const formatExport = (resolution: Resolution, format: ExportFormat): string => {
  const vars = changes(resolution);
  if (format === 'json') return `${JSON.stringify(vars, null, 2)}\n`;
  if (format === 'dotenv') return formatDotenv(vars);
  return Object.entries(vars)
    .map(([key, value]) => `${setLine(format, key, value)}\n`)
    .join('');
};

/**
 * The shell code the hook evaluates: undo what envi applied last time where it no longer applies,
 * set what it applies now, and record both for next time.
 *
 * `current` is the raw environment — with envi's earlier exports in it — because only names whose
 * value actually has to change are written, keeping the `eval` short on every `cd`.
 */
export const formatHookExport = (
  resolution: Resolution,
  shell: Shell,
  current: Record<string, string | undefined>,
  stamp: string,
): string => {
  const previous = readApplied(current);
  const next = changes(resolution);
  const lines: string[] = [];

  for (const [key, before] of Object.entries(previous)) {
    if (key in next) continue;
    if (before === null) {
      if (current[key] !== undefined) lines.push(unsetLine(shell, key));
    } else if (current[key] !== before) lines.push(setLine(shell, key, before));
  }

  const applied: Applied = {};
  for (const [key, value] of Object.entries(next)) {
    applied[key] = resolution.base[key] ?? null;
    if (current[key] !== value) lines.push(setLine(shell, key, value));
  }

  if (Object.keys(applied).length) lines.push(setLine(shell, APPLIED_VAR, JSON.stringify(applied)));
  else if (current[APPLIED_VAR] !== undefined) lines.push(unsetLine(shell, APPLIED_VAR));
  lines.push(setLine(shell, STAMP_VAR, stamp));
  return `${lines.join('\n')}\n`;
};

/** This checkout's `bin/envi`, so the hook works even before `bin/` is on `PATH`. */
export const ENVI_BIN = resolve(import.meta.dir, '..', '..', '..', '..', '..', 'bin', 'envi');

/**
 * The code a shell rc evaluates — `eval "$(envi hook zsh)"` — to keep envi's variables applied.
 *
 * Runs envi before a prompt only when the folder changed or the stamp file did (envi touches it
 * whenever it changes the config or an env file); reading the stamp is a builtin, so an idle
 * prompt starts no process. An env file edited in another editor is picked up on `envi reload`
 * (a function the hook defines) or the next `cd`.
 */
export const hookScript = (shell: Shell): string => {
  const bin = shQuote(ENVI_BIN);
  const stamp = shQuote(stampPath());

  if (shell === 'fish') {
    return `function __envi_apply
  ${fishQuote(ENVI_BIN)} export --hook --shell fish 2>/dev/null | source
  set -g __envi_pwd $PWD
end
function __envi_prompt --on-event fish_prompt
  set -l stamp ""
  test -r ${fishQuote(stampPath())}; and read stamp < ${fishQuote(stampPath())}
  if test "$PWD" != "$__envi_pwd"; or test "$stamp" != "$ENVI_STAMP"
    __envi_apply
  end
end
function envi
  if test "$argv[1]" = reload
    __envi_apply
  else
    ${fishQuote(ENVI_BIN)} $argv
    set -l envi_status $status
    __envi_prompt
    return $envi_status
  end
end
__envi_apply
`;
  }

  const read =
    shell === 'zsh'
      ? `[[ -r ${stamp} ]] && _envi_stamp=$(<${stamp})`
      : `[ -r ${stamp} ] && IFS= read -r _envi_stamp < ${stamp}`;
  const register =
    shell === 'zsh'
      ? `typeset -ag precmd_functions
if (( ! \${precmd_functions[(I)_envi_prompt]} )); then precmd_functions=(_envi_prompt $precmd_functions); fi`
      : shell === 'bash'
        ? `case ";\${PROMPT_COMMAND:-};" in *";_envi_prompt;"*) ;; *) PROMPT_COMMAND="_envi_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac`
        : '';
  const exportShell = shell === 'sh' ? 'sh' : shell;

  return `_envi_apply() {
  eval "$(${bin} export --hook --shell ${exportShell} 2>/dev/null)"
  _envi_pwd=$PWD
}
_envi_prompt() {
  _envi_stamp=""
  ${read}
  if [ "$PWD" != "\${_envi_pwd-}" ] || [ "$_envi_stamp" != "\${ENVI_STAMP-}" ]; then _envi_apply; fi
}
envi() {
  if [ "\${1-}" = reload ]; then _envi_apply; return; fi
  ${bin} "$@"
  set -- "$?"
  _envi_prompt
  return "$1"
}
${register}
_envi_apply
`;
};
