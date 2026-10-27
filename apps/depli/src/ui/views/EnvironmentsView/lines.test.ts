import { expect, test } from 'bun:test';

import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';
import { history, pipeline, rows } from './fixtures';
import { foldsOf, graphLines, lineText, linksOf, runLine, stepContent, targetOf } from './lines';

test('draws steps as boxes, parallel ones side by side, connectors fanning out and in', () => {
  const lines = graphLines(
    pipeline,
    (entry) => ({ title: entry.id, rows: [[{ text: String(entry.job ?? '-'), url: 'u' }]] }),
    40,
  ).map(lineText);
  expect(lines[0]).toStartWith('╭');
  //? Two builds on one level: two boxes on the same rows
  const both = lines.find((line) => line.includes('build-a'));
  expect(both).toContain('build-b');
  //? The bus from push fans out to both builds, and back in to deploy
  expect(lines.some((line) => line.includes('┌') && line.includes('┐'))).toBe(true);
  expect(lines.some((line) => line.includes('└') && line.includes('┘'))).toBe(true);
  expect(lines.at(-1)).toStartWith('╰');
});

const context = { env: 'ci', branch: 'develop', history, row: rows[0] };

const pagesOf = (lines: ReturnType<typeof graphLines>) =>
  linksOf(lines).flatMap((link) => (link.to ? [targetOf(link.to)] : []));

test("a deploy's box: what it put on the env, by which run, with which builds — nothing else", () => {
  const content = stepContent(pipeline[3] as StepConfig, history.envs[0]?.steps[0], context);
  expect(content.title).toBe('Deploy to ci');
  //? The title opens the step on the env
  expect(targetOf(content.to ?? '{}')).toEqual({ step: 'deploy' });
  const text = content.rows.map(lineText);
  expect(text[0]).toBe('✓ develop');
  expect(text[1]).toStartWith('by #7');
  expect(text[1]).toEndWith('mb');
  expect(text[2]).toBe('with build-a #42');
  //? No job list, tally or other runs — those are the step's page's
  expect(text).toHaveLength(3);
  expect(pagesOf(content.rows)).toEqual([
    { step: 'deploy', job: 'deploy_ci', run: '7' },
    { step: 'build-a', job: 'build_a', run: '42' },
  ]);
});

test("a build's box: the build the env runs, and whether its branch has newer good ones", () => {
  const text = stepContent(pipeline[1] as StepConfig, history.shared[0], context).rows.map(
    lineText,
  );
  expect(text[0]).toBe('#42 ✓ develop');
  expect(text[1]).toContain('mb  1a2b3c4d');
  expect(text[2]).toStartWith('⚠ 1 newer · #45');
  expect(text).toHaveLength(3);
});

test("a build's commit links to the repository; the latest build of its branch says so", () => {
  const commitUrl = (sha: string) => `https://gh/o/app/commit/${sha}`;
  const latest = { ...context, commitUrl, history: { ...history, shared: [
    { ...history.shared[0]!, jobs: [{ ...history.shared[0]!.jobs[0]!, runs: history.shared[0]!.jobs[0]!.runs.slice(2) }] },
  ] } };
  const content = stepContent(pipeline[1] as StepConfig, latest.history.shared[0], latest);
  expect(content.rows.map(lineText)[2]).toBe('✓ latest');
  expect(linksOf(content.rows).map((link) => link.url)).toContain(
    'https://gh/o/app/commit/1a2b3c4d5e',
  );
});

test('a build the env runs that is older than the builds read says so', () => {
  const old = {
    ...rows[0],
    cells: [
      {
        ...rows[0]!.cells[0]!,
        latest: { ...rows[0]!.cells[0]!.latest, versions: { A_VERSION: '1.0.x.7' } },
      },
    ],
  } as EnvRow;
  const text = stepContent(pipeline[1] as StepConfig, history.shared[0], {
    ...context,
    row: old,
  }).rows.map(lineText);
  expect(text[0]).toBe('#7');
  expect(text[1]).toContain('older than the builds read');
});

test('the push box: the branch, its head, the commit deployed and how far behind it is', () => {
  const branchHistory = history.branches.develop?.[0];
  const text = stepContent(pipeline[0] as StepConfig, branchHistory, context).rows.map(lineText);
  expect(text[0]).toBe('develop');
  expect(text[1]).toStartWith('latest  c3c3c3c3  Newest  ');
  expect(text[2]).toBe('on ci   1a2b3c4d  ⚠ 2 commits behind');
  expect(text).toHaveLength(3);
});

test('builds of different commits on the env: one line per build, saying which it is', () => {
  const second = { ...rows[0]!.cells[0]!, step: { ...rows[0]!.cells[0]!.step, versions: { A_VERSION: 'build-a', B_VERSION: 'build-b' } } };
  const row = {
    ...rows[0]!,
    cells: [{ ...second, latest: { ...second.latest, versions: { A_VERSION: '1.0.x.42', B_VERSION: '1.0.x.9' } } }],
  } as EnvRow;
  const withB = {
    ...history,
    shared: [
      ...history.shared,
      {
        step: pipeline[2] as StepConfig,
        jobs: [
          {
            job: 'build_b',
            runs: [{ id: '9', label: '#9', state: 'success' as const, sha: 'c3c3c3c3c3', url: 'https://ci/job/build_b/9/' }],
          },
        ],
      },
    ],
  };
  const content = stepContent(pipeline[0] as StepConfig, history.branches.develop?.[0], {
    ...context,
    history: withB,
    row,
  });
  const text = content.rows.map(lineText);
  expect(text[2]).toBe('on ci   build-a #42  1a2b3c4d  ⚠ 2 commits behind');
  expect(text[3]).toBe('        build-b #9   c3c3c3c3  ✓ latest');
  //? Each build opens its run; each hash its commit
  expect(pagesOf(content.rows)).toContainEqual({ step: 'build-b', job: 'build_b', run: '9' });
  expect(linksOf(content.rows).map((link) => link.url)).toContain('https://gh/commit/c3c3c3c3c3');
});

test('a run line links its number and the build it deployed — to their pages too', () => {
  const run = history.envs[0]?.steps[0]?.jobs[0]?.runs[0];
  if (!run) throw new Error('fixture');
  const line = runLine(pipeline[3] as StepConfig, run, {
    history,
    branch: 'develop',
    toRun: (item) => JSON.stringify({ step: 'deploy', job: 'deploy_ci', run: item.id }),
  });
  expect(lineText(line)).toContain('#7 ✓ 14:02   3m12s  develop  build-a #42  mb');
  expect(linksOf([line]).map((link) => link.url)).toEqual([
    'https://ci/job/deploy_ci/7/',
    'https://ci/job/build_a/42/',
  ]);
  expect(pagesOf([line])).toEqual([
    { step: 'deploy', job: 'deploy_ci', run: '7' },
    { step: 'build-a', job: 'build_a', run: '42' },
  ]);
  expect(foldsOf([line])).toEqual({ keys: [], anyClosed: false });
});
