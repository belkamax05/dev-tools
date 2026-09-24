import { expect, test } from 'bun:test';

import { remoteWebUrl } from '.';

test('turns git remotes into web pages', () => {
  expect(remoteWebUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
  expect(remoteWebUrl('ssh://git@gitlab.example.com:2222/group/sub/repo.git')).toBe(
    'https://gitlab.example.com/group/sub/repo',
  );
  expect(remoteWebUrl('https://user:token@github.com/owner/repo.git')).toBe(
    'https://github.com/owner/repo',
  );
  expect(remoteWebUrl('/srv/git/repo.git')).toBeUndefined();
});
