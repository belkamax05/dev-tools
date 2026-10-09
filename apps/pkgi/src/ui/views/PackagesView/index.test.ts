import { expect, test } from 'bun:test';

import type { SupportInfo } from '../../../core/eol';
import { registryUpdateAge, releaseMetrics, supportGroup } from './index';

const support = (status: SupportInfo['status']): SupportInfo => ({
  status,
  product: 'npm',
  basis: 'registry',
  summary: '',
  lts: false,
  source: '',
});

test('support groups retain every verdict and prioritize deprecation', () => {
  const row = { deprecated: undefined };
  expect(
    ['eol', 'ending', 'stale'].map((status) =>
      supportGroup(row, support(status as SupportInfo['status'])),
    ),
  ).toEqual(['attention', 'attention', 'attention']);
  expect(supportGroup(row, support('supported'))).toBe('supported');
  expect(supportGroup(row, support('unknown'))).toBe('unknown');
  expect(supportGroup(row)).toBe('unknown');
  expect(supportGroup({ deprecated: 'Use another package' }, support('supported'))).toBe(
    'attention',
  );
});

test('registry update age handles missing, invalid and future dates', () => {
  const now = Date.parse('2026-10-09');
  expect(registryUpdateAge('2026-10-01', now)).toBe('2026-10-01 · 8 days ago (npm publish)');
  expect(registryUpdateAge(undefined, now)).toBe('Publish date unavailable');
  expect(registryUpdateAge('invalid', now)).toBe('Publish date unavailable');
  expect(registryUpdateAge('2026-10-10', now)).toContain('today');
});

test('release metric columns align for different versions, ages and unavailable data', () => {
  const now = Date.parse('2026-10-09');
  const rows = [
    releaseMetrics('5.0.0', '2026-10-01', '>730d', 12, now),
    releaseMetrics('3.123.4', '2020-01-01', '>365d', 12, now),
    releaseMetrics(undefined, undefined, 'context', 12, now),
    releaseMetrics('1.0.0-beta.123456789', '2026-10-09', '>365d', 12, now),
  ];
  for (const row of rows) {
    expect(row.slice(12, 14)).toBe('  ');
    expect(row.slice(24, 26)).toBe('  ');
    expect(row.slice(32, 34)).toBe('  ');
  }
  expect(rows[0]?.slice(14, 24)).toBe('2026-10-01');
  expect(rows[0]?.slice(26, 32)).toBe('    8d');
  expect(rows[2]?.slice(14, 24)).toBe('?         ');
  expect(rows[3]?.slice(0, 12)).toBe('1.0.0-beta.…');
});
