import type { Env } from '../../core/plugin';
import { type JenkinsOptions, jenkinsLog, jobPath } from './api';

/**
 * The first match of `pattern` in `text`: its first capture group, else the whole match.
 * Lines like `eu.gcr.io/…/fe-nginx:1.0.ma26.12.1021` with /fe-nginx:(\S+)/ → `1.0.ma26.12.1021`.
 */
export const extractVersion = (text: string, pattern: RegExp): string | undefined => {
  //? A fresh, non-global copy: a /g pattern from config would carry lastIndex between calls
  const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(text);
  return match ? (match[1] ?? match[0]) : undefined;
};

/** Longest stretch kept from the previous chunk, so a match split across two reads is found. */
const OVERLAP = 512;

const cache = new Map<string, Promise<string | undefined>>();

/**
 * What a finished build says it produced, read from its console: the log is read in chunks
 * through Jenkins' progressive text and stops at the first match. A finished build's log never
 * changes, so the answer (a match or none) is kept per build for the whole process.
 */
export const logVersion = (
  options: JenkinsOptions,
  env: Env,
  job: string,
  buildNumber: number,
  pattern: RegExp,
): Promise<string | undefined> => {
  const key = `${options.url}|${job}|${buildNumber}|${pattern}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      let start = 0;
      let carry = '';
      for (;;) {
        const chunk = await jenkinsLog(options, env, `${jobPath(job)}/${buildNumber}`, start);
        const found = extractVersion(`${carry}${chunk.text}`, pattern);
        if (found) return found;
        //? Nothing new to read: a finished log is done; a running one would be asked again later
        if (!chunk.more || chunk.next <= start) return undefined;
        carry = chunk.text.slice(-OVERLAP);
        start = chunk.next;
      }
    })();
    //? A failed read is not an answer — let the next evaluation try again
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
};
