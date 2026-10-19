import { expect, test } from 'bun:test';
import isPushRefused from '.';

test('recognises the hosts\' ways of saying this user may not push there', () => {
  for (const output of [
    'ERROR: Permission to belkamax05/dev-tools.git denied to colleague.',
    'remote: Permission to org/repo.git denied to someone.\nfatal: unable to access',
    'git@github.com: Permission denied (publickey).',
    'remote: Write access to repository not granted.',
    "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
    'remote: GitLab: You are not allowed to push code to protected branches on this project.',
    ' ! [remote rejected] main -> main (protected branch hook declined)',
    'remote: error: GH006: Protected branch update failed for refs/heads/master.',
  ])
    expect(isPushRefused(output)).toBe(true);
});

test('leaves every other push failure a failure', () => {
  for (const output of [
    ' ! [rejected]        master -> master (non-fast-forward)',
    ' ! [remote rejected] master -> master (pre-receive hook declined)',
    'fatal: Could not read from remote repository.\nssh: connect to host github.com port 22: Connection timed out',
    'git-subrepo: There is already a worktree with branch subrepo/libs/dev-tools',
  ])
    expect(isPushRefused(output)).toBe(false);
});
