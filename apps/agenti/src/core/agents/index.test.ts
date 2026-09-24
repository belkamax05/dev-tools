import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getIde } from '../ides';
import {
  type AgentNode,
  deleteNode,
  flattenNodes,
  getInventory,
  getNodeDiff,
  setLinkMode,
  syncNode,
  toggleLink,
} from '.';

const ide = getIde('claude-code')!;
let root: string;

const write = (rel: string, content: string) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const isLink = (rel: string) => lstatSync(join(root, rel)).isSymbolicLink();
const node = (rel: string): AgentNode => {
  const found = flattenNodes(getInventory(root, ide).nodes).find((n) => n.relativePath === rel);
  if (!found) throw new Error(`no node ${rel}`);
  return found;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenti-'));
  write('.agents/rules/style.md', 'style');
  write('.agents/rules/tests.md', 'tests');
  write('.agents/skills/one/SKILL.md', 'one');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('getInventory', () => {
  test('everything is missing before the IDE folder exists', () => {
    const inventory = getInventory(root, ide);
    expect(inventory.mode).toBe('granular');
    expect(inventory.counts.missing).toBe(3);
    expect(node('rules').status).toBe('missing');
  });

  test('classifies synced copies, mismatches, orphans and a partly linked folder', () => {
    write('.claude/rules/style.md', 'style');
    write('.claude/rules/tests.md', 'changed');
    write('.claude/settings.local.json', '{}');

    expect(node('rules/style.md').status).toBe('synced');
    expect(node('rules/tests.md').status).toBe('mismatch');
    expect(node('rules').status).toBe('mismatch');
    expect(node('settings.local.json').status).toBe('orphan');
    expect(node('skills').status).toBe('missing');
  });

  test('an empty source folder is synced only when the IDE has it too', () => {
    mkdirSync(join(root, '.agents/workflows'));
    expect(node('workflows').status).toBe('missing');
    mkdirSync(join(root, '.claude/workflows'), { recursive: true });
    expect(node('workflows').status).toBe('synced');
  });

  test('ignores hidden entries on both sides', () => {
    write('.agents/.DS_Store', 'x');
    write('.claude/.gitkeep', '');
    expect(flattenNodes(getInventory(root, ide).nodes).map((n) => n.name)).not.toContain(
      '.gitkeep',
    );
    expect(flattenNodes(getInventory(root, ide).nodes).map((n) => n.name)).not.toContain(
      '.DS_Store',
    );
  });
});

describe('toggleLink', () => {
  test('links a missing folder as one relative link', () => {
    const inventory = getInventory(root, ide);
    expect(toggleLink(inventory, node('skills'), true).ok).toBe(true);
    expect(readlinkSync(join(root, '.claude/skills'))).toBe('../.agents/skills');
    expect(node('skills/one/SKILL.md').status).toBe('synced');
  });

  test('links into an existing folder entry by entry, keeping what the IDE has of its own', () => {
    write('.claude/rules/mine.md', 'mine');
    const result = toggleLink(getInventory(root, ide), node('rules'), true);
    expect(result.ok).toBe(true);
    expect(isLink('.claude/rules/style.md')).toBe(true);
    expect(readFileSync(join(root, '.claude/rules/mine.md'), 'utf-8')).toBe('mine');
  });

  test('refuses to overwrite a file that differs, and says which', () => {
    write('.claude/rules/tests.md', 'changed');
    const result = toggleLink(getInventory(root, ide), node('rules'), true);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('rules/tests.md');
    expect(readFileSync(join(root, '.claude/rules/tests.md'), 'utf-8')).toBe('changed');
    expect(isLink('.claude/rules/style.md')).toBe(true);
  });

  test('turning one file off under a linked folder keeps its siblings linked', () => {
    toggleLink(getInventory(root, ide), node('rules'), true);
    expect(isLink('.claude/rules')).toBe(true);

    expect(toggleLink(getInventory(root, ide), node('rules/tests.md'), false).ok).toBe(true);
    expect(isLink('.claude/rules')).toBe(false);
    expect(isLink('.claude/rules/style.md')).toBe(true);
    expect(existsSync(join(root, '.claude/rules/tests.md'))).toBe(false);
    expect(node('rules').status).toBe('implicit');
  });

  test('turning a folder off removes only links and identical copies', () => {
    write('.claude/rules/style.md', 'style');
    write('.claude/rules/tests.md', 'changed');
    const result = toggleLink(getInventory(root, ide), node('rules'), false);
    expect(result.ok).toBe(false);
    expect(existsSync(join(root, '.claude/rules/style.md'))).toBe(false);
    expect(readFileSync(join(root, '.claude/rules/tests.md'), 'utf-8')).toBe('changed');
  });

  test('refuses in directory mode and on an orphan', () => {
    write('.claude/extra.md', 'x');
    expect(toggleLink(getInventory(root, ide), node('extra.md'), true).ok).toBe(false);
    rmSync(join(root, '.claude'), { recursive: true });
    setLinkMode(getInventory(root, ide), 'directory');
    expect(toggleLink(getInventory(root, ide), node('rules'), false).ok).toBe(false);
  });
});

describe('syncNode', () => {
  test('push overwrites the IDE copy, pull adopts it', () => {
    write('.claude/rules/tests.md', 'changed');
    expect(syncNode(getInventory(root, ide), node('rules/tests.md'), 'pull').ok).toBe(true);
    expect(readFileSync(join(root, '.agents/rules/tests.md'), 'utf-8')).toBe('changed');

    write('.claude/rules/tests.md', 'again');
    expect(syncNode(getInventory(root, ide), node('rules/tests.md'), 'push').ok).toBe(true);
    expect(readFileSync(join(root, '.claude/rules/tests.md'), 'utf-8')).toBe('changed');
  });

  test('pull on an orphan folder brings the whole thing into .agents', () => {
    write('.claude/commands/deploy.md', 'deploy');
    expect(syncNode(getInventory(root, ide), node('commands'), 'pull').ok).toBe(true);
    expect(readFileSync(join(root, '.agents/commands/deploy.md'), 'utf-8')).toBe('deploy');
    expect(node('commands').status).toBe('synced');
  });

  test('never writes through a stray link at the destination', () => {
    const elsewhere = join(root, 'elsewhere.md');
    writeFileSync(elsewhere, 'do not touch');
    mkdirSync(join(root, '.claude/rules'), { recursive: true });
    write('.claude/rules/tests.md', 'changed');
    rmSync(join(root, '.agents/rules/tests.md'));
    symlinkSync(elsewhere, join(root, '.agents/rules/tests.md'));
    syncNode(getInventory(root, ide), node('rules/tests.md'), 'pull');
    expect(readFileSync(elsewhere, 'utf-8')).toBe('do not touch');
  });
});

describe('setLinkMode', () => {
  test('directory mode is refused while the IDE folder has content of its own', () => {
    write('.claude/settings.local.json', '{}');
    const result = setLinkMode(getInventory(root, ide), 'directory');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('settings.local.json');
    expect(existsSync(join(root, '.claude/settings.local.json'))).toBe(true);
  });

  test('round-trips, and granular keeps every entry linked', () => {
    toggleLink(getInventory(root, ide), node('rules'), true);
    expect(setLinkMode(getInventory(root, ide), 'directory').ok).toBe(true);
    expect(readlinkSync(join(root, '.claude'))).toBe('.agents');
    expect(getInventory(root, ide).mode).toBe('directory');
    expect(getInventory(root, ide).counts.synced).toBe(3);

    expect(setLinkMode(getInventory(root, ide), 'granular').ok).toBe(true);
    expect(isLink('.claude')).toBe(false);
    expect(isLink('.claude/rules')).toBe(true);
    expect(isLink('.claude/skills')).toBe(true);
    expect(getInventory(root, ide).counts.synced).toBe(3);
  });
});

describe('deleteNode and getNodeDiff', () => {
  test('deleting a linked source removes the link that would dangle', () => {
    toggleLink(getInventory(root, ide), node('rules/style.md'), true);
    expect(deleteNode(node('rules/style.md')).ok).toBe(true);
    expect(existsSync(join(root, '.agents/rules/style.md'))).toBe(false);
    expect(existsSync(join(root, '.claude/rules/style.md'))).toBe(false);
  });

  test('diffs a mismatch', async () => {
    write('.claude/rules/tests.md', 'changed');
    const diff = await getNodeDiff(node('rules/tests.md'));
    expect(diff).toContain('-tests');
    expect(diff).toContain('+changed');
  });
});
