import { expect, test } from 'bun:test';

import { history, pipeline, rows } from './fixtures';
import { type DetailInput, lineText, linksOf, targetOf, toRun, toStep } from './lines';
import {
  crumbs,
  envRootLines,
  pathTo,
  resolveTarget,
  runPageLines,
  stepPageLines,
} from './pages';

const input: DetailInput = {
  configs: [{ id: 'ci', url: 'https://ci-www', branches: ['develop'] }],
  pipeline,
  stepsFor: () => pipeline,
  rows,
  history,
  branch: 'develop',
  targetEnv: 'ci',
  width: 100,
};

const pagesOf = (lines: ReturnType<typeof envRootLines>) =>
  linksOf(lines).flatMap((link) => (link.to ? [targetOf(link.to)] : []));

test('an env: the branch on it, then each step only as it concerns the env', () => {
  const lines = envRootLines(input, 'ci');
  const text = lines.map(lineText);
  expect(text[0]).toBe('branch develop   meant for develop   site https://ci-www');
  //? Every step read opens on the env; the runs on it are pages too
  const pages = pagesOf(lines);
  expect(pages).toContainEqual({ step: 'deploy' });
  expect(pages).toContainEqual({ step: 'build-a' });
  expect(pages).toContainEqual({ step: 'push' });
  expect(pages).toContainEqual({ step: 'deploy', job: 'deploy_ci', run: '7' });
  expect(pages).toContainEqual({ step: 'build-a', job: 'build_a', run: '42' });
  //? Not about ci: another branch's build (#44), any job's tally, every job of a step — a newer
  //? good build of what ci runs (#45) is, it says ci is behind
  expect(text.some((line) => line.includes('#44'))).toBe(false);
  expect(text.some((line) => /\d+ runs? ·/.test(line))).toBe(false);
  expect(text.some((line) => line.includes('deploy_env_ci'))).toBe(false);
  expect(linksOf(lines).some((link) => link.action)).toBe(false);
});

test('an env on a branch it is not meant for says so in words', () => {
  const text = envRootLines(
    { ...input, configs: [{ id: 'ci', branches: ['release-*'] }] },
    'ci',
  ).map(lineText);
  expect(text[1]).toBe('⚠ off-track — develop is not a branch ci is meant for');
});

test("a build step's page on the env: its box, then only the env's branch's builds by day", () => {
  const lines = stepPageLines(input, 'ci', targetOf(toStep('build-a')));
  const text = lines.map(lineText);
  expect(text[0]).toContain('build-a');
  expect(text[1]).toBe('#42 ✓ develop');
  expect(text.find((line) => line.startsWith('build_a'))).toContain('develop · 2 runs · 2 ✓');
  expect(text.find((line) => line.includes('#42') && line.includes('◀ on ci'))).toBeDefined();
  //? master's #44 does not concern ci
  expect(text.some((line) => line.includes('#44'))).toBe(false);
  expect(pagesOf(lines)).toContainEqual({ step: 'build-a', job: 'build_a', run: '45' });
  expect(linksOf(lines).find((link) => link.action?.startsWith('day:'))?.open).toBe(true);
});

test("a deploy step's page: each of its jobs on the env, one missing on the server", () => {
  const text = stepPageLines(input, 'ci', targetOf(toStep('deploy'))).map(lineText);
  expect(text[0]).toContain('Deploy to ci');
  expect(text.find((line) => line.startsWith('deploy_ci'))).toContain('1 run · 1 ✓');
  expect(text.find((line) => line.startsWith('deploy_env_ci'))).toContain('not on the server');
});

test("a deploy run's page: on the env now, the builds it deployed (pages), its parameters", () => {
  const lines = runPageLines(input, 'ci', targetOf(toRun('deploy', 'deploy_ci', '7')));
  const text = lines.map(lineText);
  expect(text[0]).toContain('deploy_ci #7');
  expect(text[1]).toContain('took 3m12s');
  expect(text.some((line) => line.includes('◀ what ci runs now'))).toBe(true);
  expect(text.some((line) => line.includes('A_VERSION') && line.includes('1.0.x.42'))).toBe(true);
  expect(pagesOf(lines)).toContainEqual({ step: 'build-a', job: 'build_a', run: '42' });
  expect(linksOf(lines).map((link) => link.url)).toContain('https://ci/job/deploy_ci/7/');
});

test("a build run's page: not on the env, what is; older and newer only among the env's branch", () => {
  const lines = runPageLines(input, 'ci', targetOf(toRun('build-a', 'build_a', '45')));
  const text = lines.map(lineText);
  expect(text.find((line) => line.startsWith('not on ci now'))).toContain('#42');
  //? Older is #42, not master's #44 in between
  expect(pagesOf(lines)).toContainEqual({ step: 'build-a', job: 'build_a', run: '42' });
  expect(text.some((line) => line.includes('#44'))).toBe(false);
  expect(text.some((line) => line.includes('newest ›'))).toBe(true);
});

test('a page no longer read says so; the path names the step on the env, then the run', () => {
  const target = { step: 'build-a', job: 'build_a', run: '1' };
  expect(resolveTarget(input, 'ci', target).run).toBeUndefined();
  expect(runPageLines(input, 'ci', target).map(lineText)[1]).toContain('not in what was read');
  expect(crumbs(input, 'ci', pathTo(target))).toEqual(['build-a', '#1']);
  expect(crumbs(input, 'ci', [{ step: 'deploy' }])).toEqual(['Deploy to ci']);
});
