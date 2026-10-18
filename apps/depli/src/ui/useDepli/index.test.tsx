import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import type { ProviderPlugin } from '../../core/plugin';
import type { Session } from '../../core/session';
import { type DepliData, useDepli } from '.';

const waitFor = async (ready: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for deployment state');
    await Bun.sleep(10);
  }
};

for (const initiallyConnected of [false, true]) {
  test(`saving credentials recovers ${initiallyConnected ? 'a failed step on the same API transport' : 'a failing connection'} without restarting`, async () => {
    let latest: DepliData | undefined;
    let probes = 0;
    const plugin: ProviderPlugin = {
      id: 'test', label: 'Test Jenkins', icon: 'J',
      transports: [{
        id: 'api', label: 'API', capabilities: ['jobs'],
        probe: async ({ env }) => {
          probes++;
          return { ok: initiallyConnected || env.TOKEN === 'new-token', detail: 'probe' };
        },
        setup: {
          label: 'Save credentials', detail: '', steps: [],
          start: ({ env }, progress, values) => {
            progress({ state: 'running', message: 'saving' });
            // The save command applies the new credentials before reporting completion.
            void Promise.resolve().then(() => {
              Object.assign(env, { TOKEN: values.token });
              progress({ state: 'done', message: 'saved' });
            });
            return { cancel: () => {} };
          },
        },
      }],
      steps: {
        deploy: {
          status: async ({ env }) => env.TOKEN === 'new-token'
            ? { state: 'done', summary: 'authenticated' }
            : { state: 'error', summary: 'unauthorized' },
        },
      },
    };
    const session: Session = {
      env: {}, branch: 'main', targetEnv: 'dev', state: {},
      project: {
        dir: process.cwd(), problems: [],
        config: { pollSeconds: 0, pipeline: [{ id: 'deploy', label: 'Deploy', provider: 'jenkins', kind: 'deploy' }] },
        providers: [{ name: 'jenkins', plugin, options: { plugin: 'test' }, transports: [...plugin.transports] }],
      },
    };
    const notify = () => {};
    const Harness = () => {
      latest = useDepli(session, notify);
      return null;
    };
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
    stdout.on('data', () => {});
    const app = render(<Harness />, { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false });
    try {
      await waitFor(() => latest?.chain[0]?.status.state === (initiallyConnected ? 'error' : 'offline'));
      const before = probes;
      latest!.startSetup('jenkins', 'api', { token: 'new-token' });
      await waitFor(() => latest?.setup?.progress.state === 'done' && latest.chain[0]?.status.state === 'done');
      expect(probes).toBeGreaterThan(before);
      expect(latest!.connections.jenkins?.transport).toBe('api');
      expect(latest!.chain[0]?.status.summary).toBe('authenticated');
    } finally {
      app.unmount();
    }
  });
}
