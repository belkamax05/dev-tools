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

import { getIde, type IdeDefinition } from '../ides';
import { projectScope } from '../scope';
import {
  type AgentNode,
  deleteNode,
  flattenNodes,
  getInventory,
  getNodeDiff,
  setLinkMode,
  syncInventory,
  syncNode,
  toggleLink,
} from '.';

const claude = getIde('claude-code') as IdeDefinition;
const cursor = getIde('cursor') as IdeDefinition;
const devin = getIde('devin') as IdeDefinition;
let root: string;

const write = (rel: string, content: string) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf-8');
const isLink = (rel: string) => lstatSync(join(root, rel)).isSymbolicLink();
const inventory = (ide: IdeDefinition = claude) => getInventory(projectScope(root), ide);
const node = (rel: string, ide: IdeDefinition = claude): AgentNode => {
  const found = flattenNodes(inventory(ide).nodes).find((n) => n.relativePath === rel);
  if (!found) throw new Error(`no node ${rel}`);
  return found;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenti-'));
  write('.agents/rules/style.md', 'style');
  write('.agents/rules/tests.md', '---\nglobs: ["**/*.test.ts"]\n---\ntests');
  write('.agents/skills/one/SKILL.md', 'one');
  write('.agents/knowledge/notes.md', 'notes');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('getInventory', () => {
  test('follows the IDE layout, and marks what it has no place for as unused', () => {
    expect(inventory().counts.missing).toBe(3);
    expect(node('rules').targetPath).toBe(join(root, '.claude/rules'));
    expect(node('knowledge').status).toBe('unused');
    //? Cursor reads no skills
    expect(node('skills', cursor).status).toBe('unused');
  });

  test('classifies synced copies, mismatches and orphans inside a mapped folder', () => {
    write('.claude/rules/style.md', 'style');
    write('.claude/rules/tests.md', 'changed');
    write('.claude/rules/mine.md', 'mine');
    //? The IDE's own settings are not agent content, and not an orphan
    write('.claude/settings.local.json', '{}');

    expect(node('rules/style.md').status).toBe('synced');
    expect(node('rules/tests.md').status).toBe('mismatch');
    expect(node('rules/mine.md').status).toBe('orphan');
    expect(flattenNodes(inventory().nodes).some((n) => n.name === 'settings.local.json')).toBe(
      false,
    );
  });

  test('two sources sharing a target do not report each other as orphans', () => {
    write('.agents/workflows/deploy.md', 'deploy');
    write('.agents/commands/review.md', 'review');
    toggleLink(inventory(), node('workflows'), true);
    toggleLink(inventory(), node('commands'), true);
    expect(node('workflows').status).toBe('synced');
    expect(node('commands').status).toBe('synced');
    expect(flattenNodes(inventory().nodes).filter((n) => n.status === 'orphan')).toEqual([]);
  });

  test('a target with content and no source behind it is one orphan to adopt', () => {
    write('.claude/commands/deploy.md', 'deploy');
    expect(node('commands').status).toBe('orphan');
    expect(syncNode(inventory(), node('commands'), 'pull').ok).toBe(true);
    expect(read('.agents/commands/deploy.md')).toBe('deploy');
  });
});

describe('toggleLink', () => {
  test('links a missing folder as one relative link', () => {
    expect(toggleLink(inventory(), node('skills'), true).ok).toBe(true);
    expect(readlinkSync(join(root, '.claude/skills'))).toBe('../.agents/skills');
    expect(node('skills/one/SKILL.md').status).toBe('synced');
  });

  test('links into an existing folder entry by entry, keeping what the IDE has of its own', () => {
    write('.claude/rules/mine.md', 'mine');
    expect(toggleLink(inventory(), node('rules'), true).ok).toBe(true);
    expect(isLink('.claude/rules/style.md')).toBe(true);
    expect(read('.claude/rules/mine.md')).toBe('mine');
  });

  test('refuses to overwrite a file that differs, and says which', () => {
    write('.claude/rules/tests.md', 'changed');
    const result = toggleLink(inventory(), node('rules'), true);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('tests.md');
    expect(read('.claude/rules/tests.md')).toBe('changed');
  });

  test('turning one entry off under a linked folder keeps its siblings linked', () => {
    toggleLink(inventory(), node('rules'), true);
    expect(isLink('.claude/rules')).toBe(true);
    expect(toggleLink(inventory(), node('rules/tests.md'), false).ok).toBe(true);
    expect(isLink('.claude/rules')).toBe(false);
    expect(isLink('.claude/rules/style.md')).toBe(true);
    expect(node('rules').status).toBe('implicit');
  });

  test('refuses on an orphan and on an unused entry', () => {
    write('.claude/rules/mine.md', 'mine');
    expect(toggleLink(inventory(), node('rules/mine.md'), true).ok).toBe(false);
    expect(toggleLink(inventory(), node('knowledge'), true).ok).toBe(false);
  });
});

describe('converted formats', () => {
  test('Cursor gets generated .mdc files with its own front matter', () => {
    expect(toggleLink(inventory(cursor), node('rules', cursor), true).ok).toBe(true);
    const mdc = read('.cursor/rules/tests.mdc');
    expect(mdc).toContain('globs: **/*.test.ts');
    expect(mdc).toContain('alwaysApply: false');
    expect(mdc).toContain('generated by agenti from .agents/rules/tests.md');
    expect(read('.cursor/rules/style.mdc')).toContain('alwaysApply: true');
    expect(node('rules', cursor).status).toBe('synced');
  });

  test('a stale generated copy is a mismatch that sync regenerates; a hand-written one is left', () => {
    toggleLink(inventory(cursor), node('rules', cursor), true);
    write('.agents/rules/style.md', 'style, revised');
    expect(node('rules/style.md', cursor).status).toBe('mismatch');
    write('.cursor/rules/hand.mdc', 'mine');
    const { changed } = syncInventory(inventory(cursor));
    expect(changed).toContain('rules/style.md');
    expect(read('.cursor/rules/style.mdc')).toContain('style, revised');
    expect(read('.cursor/rules/hand.mdc')).toBe('mine');
  });

  test('adopting an IDE-only .mdc brings it back as canonical Markdown', () => {
    write(
      '.cursor/rules/lint.mdc',
      '---\ndescription: Lint\nglobs: src/**,lib/**\nalwaysApply: false\n---\nRun lint.',
    );
    expect(node('rules/lint.md', cursor).status).toBe('orphan');
    expect(syncNode(inventory(cursor), node('rules/lint.md', cursor), 'pull').ok).toBe(true);
    const md = read('.agents/rules/lint.md');
    expect(md).toContain('globs: ["src/**","lib/**"]');
    expect(md).toContain('Run lint.');
  });

  test('diffs a converted file against what it should render to', async () => {
    toggleLink(inventory(cursor), node('rules', cursor), true);
    write('.cursor/rules/style.mdc', 'hand edit');
    expect(await getNodeDiff(node('rules/style.md', cursor))).toContain('+hand edit');
  });
});

describe('syncNode and deleteNode', () => {
  test('push overwrites the IDE copy, pull adopts it', () => {
    write('.claude/rules/tests.md', 'changed');
    expect(syncNode(inventory(), node('rules/tests.md'), 'pull').ok).toBe(true);
    expect(read('.agents/rules/tests.md')).toBe('changed');
    write('.claude/rules/tests.md', 'again');
    expect(syncNode(inventory(), node('rules/tests.md'), 'push').ok).toBe(true);
    expect(read('.claude/rules/tests.md')).toBe('changed');
  });

  test('never writes through a stray link at the destination', () => {
    const elsewhere = join(root, 'elsewhere.md');
    writeFileSync(elsewhere, 'do not touch');
    write('.claude/rules/tests.md', 'changed');
    rmSync(join(root, '.agents/rules/tests.md'));
    symlinkSync(elsewhere, join(root, '.agents/rules/tests.md'));
    syncNode(inventory(), node('rules/tests.md'), 'pull');
    expect(readFileSync(elsewhere, 'utf-8')).toBe('do not touch');
  });

  test('deleting a linked source removes the link that would dangle', () => {
    toggleLink(inventory(), node('rules/style.md'), true);
    expect(deleteNode(node('rules/style.md')).ok).toBe(true);
    expect(existsSync(join(root, '.claude/rules/style.md'))).toBe(false);
  });
});

describe('setLinkMode', () => {
  test('is refused for a mapped layout', () => {
    expect(setLinkMode(inventory(), 'directory').ok).toBe(false);
  });

  test('round-trips for a mirror layout, refusing while the folder has its own content', () => {
    write('.devin/own.md', 'own');
    expect(setLinkMode(inventory(devin), 'directory').ok).toBe(false);
    rmSync(join(root, '.devin'), { recursive: true });
    expect(setLinkMode(inventory(devin), 'directory').ok).toBe(true);
    expect(readlinkSync(join(root, '.devin'))).toBe('.agents');
    expect(setLinkMode(inventory(devin), 'granular').ok).toBe(true);
    expect(isLink('.devin/rules')).toBe(true);
  });
});

describe('syncInventory', () => {
  test('puts in what is missing and leaves differing and IDE-only files to a person', () => {
    write('.claude/rules/tests.md', 'changed');
    write('.claude/rules/mine.md', 'mine');
    const { changed, left } = syncInventory(inventory());
    expect(changed).toEqual(expect.arrayContaining(['rules/style.md', 'skills']));
    expect(left).toEqual(expect.arrayContaining(['rules/tests.md', 'rules/mine.md']));
    expect(read('.claude/rules/tests.md')).toBe('changed');
  });
});

describe('several IDEs at once', () => {
  test('merges inventories and combines statuses, ignoring IDEs that do not read an entry', async () => {
    const { mergeInventories, flattenMerged } = await import('.');
    toggleLink(inventory(), node('rules/style.md'), true);
    const merged = flattenMerged(mergeInventories([inventory(), inventory(cursor)]));
    const style = merged.find((n) => n.relativePath === 'rules/style.md');
    expect(style?.perIde['claude-code']?.status).toBe('synced');
    expect(style?.perIde.cursor?.status).toBe('missing');
    expect(style?.status).toBe('implicit');
    //? Only Claude Code reads skills, so its status alone decides
    expect(merged.find((n) => n.relativePath === 'skills')?.status).toBe('missing');
    expect(merged.find((n) => n.relativePath === 'knowledge')?.status).toBe('unused');
  });

  test('links and unlinks in every IDE, each in its own way', async () => {
    const { mergeInventories, flattenMerged, toggleEverywhere } = await import('.');
    const both = () => [inventory(), inventory(cursor)];
    const rules = () =>
      flattenMerged(mergeInventories(both())).find((n) => n.relativePath === 'rules');
    const results = toggleEverywhere(both(), rules()!, true);
    expect(results.map((r) => [r.ide.id, r.result.ok])).toEqual([
      ['claude-code', true],
      ['cursor', true],
    ]);
    expect(isLink('.claude/rules')).toBe(true);
    expect(read('.cursor/rules/style.mdc')).toContain('style');
    expect(rules()?.status).toBe('synced');

    toggleEverywhere(both(), rules()!, false);
    expect(existsSync(join(root, '.claude/rules'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/style.mdc'))).toBe(false);
  });

  test('deleting removes the source and every IDE copy of it', async () => {
    const { mergeInventories, flattenMerged, toggleEverywhere, deleteEverywhere } = await import(
      '.'
    );
    const both = () => [inventory(), inventory(cursor)];
    const find = (rel: string) =>
      flattenMerged(mergeInventories(both())).find((n) => n.relativePath === rel);
    toggleEverywhere(both(), find('rules')!, true);
    expect(deleteEverywhere(find('rules/style.md')!).ok).toBe(true);
    expect(existsSync(join(root, '.agents/rules/style.md'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/style.mdc'))).toBe(false);
    //? The folder link still stands, and no longer lists the deleted file
    expect(existsSync(join(root, '.claude/rules/style.md'))).toBe(false);
  });
});
