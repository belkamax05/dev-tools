import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import type { ChainStep } from '../../../core/chain';
import ChainGraph, { type TriggerBadge, TRIGGER_ICON } from '.';

test('explicit status labels and provider fallbacks render in full and compact graphs', () => {
  const chain: ChainStep[] = ['readonly', 'blocked', 'next'].map((id, at) => ({
    step: {
      id,
      label: id,
      provider: at ? 'jenkins' : 'github',
      kind: 'job',
      after: at ? [at === 1 ? 'readonly' : 'blocked'] : [],
    },
    status: { state: 'done', summary: 'ok' },
    recommended: id === 'next',
    protected: false,
  }));
  for (const rows of [12, 30]) {
    const output = renderToString(
      <ChainGraph
        chain={chain}
        width={40}
        rows={rows}
        labelOf={(entry) => entry.step.label}
        onSelect={() => {}}
        providerOf={(entry) => ({ id: entry.step.provider, label: entry.step.provider })}
        triggerBadgeOf={(entry) => entry.step.id as TriggerBadge}
      />,
    );
    expect(output).toContain(`${TRIGGER_ICON.readonly}   Read-only · github`);
    expect(output).toContain(`${TRIGGER_ICON.blocked}   Blocked · jenkins`);
    expect(output).toContain(`${TRIGGER_ICON.next}   Next · jenkins`);
  }
});

test('the progress dot has separate incoming and outgoing connector rows', () => {
  const chain: ChainStep[] = [
    {
      step: { id: 'push', label: 'Push', provider: 'github', kind: 'branch' },
      status: { state: 'done', summary: '' },
      recommended: false,
      protected: false,
    },
    {
      step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job', after: ['push'] },
      status: { state: 'stale', summary: '' },
      recommended: true,
      protected: false,
    },
  ];
  const output = renderToString(
    <ChainGraph
      chain={chain}
      width={30}
      rows={30}
      labelOf={(entry) => entry.step.label}
      onSelect={() => {}}
      providerOf={(entry) => ({ id: entry.step.provider, label: entry.step.provider })}
      triggerBadgeOf={() => undefined}
    />,
  );
  const lines = Bun.stripANSI(output).split('\n');
  const marker = lines.findIndex((line) => line.includes('●'));
  expect(marker).toBeGreaterThan(0);
  expect(lines[marker - 1]?.trim()).toBe('│');
  expect(lines[marker + 1]?.trim()).toBe('│');
  expect(lines[marker - 1]?.indexOf('│')).toBe(lines[marker]?.indexOf('●'));
  expect(lines[marker + 1]?.indexOf('│')).toBe(lines[marker]?.indexOf('●'));
});

test('a running job shows its spinner and Running status beside the provider', () => {
  const entry: ChainStep = {
    step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job' },
    status: { state: 'running', summary: 'building' },
    recommended: false,
    protected: false,
  };
  const output = renderToString(
    <ChainGraph
      chain={[entry]}
      width={50}
      rows={10}
      labelOf={(item) => item.step.label}
      onSelect={() => {}}
      providerOf={(item) => ({ id: 'jenkins', label: item.step.provider })}
      triggerBadgeOf={() => 'running'}
    />,
  );
  expect(output).toContain('Running · jenkins');
  expect(output).toContain('◐');
});

test('stale items keep their trigger badge and label freshness beside the provider', () => {
  for (const badge of ['blocked', 'next'] as const) {
    const entry: ChainStep = {
      step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job' },
      status: { state: 'stale', summary: 'behind' },
      recommended: true,
      protected: false,
    };
    const output = renderToString(
      <ChainGraph
        chain={[entry]}
        width={50}
        rows={10}
        labelOf={(item) => item.step.label}
        onSelect={() => {}}
        providerOf={(item) => ({ id: 'jenkins', label: item.step.provider })}
        triggerBadgeOf={() => badge}
      />,
    );
    expect(output).toContain('Stale · jenkins');
    expect(output).toContain(TRIGGER_ICON[badge]);
  }
});

test('never-run jobs show their own status icon and label', () => {
  const entry: ChainStep = {
    step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job' },
    status: { state: 'none', summary: '' },
    recommended: false,
    protected: false,
  };
  const output = renderToString(
    <ChainGraph
      chain={[entry]}
      width={50}
      rows={10}
      labelOf={(item) => item.step.label}
      onSelect={() => {}}
      providerOf={() => ({ id: 'jenkins', label: 'jenkins' })}
      triggerBadgeOf={() => undefined}
    />,
  );
  expect(output).toContain('Never run · jenkins');
  expect(output).toContain(TRIGGER_ICON.neverrun);
  expect(TRIGGER_ICON.neverrun).not.toBe(TRIGGER_ICON.next);
});

test('never-run and next metadata retain icons even when the trigger badge is blocked', () => {
  const entry: ChainStep = {
    step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job' },
    status: { state: 'none', summary: '' },
    recommended: true,
    protected: false,
  };
  for (const rows of [4, 30]) {
    const output = renderToString(
      <ChainGraph
        chain={[entry]}
        width={70}
        rows={rows}
        labelOf={(item) => item.step.label}
        onSelect={() => {}}
        providerOf={() => ({ id: 'jenkins', label: 'jenkins' })}
        triggerBadgeOf={() => 'blocked'}
      />,
    );
    expect(output).toContain('○ Never run');
    expect(output).toContain('➜ Next');
    expect(output).toContain('Blocked');
  }
});

test('chain dependency blocking stays explicit even when the trigger itself is ready', () => {
  const entry: ChainStep = {
    step: { id: 'propagate', label: 'Propagate', provider: 'jenkins', kind: 'job' },
    status: {
      state: 'blocked',
      summary: 'previous build',
      notes: ['Waiting on deploy: never run'],
    },
    recommended: false,
    protected: false,
  };
  const output = renderToString(
    <ChainGraph
      chain={[entry]}
      width={70}
      rows={30}
      labelOf={(item) => item.step.label}
      onSelect={() => {}}
      providerOf={() => ({ id: 'jenkins', label: 'jenkins' })}
      triggerBadgeOf={() => undefined}
    />,
  );
  expect(output).toContain('⊘ Blocked');
  expect(output).toContain('Blocked · jenkins');
  expect(output).not.toContain('blocked');
});

test('every job state has an explicit icon and status label in its footer', () => {
  const states = {
    done: ['✓', 'Complete'],
    stale: ['↻', 'Stale'],
    failed: ['✗', 'Failed'],
    offline: ['⊘', 'Offline'],
    missing: ['?', 'Missing'],
    error: ['!', 'Error'],
  } as const;
  for (const [state, [icon, label]] of Object.entries(states)) {
    const entry: ChainStep = {
      step: { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job' },
      status: { state: state as ChainStep['status']['state'], summary: '' },
      recommended: false,
      protected: false,
    };
    const output = renderToString(
      <ChainGraph
        chain={[entry]}
        width={70}
        rows={30}
        labelOf={(item) => item.step.label}
        onSelect={() => {}}
        providerOf={() => ({ id: 'jenkins', label: 'jenkins' })}
        triggerBadgeOf={() => undefined}
      />,
    );
    expect(output).toContain(`${icon} ${label}`);
    expect(output).toContain(`${label} · jenkins`);
  }
});
