import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import makeRepo from '../../core/testRepo';
import { setWorkingDir } from '../getWorkingDir';
import { CHANGE_KINDS } from '../selectChanges';
import stageFiles from '../stageFiles';
import unstageFiles from '../unstageFiles';
import runStageCommand from '.';

describe('runStageCommand', () => {
  let repo: ReturnType<typeof makeRepo>;
  const staged = () => repo.sh(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const stage = (args: string[]) =>
    runStageCommand(args, {
      from: 'unstaged',
      verb: 'stage',
      kinds: CHANGE_KINDS.filter((kind) => kind !== 'added'),
      apply: stageFiles,
    });
  const unstage = (args: string[]) =>
    runStageCommand(args, {
      from: 'staged',
      verb: 'unstage',
      kinds: CHANGE_KINDS.filter((kind) => kind !== 'untracked'),
      apply: unstageFiles,
    });

  beforeAll(() => {
    repo = makeRepo();
    repo.write('b.txt', 'b\n');
    repo.write('sub/c.txt', 'c\n');
    repo.sh(['add', '.']);
    repo.sh(['commit', '-q', '-m', 'more']);
  });

  afterEach(() => {
    repo.sh(['reset', '-q', '--hard']);
    repo.sh(['clean', '-qfd']);
    setWorkingDir(repo.root);
  });

  afterAll(() => repo?.cleanup());

  test('stages only the kind it is asked for', async () => {
    setWorkingDir(repo.root);
    repo.write('a.txt', 'changed\n');
    rmSync(join(repo.root, 'b.txt'));
    repo.write('new.txt', 'new\n');

    await stage(['--deleted']);
    expect(staged()).toEqual(['b.txt']);

    await stage(['--untracked']);
    expect(staged()).toEqual(['b.txt', 'new.txt']);
  });

  test('changes nothing when neither a path nor a kind is given', async () => {
    setWorkingDir(repo.root);
    repo.write('a.txt', 'changed\n');

    await stage([]);
    expect(staged()).toEqual([]);
  });

  test('reads a typed path relative to the subfolder it was typed in', async () => {
    repo.write('sub/c.txt', 'changed\n');
    setWorkingDir(join(repo.root, 'sub'));

    await stage(['c.txt']);
    expect(staged()).toEqual(['sub/c.txt']);
  });

  test('unstages both halves of a rename', async () => {
    setWorkingDir(repo.root);
    repo.sh(['mv', 'b.txt', 'renamed.txt']);

    await unstage(['--renamed']);
    expect(staged()).toEqual([]);
  });
});
