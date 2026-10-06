import { describe, expect, test } from 'bun:test';

import { splitArgs, toScripts } from './index';

describe('toScripts', () => {
  test("keeps package.json's order, and tells scripts from hooks and lifecycle scripts", () => {
    const scripts = toScripts({
      prebuild: 'rm -rf dist',
      build: 'tsc',
      postbuild: 'echo done',
      dev: 'vite',
      postinstall: 'patch-package',
      prettier: 'prettier .',
      broken: 42,
    });
    expect(scripts.map((script) => [script.name, script.kind])).toEqual([
      ['prebuild', 'hook'],
      ['build', 'script'],
      ['postbuild', 'hook'],
      ['dev', 'script'],
      ['postinstall', 'hook'],
      //? `pre` + `ttier` — no `ttier` script, so it is a script of its own
      ['prettier', 'script'],
    ]);
    expect(scripts[1]).toMatchObject({ pre: 'prebuild', post: 'postbuild' });
  });
});

describe('splitArgs', () => {
  test('splits on spaces, quotes keep them, nothing is expanded', () => {
    expect(splitArgs(`-u --coverage "a b" 'c d' $HOME`)).toEqual([
      '-u',
      '--coverage',
      'a b',
      'c d',
      '$HOME',
    ]);
    expect(splitArgs('   ')).toEqual([]);
  });
});
