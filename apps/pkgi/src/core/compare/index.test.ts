import { describe, expect, test } from 'bun:test';

import type { Manifest } from '../manifest';
import { buildComparison, type CompareColumn } from './index';

const column = (label: string, deps: Record<string, string>): CompareColumn => ({
  dir: `/x/${label}`,
  label,
  manifest: {
    dir: `/x/${label}`,
    exists: true,
    dependencies: Object.entries(deps).map(([name, installed]) => ({
      name,
      range: `^${installed}`,
      type: 'dependencies',
      local: false,
      installed,
    })),
  } as Manifest,
});

describe('buildComparison', () => {
  test('one row per package across folders, flagging differences and the newest version', () => {
    const rows = buildComparison([
      column('.', { react: '18.2.0', zod: '4.0.0' }),
      column('../web', { react: '18.3.1', zod: '4.0.0' }),
      column('../api', { zod: '4.0.0', hono: '4.1.0' }),
    ]);
    expect(rows.map((row) => [row.name, row.differs, row.highest])).toEqual([
      ['hono', true, '4.1.0'],
      ['react', true, '18.3.1'],
      ['zod', false, '4.0.0'],
    ]);
  });
});
