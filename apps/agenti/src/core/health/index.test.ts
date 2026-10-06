import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getIde, type IdeDefinition } from '../ides';
import { projectScope } from '../scope';
import { getHealth } from '.';

const claude = getIde('claude-code') as IdeDefinition;
let root: string;
const write = (rel: string, content: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const ids = () => getHealth(projectScope(root), [claude]).map((issue) => issue.id);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenti-health-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('health', () => {
  test('flags an unignored secrets file, and the fix ignores it', async () => {
    write('.env.user', 'TOKEN=x');
    const issue = getHealth(projectScope(root), [claude]).find(
      (i) => i.id === 'git-ignore:.env.user',
    );
    expect(issue?.severity).toBe('warn');
    await issue?.fix?.();
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toContain('.env.user');
    expect(ids()).not.toContain('git-ignore:.env.user');
  });

  test('flags secrets written into a shared MCP file, not placeholders', () => {
    write(
      '.mcp.json',
      JSON.stringify({
        mcpServers: {
          a: { command: 'x', env: { API_TOKEN: 'abc' } },
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${NAME} placeholder is what is under test
          b: { command: 'y', env: { API_TOKEN: '${TOKEN}' } },
        },
      }),
    );
    const issue = getHealth(projectScope(root), [claude]).find((i) => i.id.startsWith('secret:'));
    expect(issue?.detail).toContain('a: env API_TOKEN');
    expect(issue?.detail).not.toContain('b:');
  });

  test('validates skills and finds duplicates', () => {
    write('.agents/skills/good/SKILL.md', '---\nname: good\ndescription: Does things\n---\n');
    write('.agents/skills/bare/SKILL.md', 'no front matter');
    write('.agents/skills/copy/SKILL.md', '---\nname: good\ndescription: Same name\n---\n');
    write('.agents/skills/empty/.keep', '');
    expect(ids()).toEqual(
      expect.arrayContaining([
        'skill-description:bare',
        'skill-name:bare',
        'skill-name-folder:copy',
        'skill-duplicate:good',
        'skill-doc:empty',
      ]),
    );
  });

  test('finds broken relative links, and ignores URLs and anchors', () => {
    write(
      '.agents/rules/a.md',
      '[ok](b.md) [web](https://x.dev) [anchor](#top) [gone](missing.md)',
    );
    write('.agents/rules/b.md', 'b');
    const issue = getHealth(projectScope(root), [claude]).find(
      (i) => i.id === 'links:.agents/rules/a.md',
    );
    expect(issue?.detail).toBe('missing.md');
  });

  test('warns when rules outgrow the token budget', () => {
    write('.agents/rules/huge.md', 'x'.repeat(40_000));
    expect(ids()).toContain('tokens');
  });

  test('finds a link left from an older layout, and removes it', async () => {
    write('.agents/workflows/deploy.md', 'deploy');
    mkdirSync(join(root, '.claude'));
    symlinkSync('../.agents/workflows', join(root, '.claude/workflows'));
    const issue = getHealth(projectScope(root), [claude]).find(
      (i) => i.id === 'stale:.claude/workflows',
    );
    expect(issue).toBeDefined();
    await issue?.fix?.();
    expect(ids()).not.toContain('stale:.claude/workflows');
  });

  test('lists project MCP servers still waiting for approval, and approves them locally', async () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { tracker: { command: 'x' } } }));
    const issue = getHealth(projectScope(root), [claude]).find((i) => i.id === 'approval:tracker');
    expect(issue).toBeDefined();
    await issue?.fix?.();
    const local = JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf-8'));
    expect(local.enabledMcpjsonServers).toEqual(['tracker']);
    expect(ids()).not.toContain('approval:tracker');
  });
});
