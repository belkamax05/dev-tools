import { expect, spyOn, test } from 'bun:test';

import type { StepRun } from '../../core/plugin';
import { checkLog } from './logs';
import { githubPlugin } from '.';

const options = { repo: 'owner/repo', tokenEnv: 'TEST_TOKEN' };
const env = { TEST_TOKEN: 'test' };
const run: StepRun = {
  id: 'check-10',
  label: 'check: Test',
  state: 'success',
  url: 'https://github.com/owner/repo/actions/runs/20/job/30',
};

test('a skipped Actions job explains why it has no log', async () => {
  expect((await checkLog(options, env, { ...run, detail: 'skipped' })).unavailable).toContain(
    'was skipped',
  );
});
test('a running job keeps polling until its log can be downloaded', async () => {
  expect((await checkLog(options, env, { ...run, state: 'running' })).more).toBe(true);
});
test('uses the Actions job ID from the URL, even when the check ID differs', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('job output'));
  try {
    expect((await checkLog(options, env, run)).text).toBe('job output');
    expect(String(fetch.mock.calls[0]?.[0])).toEndWith('/actions/jobs/30/logs');
  } finally {
    fetch.mockRestore();
  }
});
test('an unavailable job log does not claim it was not made by Actions', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
  try {
    const result = await checkLog(options, env, run);
    expect(result.unavailable).toContain('no downloadable log');
    expect(result.unavailable).not.toContain('not made by');
  } finally {
    fetch.mockRestore();
  }
});
test('after a fresh status read, skipped checks do not displace jobs with logs', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (url: Parameters<typeof globalThis.fetch>[0]) => {
        const path = String(url);
        if (path.includes('/branches/'))
          return Response.json({
            commit: {
              sha: 'abc',
              html_url: 'https://github.com/owner/repo/commit/abc',
              commit: { committer: { date: '2026-10-17' }, message: 'Push' },
              author: null,
            },
          });
        if (path.includes('/check-runs'))
          return Response.json({
            check_runs: [
              {
                id: 3,
                name: 'Cancel on failure',
                status: 'completed',
                conclusion: 'skipped',
                html_url: run.url,
              },
              {
                id: 2,
                name: 'Test',
                status: 'completed',
                conclusion: 'success',
                html_url: run.url,
              },
            ],
          });
        if (path.includes('/actions/runs')) return Response.json({ workflow_runs: [] });
        return Response.json([]);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const result = await githubPlugin.steps.branch!.status(
      {
        cwd: '.',
        options,
        env,
        connection: { transport: 'api', capabilities: [], probes: [], checkedAt: 0 },
      },
      {
        step: { id: 'push', label: 'Push', provider: 'github', kind: 'branch' },
        branch: 'feature/test',
        env: 'ci',
        upstream: {},
      },
    );
    expect(result.runs?.map((item) => item.id)).toEqual(['check-2', 'check-3']);
  } finally {
    fetch.mockRestore();
  }
});
