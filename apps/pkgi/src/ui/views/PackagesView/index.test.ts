import { expect, test } from 'bun:test';

import type { SupportInfo } from '../../../core/eol';
import { registryUpdateAge, supportGroup } from './index';

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
  expect(registryUpdateAge('2026-10-01', now)).toBe('2026-10-01 · 8 days ago (registry)');
  expect(registryUpdateAge(undefined, now)).toBe('Registry update date unavailable');
  expect(registryUpdateAge('invalid', now)).toBe('Registry update date unavailable');
  expect(registryUpdateAge('2026-10-10', now)).toContain('today');
});
