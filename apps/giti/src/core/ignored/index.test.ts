import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import makeRepo from '../testRepo';
import {
  applyIgnoredOptions,
  buildIgnoredTree,
  clearIgnored,
  getIgnored,
  ignoredPaths,
  measureIgnored,
  previewIgnored,
  printIgnoredTree,
} from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const setup = () => {
  repo = makeRepo();
  repo.write('.gitignore', 'build/\n*.log\nnode_modules/\n.env\n');
  repo.write('build/out.js', 'x');
  repo.write('build/keep.txt', 'tracked');
  repo.sh(['add', '-f', 'build/keep.txt']);
  repo.write('node_modules/pkg/index.js', 'x'.repeat(5000));
  repo.write('apps/web/node_modules/pkg/index.js', 'x');
  repo.write('apps/web/notes.txt', 'untracked, not ignored');
  repo.write('logs/a.log', 'a');
  repo.write('.env', 'SECRET=1');
  return repo;
};

describe('ignored files', () => {
  test('lists ignored directories whole and never a folder that holds other work', async () => {
    setup();
    const paths = (await getIgnored(repo.root)).map((e) => e.path).sort();
    expect(paths).toEqual([
      '.env',
      'apps/web/node_modules',
      'build/out.js',
      'logs/a.log',
      'node_modules',
    ]);
  });

  test('folds entries into a tree, collapsing single-folder chains and summing sizes', async () => {
    setup();
    const entries = await getIgnored(repo.root);
    const sizes = await measureIgnored(
      repo.root,
      entries.map((e) => e.path),
    );
    const tree = buildIgnoredTree(entries, sizes);
    const apps = tree.find((n) => n.name === 'apps/web');
    expect(apps?.ignored).toBe(false);
    expect(apps && ignoredPaths(apps)).toEqual(['apps/web/node_modules']);
    expect(tree[0]?.path).toBe('node_modules');
    expect(tree.find((n) => n.path === '.env')?.sensitive).toBe(true);
    expect(printIgnoredTree(tree).some((line) => line.includes('may hold secrets'))).toBe(true);
  });

  test('previews a file, an ignored folder and a container, masking secrets', async () => {
    setup();
    repo.write('logs/a.log', 'first\nsecond\n');
    const tree = buildIgnoredTree(await getIgnored(repo.root));
    const node = (path: string) => {
      const find = (list: typeof tree): (typeof tree)[number] | undefined => {
        for (const n of list) {
          if (n.path === path) return n;
          const inner = find(n.children);
          if (inner) return inner;
        }
      };
      return find(tree)!;
    };
    expect(previewIgnored(repo.root, node('logs/a.log')).lines).toEqual(['first', 'second']);
    expect(previewIgnored(repo.root, node('node_modules')).lines).toEqual(['pkg/']);
    expect(previewIgnored(repo.root, node('apps/web')).lines).toEqual(['node_modules']);
    const env = previewIgnored(repo.root, node('.env'));
    expect(env.lines).toEqual(['SECRET=•']);
    expect(env.summary).toContain('masked');
  });

  test('hides and preselects by glob, a folder pattern covering what is under it', () => {
    const entries = [
      { path: 'node_modules', isDir: true },
      { path: 'apps/web/node_modules', isDir: true },
      { path: 'apps/legacy/dist', isDir: true },
      { path: '.env', isDir: false },
    ];
    const result = applyIgnoredOptions(entries, {
      hide: ['apps/legacy', '.env'],
      preselect: ['**/node_modules/'],
    });
    expect(result.entries.map((e) => e.path)).toEqual(['node_modules', 'apps/web/node_modules']);
    expect(result.preselected).toEqual(['node_modules', 'apps/web/node_modules']);
  });

  test('removes what is still ignored and refuses anything else', async () => {
    setup();
    const result = await clearIgnored(repo.root, [
      'node_modules',
      'apps/web/node_modules',
      'apps/web/notes.txt',
      'build',
      '../outside',
    ]);
    expect(result.removed).toEqual(['node_modules', 'apps/web/node_modules']);
    expect(result.failed.map((f) => f.path)).toEqual(['apps/web/notes.txt', 'build', '../outside']);
    expect(existsSync(join(repo.root, 'node_modules'))).toBe(false);
    expect(existsSync(join(repo.root, 'apps/web/notes.txt'))).toBe(true);
    expect(existsSync(join(repo.root, 'build/keep.txt'))).toBe(true);
  });
});
