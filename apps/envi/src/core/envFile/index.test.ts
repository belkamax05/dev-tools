import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from '../parse';
import { readEnvFile, removeFromEnvFile, setInEnvFile } from './index';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'envi-file-'));
  file = join(dir, '.env');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('env files', () => {
  test('a missing file reads as empty, flagged', async () => {
    expect(await readEnvFile(file)).toMatchObject({ exists: false, entries: [] });
  });

  test('set creates the file, replaces in place and keeps comments', async () => {
    await setInEnvFile(file, 'A', '1');
    writeFileSync(file, `# keep me\n${readFileSync(file, 'utf8')}B=2\n`);
    await setInEnvFile(file, 'A', 'with space');
    await setInEnvFile(file, 'C', '3');
    expect(readFileSync(file, 'utf8')).toBe('# keep me\nA="with space"\nB=2\nC=3\n');
  });

  test('replacing a multi-line value replaces all of its lines', async () => {
    writeFileSync(file, 'K="a\nb\nc"\nNEXT=1\n');
    await setInEnvFile(file, 'K', 'one');
    expect(readFileSync(file, 'utf8')).toBe('K=one\nNEXT=1\n');
  });

  test('remove drops every assignment of the key', async () => {
    writeFileSync(file, 'A=1\nB=2\nexport A=3\n');
    expect(await removeFromEnvFile(file, 'A')).toBe(2);
    expect(parse(readFileSync(file, 'utf8'))).toEqual({ B: '2' });
  });
});
