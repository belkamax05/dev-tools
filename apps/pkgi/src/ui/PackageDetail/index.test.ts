import { describe, expect, test } from 'bun:test';

import type { SupportInfo } from '../../core/eol';
import type { PackageRow } from '../../core/packages';
import { candidateRow, versionCells, versionHeader, versionLines } from './index';

const support = (status: SupportInfo['status']): SupportInfo => ({
  status,
  product: 'npm',
  basis: 'registry',
  summary: '',
  lts: false,
  source: '',
});

test('version table columns align for different versions, ages and unavailable data', () => {
  const now = Date.parse('2026-10-09');
  const header = versionHeader(12);
  const rows = [
    versionCells('5.0.0', '2026-10-01', 12, now),
    versionCells('3.123.4', '2020-01-01', 12, now),
    versionCells('?', undefined, 12, now),
    versionCells('1.0.0-beta.123456789', '2026-10-09', 12, now),
  ];
  for (const row of [header, ...rows]) {
    expect(row).toHaveLength(header.length);
    expect(row.slice(12, 14)).toBe('  ');
    expect(row.slice(24, 26)).toBe('  ');
  }
  expect(rows[0]?.slice(14, 24)).toBe('2026-10-01');
  expect(rows[0]?.slice(26, 32)).toBe('    8d');
  expect(rows[2]?.slice(14, 24)).toBe('?         ');
  expect(rows[3]?.slice(0, 12)).toBe('1.0.0-beta.…');
});

describe('versionLines', () => {
  const now = Date.parse('2026-10-09');
  const info = { name: 'x', distTags: {}, versions: [], deprecated: {}, fetchedAt: 1 };
  const row: PackageRow = {
    name: 'x',
    range: '^5.2.0',
    type: 'dependencies',
    installed: '5.2.3',
    current: '5.2.3',
    info,
    latest: '7.1.0',
    update: 'major',
    mismatch: false,
    local: false,
  };
  const verdict = (maintenance: SupportInfo['maintenance']): SupportInfo => ({
    ...support('unknown'),
    maintenance,
  });

  test('each version is listed once, installed first and in its own row', () => {
    const lines = versionLines(
      row,
      verdict({
        installedPublished: '2026-01-01',
        lineVersion: '5.4.1',
        linePublished: '2026-09-01',
        latestPublished: '2026-10-01',
        highestVersion: '7.2.0-beta.1',
        highestPublished: '2026-10-05',
        major: 5,
        majorGap: 2,
      }),
      now,
    );
    expect(lines.map((line) => [line.label, line.version, line.status])).toEqual([
      ['Installed', '5.2.3', 'ok · stale after 365d'],
      ['Latest on 5', '5.4.1', 'minor update'],
      ['Latest', '7.1.0', 'major update · 2 majors behind'],
      ['Highest', '7.2.0-beta.1', 'prerelease'],
    ]);
  });

  test('rows that would repeat a version already shown are left out', () => {
    const lines = versionLines(
      { ...row, prerelease: '7.2.0-beta.1', prereleaseTag: 'next' },
      verdict({ lineVersion: '5.2.3', highestVersion: '7.2.0-beta.1', major: 5 }),
      now,
    );
    expect(lines.map((line) => line.label)).toEqual(['Installed', 'Latest', 'Prerelease']);
  });

  test('an old installed release and a missing install are flagged', () => {
    expect(
      versionLines(row, verdict({ installedPublished: '2025-01-01' }), now)[0]?.tone,
    ).toBe('warn');
    expect(versionLines({ ...row, installed: undefined }, undefined, now)[0]).toMatchObject({
      version: '—',
      tone: 'warn',
    });
  });

  test('a local package shows only what is installed', () => {
    expect(versionLines({ ...row, local: true }, undefined, now)).toHaveLength(1);
  });
});

describe('candidateRow', () => {
  const info = {
    name: 'x',
    latest: '5.59.0',
    next: '5.60.0-beta.1',
    nextTag: 'next',
    distTags: {},
    versions: [],
    deprecated: {},
    fetchedAt: 1,
  };

  test('a package not added yet is judged at latest and lists no installed row', () => {
    const row = candidateRow('x', info, true);
    expect(row).toMatchObject({ current: '5.59.0', latest: '5.59.0', update: 'none' });
    expect(row.installed).toBeUndefined();
    const lines = versionLines(row, undefined, Date.parse('2026-10-09'), true);
    expect(lines.map((line) => [line.label, line.status])).toEqual([
      ['Latest', 'latest · what [i] adds'],
      ['Prerelease', 'tagged next'],
    ]);
  });

  test('prereleases stay out unless unstable versions are shown', () => {
    expect(candidateRow('x', info, false).prerelease).toBeUndefined();
  });
});
