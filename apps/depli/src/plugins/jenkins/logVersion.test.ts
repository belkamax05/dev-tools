import { afterEach, describe, expect, test } from 'bun:test';

import { extractVersion, logVersion } from './logVersion';

const PUSH_LOG = [
  'Started by user mbondarchuk',
  '+ docker build -t eu.gcr.io/dfs-nonprod-wcv9/dfs/fe/master/fe-nginx:1.0.ma26.12.1021 .',
  'The push refers to repository [eu.gcr.io/dfs-nonprod-wcv9/dfs/fe/master/fe-nginx]',
  '1.0.ma26.12.1021: digest: sha256:abc size: 2203',
  'Finished: SUCCESS',
].join('\n');

describe('extractVersion', () => {
  test('the capture group of the first match', () => {
    expect(extractVersion(PUSH_LOG, /\/fe-nginx:(\S+)/)).toBe('1.0.ma26.12.1021');
  });

  test('the whole match when the pattern has no group', () => {
    expect(extractVersion(PUSH_LOG, /1\.0\.[a-z0-9.-]+\.\d+/)).toBe('1.0.ma26.12.1021');
  });

  test('no match is undefined, not a guess', () => {
    expect(extractVersion(PUSH_LOG, /\/fe-nodejs:(\S+)/)).toBeUndefined();
  });

  test('a /g pattern gives the same answer every time', () => {
    const pattern = /\/fe-nginx:(\S+)/g;
    expect(extractVersion(PUSH_LOG, pattern)).toBe('1.0.ma26.12.1021');
    expect(extractVersion(PUSH_LOG, pattern)).toBe('1.0.ma26.12.1021');
  });
});

describe('logVersion', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Jenkins' progressive text, served in fixed-size chunks; records every start asked for. */
  const serve = (log: string, size: number) => {
    const starts: number[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const start = Number(new URL(String(url)).searchParams.get('start'));
      starts.push(start);
      const text = log.slice(start, start + size);
      const next = start + text.length;
      return new Response(text, {
        headers: { 'x-text-size': String(next), 'x-more-data': String(next < log.length) },
      });
    }) as typeof fetch;
    return starts;
  };

  const options = { url: 'https://ci.test', userEnv: 'U', tokenEnv: 'T' };
  const env = { U: 'user', T: 'token' };

  test('reads chunk by chunk and stops at the first match — even one split across chunks', async () => {
    const at = PUSH_LOG.indexOf('fe-nginx:1.0');
    const starts = serve(PUSH_LOG, at + 5);
    expect(await logVersion(options, env, 'build_fe-nginx', 1, /\/fe-nginx:(\S+)/)).toBe(
      '1.0.ma26.12.1021',
    );
    expect(starts).toEqual([0, at + 5]);
  });

  test('is read once per build: the answer is kept', async () => {
    const starts = serve(PUSH_LOG, 10_000);
    await logVersion(options, env, 'build_fe-nginx', 2, /\/fe-nginx:(\S+)/);
    await logVersion(options, env, 'build_fe-nginx', 2, /\/fe-nginx:(\S+)/);
    expect(starts).toEqual([0]);
  });

  test('a log without the line reads to the end and answers undefined', async () => {
    const starts = serve(PUSH_LOG, 40);
    expect(
      await logVersion(options, env, 'build_fe-nodejs', 3, /\/fe-nodejs:(\S+)/),
    ).toBeUndefined();
    expect(starts.length).toBe(Math.ceil(PUSH_LOG.length / 40));
  });
});
