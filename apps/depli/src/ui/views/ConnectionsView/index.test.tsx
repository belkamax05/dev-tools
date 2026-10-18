import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import Box from '@/dev-tools/ui/components/Box';

import type { Connection } from '../../../core/plugin';
import type { Provider } from '../../../core/registry';
import jenkins from '../../../plugins/jenkins';
import type { DepliData } from '../../useDepli';
import ConnectionsView from '.';

const view = (ok: boolean, configured: boolean, row = 'jenkins:auto') => {
  const env = configured ? { USER: 'jenkins-user', TOKEN: 'private-token' } : {};
  const provider: Provider = {
    name: 'jenkins',
    plugin: jenkins,
    options: { plugin: 'jenkins', url: 'https://ci.test', userEnv: 'USER', tokenEnv: 'TOKEN' },
    transports: [...jenkins.transports],
  };
  const connection: Connection = {
    transport: ok ? 'api' : undefined,
    capabilities: ok ? ['jobs', 'trigger'] : [],
    checkedAt: 0,
    probes: [
      {
        transport: 'api',
        label: 'API',
        ok,
        detail: ok ? 'signed in' : 'credentials missing or refused',
      },
    ],
  };
  const data = {
    connections: { jenkins: connection },
    preferences: {},
    setupUnavailable: async () => undefined,
    setupContext: () => ({ env, options: provider.options }),
  } as unknown as DepliData;
  return Bun.stripANSI(
    renderToString(
      //? A terminal's height: the detail pane clips and scrolls, so it needs rows to show them
      <Box height={50} flexDirection="column">
      <ConnectionsView
        data={data}
        providers={[provider]}
        problems={[]}
        session={{ tab: 'connections', selected: { connections: row } }}
        notify={() => {}}
        onCaptureInput={() => {}}
      />
      </Box>,
      { columns: 180 },
    ),
  );
};

test('missing Jenkins credentials have a visible configure action in Auto', () => {
  const output = view(false, false);
  expect(output).toContain('API configuration required');
  expect(output).toContain('Configure Jenkins API');
  expect(output).toContain('Jenkins user id: not set');
  expect(output).toContain('Reveal token');
  expect(output).not.toContain('API credentials verified');
});

test('verified credentials keep the configuration panel visible in Auto', () => {
  const output = view(true, true);
  expect(output).toContain('API credentials verified');
  expect(output).toContain('Update Jenkins API credentials');
  expect(output).toContain('jenkins-user');
  expect(output).not.toContain('private-token');
});

test('a refused token stays in the action state even when both fields are set', () => {
  const output = view(false, true, 'jenkins:api');
  expect(output).toContain('API configuration required');
  expect(output).toContain('Configure Jenkins API');
  expect(output).not.toContain('API credentials verified');
});
