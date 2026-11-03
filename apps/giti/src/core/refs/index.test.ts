import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import {
  deleteRef,
  findCounterparts,
  getAdvertisedRefs,
  getRefDetail,
  getRefs,
  localRefFor,
  restoreRef,
  splitRefName,
} from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

/** A commit with three parents, written with plumbing: the shape no porcelain view reads well. */
const makeOctopus = (r: ReturnType<typeof makeRepo>) => {
  const head = r.sh(['rev-parse', 'HEAD']).trim();
  r.write('a.txt', 'side-one\n');
  r.sh(['add', 'a.txt']);
  const one = r
    .sh(['commit-tree', r.sh(['write-tree']).trim(), '-p', head, '-m', 'side one'])
    .trim();
  r.write('b.txt', 'side-two\n');
  r.sh(['add', 'b.txt']);
  const tree = r.sh(['write-tree']).trim();
  const two = r.sh(['commit-tree', tree, '-m', 'side two']).trim();
  const merge = r
    .sh(['commit-tree', tree, '-p', head, '-p', one, '-p', two, '-m', 'octopus'])
    .trim();
  //? Custom refs get no reflog unless asked: git logs only heads, remotes and notes by default
  r.sh(['update-ref', '--create-reflog', 'refs/custom/octopus', merge]);
  return merge;
};

describe('refs', () => {
  test('reads the namespace off the name alone, whatever namespace it is', () => {
    expect(splitRefName('refs/heads/me/feature')).toEqual({
      group: 'refs/heads',
      short: 'me/feature',
    });
    expect(splitRefName('refs/anything/a/b')).toEqual({ group: 'refs/anything', short: 'a/b' });
    expect(splitRefName('refs/lonely')).toEqual({ group: 'refs', short: 'lonely' });
    expect(splitRefName('HEAD')).toEqual({ group: '', short: 'HEAD' });
  });

  test('lists HEAD, branches, tags and custom refs with how each is stored', async () => {
    repo = makeRepo();
    repo.sh(['tag', '-a', 'v1', '-m', 'release']);
    repo.sh(['pack-refs', '--all']);
    repo.sh(['branch', 'loose-one']);
    repo.sh(['update-ref', 'refs/someone/debug/x', 'HEAD']);
    repo.sh(['update-ref', 'refs/anything/y', 'HEAD^{tree}']);

    const refs = await getRefs(repo.root);
    const byName = new Map(refs.map((ref) => [ref.name, ref]));
    expect(refs[0]?.name).toBe('HEAD');
    expect(byName.get('HEAD')?.symref).toBe('refs/heads/main');
    expect(byName.get('refs/heads/main')?.isHead).toBe(true);
    expect(byName.get('refs/heads/main')?.storage).toMatch(/packed|reftable/);
    expect(byName.get('refs/heads/loose-one')?.storage).toMatch(/^loose$|reftable/);
    expect(byName.get('refs/tags/v1')?.type).toBe('tag');
    expect(byName.get('refs/tags/v1')?.peeledType).toBe('commit');
    expect(byName.get('refs/someone/debug/x')).toMatchObject({
      group: 'refs/someone',
      short: 'debug/x',
    });
    expect(byName.get('refs/anything/y')).toMatchObject({ group: 'refs/anything', type: 'tree' });
    //? Root refs first, then namespace by namespace
    const groups = [...new Set(refs.map((ref) => ref.group))];
    expect(groups).toEqual([...groups].sort());
    expect(groups[0]).toBe('');
  });

  test('takes a many-parent commit apart: every parent named, each side previewed on its own', async () => {
    repo = makeRepo();
    makeOctopus(repo);
    const ref = (await getRefs(repo.root)).find((r) => r.name === 'refs/custom/octopus');
    if (!ref) throw new Error('refs/custom/octopus not listed');
    const detail = await getRefDetail(repo.root, ref);
    expect(detail.info.find(([label]) => label === 'parent ^3')?.[1]).toContain('side two');
    expect(detail.info.find(([label]) => label === 'shape')?.[1]).toBe('merge (3 parents)');
    expect(detail.raw).toMatch(/^tree [0-9a-f]+/);
    expect(detail.preview).toContain('── ^3: its own change ──');
    expect(detail.preview).toContain('+side-two');
    expect(detail.reflog).toContain('octopus@{0}');
  });

  test('maps remote refs through the configured fetch refspecs', () => {
    const specs = ['+refs/heads/*:refs/remotes/origin/*', '+refs/x/*/tip:refs/mirror/x/*'];
    expect(localRefFor(specs, 'refs/heads/me/feature')).toBe('refs/remotes/origin/me/feature');
    expect(localRefFor(specs, 'refs/x/abc/tip')).toBe('refs/mirror/x/abc');
    expect(localRefFor(specs, 'refs/tags/v1')).toBe('refs/tags/v1');
    expect(localRefFor(specs, 'refs/pull/1/head')).toBeUndefined();
  });

  test('sets what a remote advertises against what was fetched', async () => {
    repo = makeRepo({ remote: true });
    repo.sh(['config', '--add', 'remote.origin.fetch', '+refs/custom/*:refs/fetched/origin/*']);
    repo.sh(['push', '-q', 'origin', 'HEAD:refs/custom/shared']);
    repo.sh(['commit', '-q', '--allow-empty', '-m', 'local only']);
    repo.sh(['push', '-q', 'origin', 'HEAD:refs/heads/other', 'HEAD:refs/heads/main']);
    //? Pushing updates the tracking refs too; drop one and rewind the other to look unfetched / stale
    repo.sh(['update-ref', '-d', 'refs/remotes/origin/other']);
    repo.sh(['update-ref', 'refs/remotes/origin/main', 'HEAD~1']);
    const local = await getRefs(repo.root);
    const advertised = await getAdvertisedRefs(repo.root, 'origin', local);
    const byName = new Map(advertised.map((ref) => [ref.name, ref]));
    expect(byName.get('refs/heads/main')?.fetched).toBe('differs');
    expect(byName.get('refs/heads/other')?.fetched).toBe('not fetched');
    expect(byName.get('refs/custom/shared')).toMatchObject({
      localRef: 'refs/fetched/origin/shared',
      //? The push itself updated it, through the refspec added above
      fetched: 'same',
    });
  });

  test('deletes a ref and puts it back, plain or symbolic, and refuses what git needs', async () => {
    repo = makeRepo();
    repo.sh(['update-ref', 'refs/custom/a', 'HEAD']);
    repo.sh(['symbolic-ref', 'refs/custom/link', 'refs/custom/a']);
    const find = async (name: string) => (await getRefs(repo.root)).find((r) => r.name === name);

    const plain = await deleteRef(repo.root, (await find('refs/custom/a'))!);
    expect(plain.ok).toBe(true);
    expect(await find('refs/custom/a')).toBeUndefined();
    expect((await restoreRef(repo.root, plain.restore!)).ok).toBe(true);
    expect((await find('refs/custom/a'))?.hash).toBe(plain.restore!.hash);

    //? The link itself goes, not the ref it points at
    const link = await deleteRef(repo.root, (await find('refs/custom/link'))!);
    expect(link.ok).toBe(true);
    expect(await find('refs/custom/link')).toBeUndefined();
    expect(await find('refs/custom/a')).toBeDefined();
    expect((await restoreRef(repo.root, link.restore!)).ok).toBe(true);
    expect((await find('refs/custom/link'))?.symref).toBe('refs/custom/a');

    expect((await deleteRef(repo.root, (await find('HEAD'))!)).ok).toBe(false);
    expect((await deleteRef(repo.root, (await find('refs/heads/main'))!)).ok).toBe(false);
    //? Moved since it was read: the guard on the old hash leaves it alone
    const stale = (await find('refs/custom/a'))!;
    repo.sh(['commit', '-q', '--allow-empty', '-m', 'moved']);
    repo.sh(['update-ref', 'refs/custom/a', 'HEAD']);
    expect((await deleteRef(repo.root, stale)).ok).toBe(false);
  });

  test('deletes a ref on its remote and pushes it back', async () => {
    repo = makeRepo({ remote: true });
    repo.sh(['push', '-q', 'origin', 'HEAD:refs/custom/shared']);
    const listed = async () =>
      (await getAdvertisedRefs(repo.root, 'origin', await getRefs(repo.root))).find(
        (r) => r.name === 'refs/custom/shared',
      );
    const removed = await deleteRef(repo.root, (await listed())!);
    expect(removed.ok).toBe(true);
    expect(await listed()).toBeUndefined();
    expect((await restoreRef(repo.root, removed.restore!)).ok).toBe(true);
    expect(await listed()).toBeDefined();
  });

  test('finds what the other side holds of a ref: by refspec, by name, or only by its object', async () => {
    repo = makeRepo({ remote: true });
    repo.sh(['push', '-q', 'origin', 'HEAD:refs/custom/same-name', 'HEAD:refs/elsewhere/copy']);
    //? Fetched with a refspec typed on the command line, never configured: only the object ties them
    repo.sh(['fetch', '-q', 'origin', 'refs/elsewhere/*:refs/mirror/origin/*']);
    repo.sh(['update-ref', 'refs/custom/same-name', 'HEAD']);
    const local = await getRefs(repo.root);
    const find = (name: string) => local.find((ref) => ref.name === name);

    const mirror = await findCounterparts(repo.root, find('refs/mirror/origin/copy')!, local);
    expect(mirror.counterparts.map((c) => [c.ref.name, c.reason])).toContainEqual([
      'refs/elsewhere/copy',
      'same object',
    ]);
    const named = await findCounterparts(repo.root, find('refs/custom/same-name')!, local);
    expect(named.counterparts[0]).toMatchObject({ reason: 'same name' });
    const tracking = await findCounterparts(repo.root, find('refs/remotes/origin/main')!, local);
    expect(tracking.counterparts[0]).toMatchObject({
      reason: 'fetched as this',
      ref: { name: 'refs/heads/main', remote: 'origin' },
    });
    //? From the remote side: the local ref its refspec fills
    const advertised = await getAdvertisedRefs(repo.root, 'origin', local);
    const back = await findCounterparts(
      repo.root,
      advertised.find((ref) => ref.name === 'refs/heads/main')!,
      local,
    );
    expect(back.counterparts.map((c) => c.ref.name)).toEqual(['refs/remotes/origin/main']);
  });
});
