import { expect, test } from 'bun:test';

import type { SupportInfo } from '../../../core/eol';
import {
  packageColor,
  packageIconsSupported,
  updateIndicator,
  updateIndicatorColor,
  registryUpdateAge,
  releaseMetrics,
  supportColor,
  supportGroup,
} from './index';

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

test('list and detail share support colors independently of grouping mode', () => {
  const colors = { error: 'red', warn: 'yellow', ok: 'green', muted: 'gray' };
  const expectations = {
    eol: 'red',
    ending: 'yellow',
    stale: 'yellow',
    supported: 'green',
    unknown: 'gray',
  } as const;
  for (const [status, expected] of Object.entries(expectations)) {
    const verdict = support(status as SupportInfo['status']);
    expect(supportColor(verdict, colors)).toBe(expected);
    expect(packageColor({ deprecated: undefined }, verdict, colors)).toBe(expected);
  }
  expect(packageColor({ deprecated: 'deprecated' }, support('supported'), colors)).toBe('red');
  expect(packageColor({ deprecated: undefined }, undefined, colors)).toBe('gray');
});

test('update markers distinguish an update, latest, prerelease and unknown independently of stale', () => {
  const info = { name: 'x', distTags: {}, versions: [], deprecated: {}, fetchedAt: 1 };
  const row = { local: false, update: 'none' as const, latest: '1.0.0', info };
  expect(updateIndicator(row, true)).toBe('=');
  for (const update of ['major', 'minor', 'patch'] as const) {
    expect(updateIndicator({ ...row, update }, true)).toBe('↑');
    expect(updateIndicator({ ...row, update }, false)).toBe('U');
  }
  expect(updateIndicator({ ...row, prerelease: '2.0.0-beta.1' }, true)).toBe('⇡');
  expect(updateIndicator({ ...row, prerelease: '2.0.0-beta.1' }, false)).toBe('P');
  expect(updateIndicator({ ...row, info: undefined }, true)).toBe('?');
  expect(updateIndicator({ ...row, info: { ...info, error: 'network' } }, true)).toBe('?');
  expect(updateIndicator({ ...row, latest: undefined }, true)).toBe('?');
  expect(updateIndicator({ ...row, local: true }, false)).toBe('-');
});

test('glyphs fall back to ASCII for dumb and legacy Windows terminals', () => {
  expect(packageIconsSupported({ TERM: 'dumb' }, 'linux')).toBe(false);
  expect(packageIconsSupported({ TERM: 'xterm-256color' }, 'linux')).toBe(true);
  expect(packageIconsSupported({}, 'win32')).toBe(false);
  expect(packageIconsSupported({ WT_SESSION: 'session' }, 'win32')).toBe(true);
});

test('only the update marker uses update severity; latest and unknown are gray', () => {
  const colors = { error: 'red', warn: 'orange', ok: 'green', muted: 'gray', highlight: 'purple' };
  const base = { local: false, latest: '2.0.0', update: 'none' as const };
  expect(updateIndicatorColor({ ...base, update: 'patch' }, colors)).toBe('green');
  expect(updateIndicatorColor({ ...base, update: 'minor' }, colors)).toBe('orange');
  expect(updateIndicatorColor({ ...base, update: 'major' }, colors)).toBe('red');
  expect(updateIndicatorColor(base, colors)).toBe('gray');
  expect(updateIndicatorColor({ ...base, latest: undefined }, colors)).toBe('gray');
  expect(updateIndicatorColor({ ...base, local: true }, colors)).toBe('gray');
});
