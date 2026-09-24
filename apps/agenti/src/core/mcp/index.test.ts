import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getIde } from '../ides';
import {
  buildComparisons,
  getDiffFields,
  getRequiredTokens,
  listServerTools,
  readEnvFile,
  readSourceMcp,
  readTargetMcp,
  setEnvValue,
  writeServers,
} from '.';

let root: string;
const write = (rel: string, content: unknown) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenti-mcp-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('reading configs', () => {
  test('prefers .agents/mcp_config.json and falls back to config/', () => {
    write('config/mcp_config.json', { mcpServers: { a: { command: 'a' } } });
    expect(readSourceMcp(root).path).toBe(join(root, 'config/mcp_config.json'));
    write('.agents/mcp_config.json', { mcpServers: { b: { command: 'b' } } });
    expect(Object.keys(readSourceMcp(root).servers)).toEqual(['b']);
  });

  test("uses VS Code's `servers` key", () => {
    write('.vscode/mcp.json', { servers: { a: { command: 'a' } }, inputs: [] });
    const file = readTargetMcp(root, getIde('vscode')!)!;
    expect(Object.keys(file.servers)).toEqual(['a']);
    writeServers(file, { b: { command: 'b' } });
    const written = JSON.parse(readFileSync(file.path, 'utf-8'));
    expect(written).toEqual({ servers: { b: { command: 'b' } }, inputs: [] });
  });

  test('never writes over a file it could not parse', () => {
    write('.mcp.json', '{ not json');
    const file = readTargetMcp(root, getIde('claude-code')!)!;
    expect(file.error).toBeDefined();
    expect(() => writeServers(file, {})).toThrow();
    expect(readFileSync(file.path, 'utf-8')).toBe('{ not json');
  });
});

describe('comparing', () => {
  test('ignores `disabled` and key order, and lists target-only servers last', () => {
    const comparisons = buildComparisons(
      {
        a: { command: 'x', args: ['1'] },
        b: { command: 'y' },
        c: { command: 'z' },
      },
      {
        d: { command: 'w' },
        b: { command: 'changed' },
        a: { args: ['1'], command: 'x', disabled: true },
      },
    );
    expect(comparisons.map((c) => [c.name, c.status])).toEqual([
      ['a', 'synced'],
      ['b', 'diff'],
      ['c', 'missing-in-target'],
      ['d', 'target-only'],
    ]);
    expect(getDiffFields({ command: 'y' }, { command: 'changed' })).toEqual([
      { field: 'command', source: '"y"', target: '"changed"' },
    ]);
  });
});

describe('env tokens', () => {
  test('collects placeholders and declared tokens per server', () => {
    write('.agents/mcp_config.json', {
      requiredEnv: { jira: ['JIRA_TOKEN'] },
      mcpServers: {
        jira: { command: 'dfs', args: ['mcp', 'jira'] },
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} placeholder is what is under test
        gh: { command: 'gh-mcp', env: { TOKEN: '${GH_TOKEN}' } },
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} placeholder is what is under test
        web: { url: 'https://x/${GH_TOKEN}' },
      },
    });
    expect(getRequiredTokens(readSourceMcp(root))).toEqual([
      { key: 'GH_TOKEN', servers: ['gh', 'web'] },
      { key: 'JIRA_TOKEN', servers: ['jira'] },
    ]);
  });

  test('sets a key in place and appends a new one, leaving other lines alone', () => {
    write('.env.user', '# secrets\nA=1\nexport B="two"\n');
    setEnvValue(root, 'B', 'three');
    setEnvValue(root, 'C', 'four');
    expect(readFileSync(join(root, '.env.user'), 'utf-8')).toBe(
      '# secrets\nA=1\nB=three\nC=four\n',
    );
    expect(readEnvFile(root)).toEqual({ A: '1', B: 'three', C: 'four' });
  });
});

describe('listServerTools', () => {
  test('starts a stdio server with placeholders expanded and lists its tools', async () => {
    write('.env.user', 'ECHO_TOKEN=secret\n');
    const result = await listServerTools(
      {
        command: 'bun',
        args: [join(import.meta.dir, 'fixtures', 'echoServer.ts')],
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} placeholder is what is under test
        env: { ECHO_TOKEN: '${ECHO_TOKEN}' },
      },
      root,
    );
    expect(result.error).toBeUndefined();
    expect(result.tools).toEqual([
      { name: 'echo', description: 'token=secret' },
      { name: 'ping', description: 'pong' },
    ]);
  });

  test('reports a server that cannot start instead of throwing', async () => {
    const result = await listServerTools({ command: 'definitely-not-a-command-xyz' }, root, 3000);
    expect(result.tools).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
