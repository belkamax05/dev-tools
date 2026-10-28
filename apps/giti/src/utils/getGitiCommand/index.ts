/**
 * How the user reaches giti, for hints that tell them what to type next.
 *
 * `giti` unless a wrapping CLI says otherwise through `GITI_COMMAND` — `dfs git` runs giti as its
 * own process and sets it, so a hint printed there reads `dfs git pages url`, not a `giti` the
 * user may not have on PATH.
 */
const getGitiCommand = (env: Record<string, string | undefined> = process.env): string =>
  env.GITI_COMMAND?.trim() || 'giti';

export default getGitiCommand;
