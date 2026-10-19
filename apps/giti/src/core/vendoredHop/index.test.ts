import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import makeRepo from '../testRepo';
import { applyVendoredHop, planVendoredHop, planVendoredHopAtHead } from '.';

let repos: ReturnType<typeof makeRepo>[] = [];
afterEach(() => {
  for (const repo of repos) repo.cleanup();
  repos = [];
});

/** A parent on `main` with one submodule, `mod`, cloned from its own bare remote. */
const withSubmodule = () => {
  const upstream = makeRepo({ remote: true });
  const parent = makeRepo();
  repos.push(upstream, parent);
  const bare = join(upstream.base, 'remote.git');
  //? The bare remote's HEAD names git's default branch, which may not be the `main` pushed to it
  upstream.sh(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
  //? file:// submodules are refused by default since git 2.38.1 — allowed for this test only
  parent.sh(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', bare, 'mod']);
  parent.sh(['commit', '-qm', 'add mod']);
  const mod = join(parent.root, 'mod');
  const inMod = (args: string[]) => parent.sh(args, mod);
  inMod(['config', 'user.email', 'test@example.com']);
  inMod(['config', 'user.name', 'Test']);
  return { upstream, parent, mod, inMod };
};

describe('vendoredHop', () => {
  test('recommends switching a submodule that already has the branch locally', async () => {
    const { parent, mod, inMod } = withSubmodule();
    inMod(['branch', 'feature']);
    const [entry] = await planVendoredHop(parent.root, 'feature');
    expect(entry).toMatchObject({
      kind: 'submodule',
      dir: 'mod',
      current: 'main',
      action: 'switch',
      found: 'local',
      recommended: true,
    });

    expect((await applyVendoredHop(parent.root, entry!, 'feature')).ok).toBe(true);
    expect(parent.sh(['branch', '--show-current'], mod).trim()).toBe('feature');
  });

  test('finds a branch only the submodule upstream has, and switches to a tracking branch', async () => {
    const { upstream, parent, mod } = withSubmodule();
    upstream.sh(['push', '-q', 'origin', 'main:remote-only']);
    const [entry] = await planVendoredHop(parent.root, 'remote-only');
    expect(entry).toMatchObject({ action: 'switch', found: 'remote', recommended: true });

    expect((await applyVendoredHop(parent.root, entry!, 'remote-only')).ok).toBe(true);
    expect(parent.sh(['rev-parse', '--abbrev-ref', '@{u}'], mod).trim()).toBe('origin/remote-only');
  });

  test('offers to create a missing branch, but never ticks it', async () => {
    const { parent, mod } = withSubmodule();
    const [entry] = await planVendoredHop(parent.root, 'nowhere');
    expect(entry).toMatchObject({ action: 'create', found: 'nowhere', recommended: false });

    expect((await applyVendoredHop(parent.root, entry!, 'nowhere')).ok).toBe(true);
    expect(parent.sh(['branch', '--show-current'], mod).trim()).toBe('nowhere');
  });

  test('leaves a submodule already on the branch alone', async () => {
    const { parent } = withSubmodule();
    const [entry] = await planVendoredHop(parent.root, 'main');
    expect(entry).toMatchObject({ action: 'none', recommended: false });
  });

  test('offers a dirty submodule its switch without ticking it', async () => {
    const { parent, mod, inMod } = withSubmodule();
    inMod(['branch', 'feature']);
    await Bun.write(join(mod, 'a.txt'), 'changed\n');
    const [entry] = await planVendoredHop(parent.root, 'feature');
    expect(entry).toMatchObject({ action: 'switch', recommended: false });
    expect(entry?.note).toContain('uncommitted');
  });

  test('a repository with nothing vendored has nothing to plan', async () => {
    const repo = makeRepo();
    repos.push(repo);
    expect(await planVendoredHop(repo.root, 'main')).toEqual([]);
  });
});

describe('planVendoredHopAtHead', () => {
  test('plans for the branch the parent is on', async () => {
    const { parent, inMod } = withSubmodule();
    inMod(['branch', 'feature']);
    parent.sh(['switch', '-qc', 'feature']);
    const plan = await planVendoredHopAtHead(parent.root);
    expect(plan?.branch).toBe('feature');
    expect(plan?.entries[0]).toMatchObject({ dir: 'mod', action: 'switch', recommended: true });
  });

  test('has nothing to follow on a detached HEAD', async () => {
    const repo = makeRepo();
    repos.push(repo);
    repo.sh(['switch', '-q', '--detach']);
    expect(await planVendoredHopAtHead(repo.root)).toBeNull();
  });
});
