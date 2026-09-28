import { describe, expect, test } from 'bun:test';

import { repositoryWebUrl } from './index';

describe('repositoryWebUrl', () => {
  test('turns every package.json spelling into a page', () => {
    expect(repositoryWebUrl('github:vercel/next.js')).toBe('https://github.com/vercel/next.js');
    expect(repositoryWebUrl('gitlab:a/b')).toBe('https://gitlab.com/a/b');
    expect(repositoryWebUrl('facebook/react')).toBe('https://github.com/facebook/react');
    expect(repositoryWebUrl('git+https://github.com/facebook/react.git')).toBe(
      'https://github.com/facebook/react',
    );
    expect(repositoryWebUrl('git+ssh://git@github.com/a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('git://github.com/a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('git@github.com:a/b.git')).toBe('https://github.com/a/b');
    expect(repositoryWebUrl('https://github.com/a/b.git#main')).toBe('https://github.com/a/b');
  });

  test('gives up on what is not a web page', () => {
    expect(repositoryWebUrl('file:../local')).toBeUndefined();
  });
});
