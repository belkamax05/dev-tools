import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getMegaSelfState from '.';
import gitExec from '../gitExec';

describe('getMegaSelfState', () => {
  let workspace = '';
  let repo = '';

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'giti-self-'));
    const upstream = join(workspace, 'upstream.git');
    repo = join(workspace, 'repo');

    await gitExec(['init', '-q', '--bare', '-b', 'main', upstream], workspace);
    await gitExec(['clone', '-q', upstream, repo], workspace);
    await gitExec(['config', 'user.email', 'test@example.com'], repo);
    await gitExec(['config', 'user.name', 'Test'], repo);
    await writeFile(join(repo, 'README.md'), 'hello\n');
    await gitExec(['add', '.'], repo);
    await gitExec(['commit', '-m', 'first'], repo);
  });

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  test('says nothing rather than zero when the branch tracks no upstream', async () => {
    const state = await getMegaSelfState(repo, { fetch: false });

    expect(state.upstream).toBe('');
    expect(state.behind).toBeNull();
    expect(state.ahead).toBeNull();
  });

  test('splits the tracking branch into the remote and branch a fetch needs', async () => {
    await gitExec(['push', '-u', 'origin', 'main'], repo);
    const state = await getMegaSelfState(repo, { fetch: false });

    expect(state.upstream).toBe('origin/main');
    expect(state.remote).toBe('origin');
    expect(state.branch).toBe('main');
  });

  test('counts unpushed work as ahead of the upstream it tracks', async () => {
    await writeFile(join(repo, 'README.md'), 'hello again\n');
    await gitExec(['commit', '-am', 'second'], repo);

    const state = await getMegaSelfState(repo, { fetch: false });

    expect(state.ahead).toBe(1);
    expect(state.behind).toBe(0);
  });
});
