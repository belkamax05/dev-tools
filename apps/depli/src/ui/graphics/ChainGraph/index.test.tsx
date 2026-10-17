import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import type { ChainStep } from '../../../core/chain';
import ChainGraph, { type TriggerBadge, TRIGGER_ICON } from '.';

test('provider badges render inside job boxes in full and compact graphs', () => {
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
    expect(output).toContain(`${TRIGGER_ICON.readonly} github`);
    expect(output).toContain(`${TRIGGER_ICON.blocked} jenkins`);
    expect(output).toContain(`${TRIGGER_ICON.next} jenkins`);
  }
});
