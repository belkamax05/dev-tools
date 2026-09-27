import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pullVendored from '.';
import getSubmodules from '../getSubmodules';
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
    //? Upstream has a default branch (main) and a release branch, like dfs-fe's
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
