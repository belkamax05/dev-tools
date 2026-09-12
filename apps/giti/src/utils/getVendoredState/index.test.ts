import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getVendoredState from '.';
import getSubmodules from '../getSubmodules';
import gitExec from '../gitExec';

/** Cloning a submodule from a path needs this since git 2.38, and the fixtures are all local. */
const LOCAL_CLONES = ['-c', 'protocol.file.allow=always'];

const commit = async (repo: string, name: string) => {
  await writeFile(join(repo, name), `${name}\n`);
  await gitExec(['add', '.'], repo);
  await gitExec(['commit', '-m', name], repo);
};

const initRepo = async (repo: string) => {
  await gitExec(['init', '-b', 'main'], repo);
  await gitExec(['config', 'user.email', 'test@example.com'], repo);
  await gitExec(['config', 'user.name', 'Test'], repo);
};

describe('getVendoredState', () => {
  let upstream = '';
  let parent = '';
  let submodule = '';

  const state = async () => {
    const [entry] = await getSubmodules(parent);
    if (!entry) throw new Error('fixture has no submodule');
    return getVendoredState(entry, parent);
  };

  beforeAll(async () => {
    upstream = await mkdtemp(join(tmpdir(), 'giti-upstream-'));
    await gitExec(['init', '--bare', '-b', 'main'], upstream);

    const seed = await mkdtemp(join(tmpdir(), 'giti-seed-'));
    await initRepo(seed);
    await commit(seed, 'first.txt');
    await gitExec(['push', upstream, 'main'], seed);
    await rm(seed, { recursive: true, force: true });

    parent = await mkdtemp(join(tmpdir(), 'giti-parent-'));
    await initRepo(parent);
    await commit(parent, 'README.md');
    await gitExec([...LOCAL_CLONES, 'submodule', 'add', '-b', 'main', upstream, 'lib'], parent);
    await gitExec(['commit', '-m', 'add submodule'], parent);
    submodule = join(parent, 'lib');
  });

  afterAll(async () => {
    for (const dir of [upstream, parent]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('reports a freshly added submodule as level with its upstream', async () => {
    const fresh = await state();

    expect(fresh.behind).toBe(0);
    expect(fresh.ahead).toBe(0);
    expect(fresh.gitlinkBehind).toBe(0);
  });

  test('does not call a pushed submodule behind just because the parent has not recorded it', async () => {
    await commit(submodule, 'second.txt');
    await commit(submodule, 'third.txt');
    await gitExec(['push', 'origin', 'main'], submodule);

    const moved = await state();

    //? The whole point: upstream has nothing this checkout is missing, so nothing to pull.
    expect(moved.behind).toBe(0);
    expect(moved.ahead).toBe(0);
    //? The drift is the parent's stale pointer, counted separately and in commits.
    expect(moved.gitlinkBehind).toBe(2);
  });

  test('stops reporting drift once the parent stages the moved pointer', async () => {
    await gitExec(['add', 'lib'], parent);

    const recorded = await state();

    expect(recorded.gitlinkBehind).toBe(0);
    expect(recorded.behind).toBe(0);
  });

  test('counts unpushed submodule commits as ahead even when the pointer is current', async () => {
    await commit(submodule, 'fourth.txt');
    await gitExec(['add', 'lib'], parent);

    const unpushed = await state();

    expect(unpushed.ahead).toBe(1);
    expect(unpushed.gitlinkBehind).toBe(0);
    expect(unpushed.behind).toBe(0);
  });

  test('counts upstream commits the submodule checkout is missing as behind', async () => {
    const other = await mkdtemp(join(tmpdir(), 'giti-other-'));
    await gitExec(['clone', upstream, other], parent);
    await gitExec(['config', 'user.email', 'test@example.com'], other);
    await gitExec(['config', 'user.name', 'Test'], other);
    await commit(other, 'remote-only.txt');
    await gitExec(['push', 'origin', 'main'], other);
    await rm(other, { recursive: true, force: true });

    const behind = await state();

    expect(behind.behind).toBe(1);
    expect(behind.ahead).toBe(1);
  });
});
