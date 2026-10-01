import { describe, expect, test } from 'bun:test';

import type { CompareColumn } from '../compare';
import type { Manifest } from '../manifest';
import type { PackageInfo } from '../registry';
import {
  buildReport,
  entryStatus,
  folderLabels,
  locationCell,
  readPreviousPackages,
  renderMarkdown,
} from './index';

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

const info = (name: string, latest: string, deprecated: Record<string, string> = {}) =>
  ({ name, latest, distTags: {}, versions: [], deprecated, fetchedAt: 0 }) as PackageInfo;

describe('folderLabels', () => {
  test("a folder's name, its path where two share one", () => {
    expect(folderLabels(['../web', '../web/app', '../api/app', '.'])).toEqual([
      'web',
      '../web/app',
      '../api/app',
      '.',
    ]);
  });
});

describe('buildReport', () => {
  const columns = [
    column('web', { react: '18.2.0', left: '1.0.0' }),
    column('api', { react: '19.1.0' }),
  ];

  test('one entry per package with every location, judged on the oldest version in use', () => {
    const report = buildReport({
      columns,
      paths: ['../web', '../api'],
      infos: {
        react: info('react', '19.1.0'),
        left: info('left', '1.0.0', { '1.0.0': 'use right' }),
      },
      support: {},
      notes: { react: { note: 'SSR bug', updatedAt: '' } },
      previous: {},
      now: 'T1',
    });
    expect(report.folders).toEqual([
      { label: 'web', path: '../web' },
      { label: 'api', path: '../api' },
    ]);
    expect(Object.keys(report.packages)).toEqual(['left', 'react']);
    expect(report.packages.react?.locations.map((location) => location.folder)).toEqual([
      'web',
      'api',
    ]);
    expect(report.packages.react?.update).toBe('major');
    expect(report.packages.react?.note).toBe('SSR bug');
    expect(report.packages.left?.deprecated).toBe('use right');
    expect(report.packages.left?.firstSeenAt).toBe('T1');
  });

  test('keeps when a package was first seen, and keeps dropped ones with removedAt', () => {
    const previous = readPreviousPackages({
      packages: {
        react: { firstSeenAt: 'T0' },
        gone: { name: 'gone', locations: [{ location: 'dfs-fe' }] },
        older: { removedAt: 'T0' },
      },
    });
    const report = buildReport({
      columns,
      paths: ['../web', '../api'],
      infos: {},
      support: {},
      notes: {},
      previous,
      now: 'T2',
    });
    expect(report.packages.react?.firstSeenAt).toBe('T0');
    expect(report.packages.gone?.removedAt).toBe('T2');
    expect(report.packages.older?.removedAt).toBe('T0');
    expect(entryStatus(report.packages.gone!)).toBe('removed T2');
  });
});

describe('locationCell', () => {
  test('range, the installed version where it differs, and the section when not prod', () => {
    expect(locationCell(undefined)).toBe('—');
    expect(locationCell({ folder: 'x', type: 'dependencies', range: '^1.2.0', installed: '1.2.0' })).toBe(
      '^1.2.0',
    );
    expect(
      locationCell({ folder: 'x', type: 'devDependencies', range: '^1.2.0', installed: '1.4.0' }),
    ).toBe('^1.2.0 → 1.4.0 (dev)');
  });
});

describe('renderMarkdown', () => {
  test('a column per folder and a status per package', () => {
    const markdown = renderMarkdown(
      buildReport({
        columns: [column('web', { react: '18.2.0' })],
        paths: ['../web'],
        infos: { react: info('react', '19.1.0') },
        support: {
          react: {
            status: 'eol',
            product: 'react',
            cycle: '18',
            summary: '18 end of life since 2025-01-01',
            lts: false,
            source: 'https://endoflife.date/react',
          },
        },
        notes: {},
        previous: {},
        now: 'T1',
      }),
    );
    expect(markdown).toContain('| Package | web | Latest | Status |');
    expect(markdown).toContain(
      '| [react](https://www.npmjs.com/package/react) | ^18.2.0 | 19.1.0 | 18 end of life since 2025-01-01 · major behind |',
    );
    expect(markdown).toContain('https://endoflife.date/react');
  });
});
