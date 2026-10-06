import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pullVendored from '.';
import getSubmodules from '../getSubmodules';
import getSubrepos from '../getSubrepos';
import getVendoredState from '../getVendoredState';
import gitExec from '../gitExec';

/** Cloning a submodule from a path needs this since git 2.38, and the fixtures are all local. */
const LOCAL_CLONES = ['-c', 'protocol.file.allow=always'];

const commit = async (repo: string, name: string) => {
  await writeFile(join(repo, name), `${name}\n`);
  await gitExec(['add', '.'], repo);
  await gitExec(['commit', '-m', name], repo);
};

const identify = async (repo: string) => {
  await gitExec(['config', 'user.email', 'test@example.com'], repo);
  await gitExec(['config', 'user.name', 'Test'], repo);
};

const head = async (repo: string, rev = 'HEAD') =>
  (await gitExec(['rev-parse', rev], repo)).stdout.trim();

describe('pullVendored on a submodule checked out on a branch', () => {
  let upstream = '';
  let seed = '';
  let parent = '';
  let submodule = '';

  const entry = async () => {
    const [found] = await getSubmodules(parent);
    if (!found) throw new Error('fixture has no submodule');
    return found;
  };

  beforeAll(async () => {
    //? Upstream has a default branch (main) and a release branch, like a typical app repo's
    //? AmplianceVisualisation: `.gitmodules` names no branch, so `submodule update --remote`
    //? would follow main, while the checkout itself sits on release.
    upstream = await mkdtemp(join(tmpdir(), 'giti-upstream-'));
    await gitExec(['init', '--bare', '-b', 'main'], upstream);

    seed = await mkdtemp(join(tmpdir(), 'giti-seed-'));
    await gitExec(['init', '-b', 'main'], seed);
    await identify(seed);
    await commit(seed, 'first.txt');
    await gitExec(['push', upstream, 'main'], seed);
    await gitExec(['push', upstream, 'main:release'], seed);
    await gitExec(['remote', 'add', 'origin', upstream], seed);

    parent = await mkdtemp(join(tmpdir(), 'giti-parent-'));
    await gitExec(['init', '-b', 'main'], parent);
    await identify(parent);
    await commit(parent, 'README.md');
    await gitExec([...LOCAL_CLONES, 'submodule', 'add', upstream, 'lib'], parent);
    await gitExec(['commit', '-m', 'add submodule'], parent);

    submodule = join(parent, 'lib');
    await identify(submodule);
    await gitExec(['checkout', '-B', 'release', '--track', 'origin/release'], submodule);

    //? Upstream moves on both branches: one commit on release, one on main.
    await gitExec(['fetch', 'origin'], seed);
    await gitExec(['checkout', '-B', 'release', 'origin/release'], seed);
    await commit(seed, 'release-fix.txt');
    await gitExec(['push', 'origin', 'release'], seed);
    await gitExec(['checkout', 'main'], seed);
    await commit(seed, 'main-feature.txt');
    await gitExec(['push', 'origin', 'main'], seed);
  });

  afterAll(async () => {
    for (const dir of [upstream, seed, parent]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('measures behind against the checked-out branch, not the remote default', async () => {
    const state = await getVendoredState(await entry(), parent);

    expect(state.behind).toBe(1);
    expect(state.upstreamRef).toBe(await head(seed, 'origin/release'));
  });

  test('pulls the checked-out branch from its own upstream and leaves main out', async () => {
    const outcome = await pullVendored(await entry(), parent);

    expect(outcome).toBe('done');
    expect(await head(submodule)).toBe(await head(seed, 'origin/release'));
    expect((await gitExec(['symbolic-ref', '--short', 'HEAD'], submodule)).stdout.trim()).toBe(
      'release',
    );

    const mainTip = await head(seed, 'origin/main');
    const merged = await gitExec(['merge-base', '--is-ancestor', mainTip, 'HEAD'], submodule);
    expect(merged.exitCode).not.toBe(0);
  });

  test('reports the branch current once it is pulled', async () => {
    const outcome = await pullVendored(await entry(), parent);

    expect(outcome).toBe('current');
  });
});

describe('pullVendored on a subrepo', () => {
  let upstream = '';
  let seed = '';
  let parent = '';

  const entry = async () => {
    const [found] = await getSubrepos(parent);
    if (!found) throw new Error('fixture has no subrepo');
    return found;
  };
  const worktrees = async () =>
    (await gitExec(['worktree', 'list', '--porcelain'], parent)).stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree ')).length;

  /** Upstream with one file, vendored into a fresh parent as `lib` by `git subrepo clone`. */
  const setup = async () => {
    upstream = await mkdtemp(join(tmpdir(), 'giti-subrepo-upstream-'));
    await gitExec(['init', '--bare', '-b', 'main'], upstream);
    seed = await mkdtemp(join(tmpdir(), 'giti-subrepo-seed-'));
    await gitExec(['clone', upstream, seed], tmpdir());
    await identify(seed);
    await writeFile(join(seed, 'a.txt'), 'one\ntwo\nthree\n');
    await gitExec(['add', '.'], seed);
    await gitExec(['commit', '-m', 'first'], seed);
    await gitExec(['push', 'origin', 'HEAD:main'], seed);

    parent = await mkdtemp(join(tmpdir(), 'giti-subrepo-parent-'));
    await gitExec(['init', '-b', 'main'], parent);
    await identify(parent);
    await commit(parent, 'README.md');
    await gitExec(['subrepo', 'clone', upstream, 'lib', '-b', 'main'], parent);
  };

  const upstreamCommit = async (file: string, content: string) => {
    await writeFile(join(seed, file), content);
    await gitExec(['add', '.'], seed);
    await gitExec(['commit', '-m', `change ${file}`], seed);
    await gitExec(['push', 'origin', 'HEAD:main'], seed);
  };

  afterAll(async () => {
    for (const dir of [upstream, seed, parent]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  //? A host repo's pre-commit formatter (lint-staged) rewrote vendored files inside the commit
  //? `git subrepo pull` makes, so the copy drifted from upstream and the next pull touching the
  //? same lines conflicted. Upstream code must land exactly as upstream wrote it.
  test("does not let the host repository's hooks rewrite vendored files", async () => {
    await setup();
    const hook = join(parent, '.git', 'hooks', 'pre-commit');
    await writeFile(
      hook,
      '#!/bin/sh\n' +
        "git diff --cached --name-only | grep '^lib/.*\\.txt$' | while read f; do\n" +
        '  echo "# reformatted by host" >> "$f"; git add "$f"\n' +
        'done\n',
    );
    await chmod(hook, 0o755);
    await upstreamCommit('b.txt', 'upstream\n');

    expect(await pullVendored(await entry(), parent)).toBe('done');
    expect(await readFile(join(parent, 'lib', 'b.txt'), 'utf8')).toBe('upstream\n');
  }, 30_000);

  //? A conflicting pull used to leave git-subrepo's worktree registered, and every later pull
  //? then refused to run until someone cleaned it up by hand.
  test('undoes a conflicting pull instead of leaving its worktree behind', async () => {
    await setup();
    await writeFile(join(parent, 'lib', 'a.txt'), 'one\nLOCAL\nthree\n');
    await gitExec(['commit', '-am', 'local edit'], parent);
    await upstreamCommit('a.txt', 'one\nUPSTREAM\nthree\n');
    const before = await head(parent);

    expect(await pullVendored(await entry(), parent)).toBe('failed');
    expect(await worktrees()).toBe(1);
    expect(await head(parent)).toBe(before);
    expect((await gitExec(['status', '--porcelain'], parent)).stdout.trim()).toBe('');
  }, 30_000);

  //? The state that used to be impossible to escape: a raw `git subrepo pull` conflicted and left
  //? its worktree. The next pull clears that by itself, and --theirs lands upstream's version.
  test('clears a leftover from an earlier failed pull and settles conflicts with --theirs', async () => {
    await setup();
    await writeFile(join(parent, 'lib', 'a.txt'), 'one\nLOCAL\nthree\n');
    await gitExec(['commit', '-am', 'local edit'], parent);
    await upstreamCommit('a.txt', 'one\nUPSTREAM\nthree\n');
    await gitExec(['subrepo', 'pull', 'lib'], parent);
    expect(await worktrees()).toBe(2);

    const args = { dirs: [], own: ['--theirs'], passthrough: [] };
    expect(await pullVendored(await entry(), parent, args)).toBe('done');
    expect(await readFile(join(parent, 'lib', 'a.txt'), 'utf8')).toBe('one\nUPSTREAM\nthree\n');
    expect(await worktrees()).toBe(1);
    expect((await gitExec(['status', '--porcelain'], parent)).stdout.trim()).toBe('');

    //? And the next pull is a plain no-op, not another conflict with the same lines
    expect(await pullVendored(await entry(), parent)).toBe('current');
  }, 30_000);
});
