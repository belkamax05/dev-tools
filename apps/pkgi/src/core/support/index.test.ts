import { describe, expect, test } from 'bun:test';

import { toReleaseLines } from '../registry';
import { assessMaintenance, isUnsupported, needsReleaseLines, supportLabel } from './index';

const NOW = Date.parse('2026-10-01T00:00:00Z');

describe('toReleaseLines', () => {
  test('the last stable release per major, prereleases and bookkeeping keys left out', () => {
    expect(
      toReleaseLines({
        created: '2019-01-01T00:00:00Z',
        modified: '2026-09-01T00:00:00Z',
        '1.0.0': '2019-01-01T00:00:00Z',
        '1.2.0': '2020-05-01T00:00:00Z',
        '2.0.0-beta.1': '2020-06-01T00:00:00Z',
        '2.0.0': '2021-01-01T00:00:00Z',
      }),
    ).toEqual({ 1: '2020-05-01T00:00:00Z', 2: '2021-01-01T00:00:00Z' });
  });
});

describe('assessMaintenance', () => {
  test('stale when nothing was released for two years', () => {
    const verdict = assessMaintenance({
      name: 'left-pad',
      current: '1.3.0',
      latest: '1.3.0',
      lastPublished: '2023-04-01T00:00:00Z',
      now: NOW,
    });
    expect(verdict?.status).toBe('stale');
    expect(verdict?.basis).toBe('registry');
    expect(verdict?.summary).toBe('no release since 2023-04');
  });

  test('stale when the line in use is a year quiet and two majors behind', () => {
    expect(
      assessMaintenance({
        name: 'x',
        current: '3.4.0',
        latest: '5.0.0',
        lastPublished: '2026-09-01T00:00:00Z',
        lines: { 3: '2025-02-01T00:00:00Z', 5: '2026-09-01T00:00:00Z' },
        now: NOW,
      })?.summary,
    ).toBe('3.x last released 2025-02, 2 majors behind');
  });

  test('no verdict for an active package, one major behind, or an old line still patched', () => {
    const base = { name: 'x', lastPublished: '2026-09-01T00:00:00Z', now: NOW };
    expect(assessMaintenance({ ...base, current: '4.0.0', latest: '5.0.0' })).toBeUndefined();
    expect(
      assessMaintenance({
        ...base,
        current: '3.0.0',
        latest: '5.0.0',
        lines: { 3: '2026-06-01T00:00:00Z' },
      }),
    ).toBeUndefined();
  });

  test('needsReleaseLines only two majors or more behind', () => {
    expect(needsReleaseLines('3.0.0', '5.0.0')).toBe(true);
    expect(needsReleaseLines('4.0.0', '5.0.0')).toBe(false);
    expect(needsReleaseLines('4.0.0', undefined)).toBe(false);
  });
});

describe('supportLabel / isUnsupported', () => {
  const info = {
    product: 'react',
    basis: 'endoflife' as const,
    summary: '',
    lts: false,
    source: '',
  };
  test('short labels for a row, and which ones need attention', () => {
    expect(supportLabel({ ...info, status: 'eol' })).toBe('EOL');
    expect(supportLabel({ ...info, status: 'ending', until: '2026-10-21' })).toBe('EOL 2026-10-21');
    expect(supportLabel({ ...info, status: 'supported', until: '2027-04-30' })).toBe('→ 2027-04');
    expect(supportLabel({ ...info, status: 'stale' })).toBe('stale');
    expect(isUnsupported({ ...info, status: 'supported' })).toBe(false);
    expect(isUnsupported({ ...info, status: 'stale' })).toBe(true);
  });
});

test('package inactivity uses real publishes, ignoring metadata and including prereleases', async () => {
  const { toReleaseActivity } = await import('../registry');
  const activity = toReleaseActivity({
    created: '2010-01-01',
    modified: '2026-10-01',
    '1.0.0': '2020-01-01',
    '2.0.0-beta.1': '2026-09-01',
    invalid: '2026-10-01',
    '3.0.0': 'invalid',
  });
  expect(activity).toEqual({ lastPublished: '2026-09-01', lines: { 1: '2020-01-01' } });
  const old = toReleaseActivity({ '1.0.0': '2020-01-01', modified: '2026-10-01' });
  expect(
    assessMaintenance({ name: 'x', current: '1.0.0', lastPublished: old.lastPublished, now: NOW })
      ?.status,
  ).toBe('stale');
});

test('stale boundaries are strict and missing publish data is not stale', () => {
  const base = { name: 'x', current: '1.0.0', latest: '3.0.0', now: NOW };
  const daysAgo = (days: number) => new Date(NOW - days * 86400000).toISOString();
  expect(assessMaintenance({ ...base, lastPublished: daysAgo(730) })).toBeUndefined();
  expect(assessMaintenance({ ...base, lastPublished: daysAgo(731) })?.status).toBe('stale');
  expect(assessMaintenance({ ...base, lines: { 1: daysAgo(365) } })).toBeUndefined();
  expect(assessMaintenance({ ...base, lines: { 1: daysAgo(366) } })?.status).toBe('stale');
  expect(assessMaintenance(base)).toBeUndefined();
});
