import { describe, expect, test } from 'bun:test';
import repoWebLinks from '.';

describe('repoWebLinks', () => {
  test('turns an SSH GitHub remote into its web pages', () => {
    const result = repoWebLinks('git@github.com:acme/widgets.git');

    expect(result?.host).toBe('github');
    expect(result?.home).toBe('https://github.com/acme/widgets');
    expect(result?.links.actions).toBe('https://github.com/acme/widgets/actions');
    expect(result?.links.pages).toBe('https://acme.github.io/widgets/');
  });

  test('opens the real site when the remote goes through an SSH host alias', () => {
    const result = repoWebLinks('git@github.com-work:acme/widgets.git');

    expect(result?.home).toBe('https://github.com/acme/widgets');
  });

  test('offers a pull request for a branch only when one is named', () => {
    expect(repoWebLinks('https://github.com/acme/widgets')?.links.pr).toBeUndefined();
    expect(repoWebLinks('https://github.com/acme/widgets', { branch: 'feat/x' })?.links.pr).toBe(
      'https://github.com/acme/widgets/compare/feat%2Fx?expand=1',
    );
    expect(
      repoWebLinks('https://github.com/acme/widgets', { branch: 'feat/x', baseBranch: 'main' })
        ?.links.pr,
    ).toBe('https://github.com/acme/widgets/compare/main...feat%2Fx?expand=1');
  });

  test('uses GitLab page paths, including a new merge request for a branch', () => {
    const result = repoWebLinks('git@gitlab.example.com:team/app.git', { branch: 'fix' });

    expect(result?.host).toBe('gitlab');
    expect(result?.links.actions).toBe('https://gitlab.example.com/team/app/-/pipelines');
    expect(result?.links.pr).toBe(
      'https://gitlab.example.com/team/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix',
    );
  });

  test('only offers the home page for a host it does not recognise', () => {
    const result = repoWebLinks('https://git.example.com/team/app.git', { branch: 'fix' });

    expect(result?.host).toBe('other');
    expect(result?.links).toEqual({ home: 'https://git.example.com/team/app' });
  });

  test('has nothing to open for a remote that is a local path', () => {
    expect(repoWebLinks('/srv/git/app.git')).toBeUndefined();
  });
});
