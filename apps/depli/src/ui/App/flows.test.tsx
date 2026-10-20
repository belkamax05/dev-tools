import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { definePlugin } from '../../core/plugin';
import { resolveProject } from '../../core/registry';
import type { Session as DepliSession } from '../../core/session';
import type { Session } from '../types';
import App, { type AppProps } from '.';

const plugin = definePlugin({
  id: 'fake',
  label: 'Fake',
  icon: '🧪',
  transports: [
    { id: 'api', label: 'api', capabilities: [], probe: async () => ({ ok: true, detail: 'ok' }) },
  ],
  steps: { job: { status: async () => ({ state: 'done', summary: 'ok' }) } },
  branches: async () => [{ name: 'release-26.14', sha: '' }],
});

//? The be flow: the fe flow's pick is linked in as the FE branch
const beSession = (): DepliSession => {
  const project = resolveProject('/tmp/depli-flows', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    envs: [{ id: 'qa' }],
    pollSeconds: 0,
    linkedBranches: { fe: { flow: 'fe', label: 'FE branch' } },
    pipeline: [{ id: 'build', label: 'Build', provider: 'ci', kind: 'job' }],
  });
  project.flow = { id: 'be', label: 'be', all: ['fe', 'be'] };
  project.linked = { fe: { flow: 'fe', label: 'FE branch', branch: 'release-sprint-26.14' } };
  return {
    project,
    env: {},
    branch: 'release-26.14',
    targetEnv: 'qa',
    state: { selected: 'release-26.14', env: 'qa' },
  };
};

const mount = (props: Partial<AppProps>) => {
  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 40, isTTY: true });
  let screen = '';
  stdout.on('data', (chunk) => {
    screen += String(chunk);
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const switched: Array<[string, AppProps['flowIntent']]> = [];
  const session: Session = { tab: 'chain', selected: {} };
  const app = render(
    <App
      depli={beSession()}
      config={{ theme: 'sakura' }}
      configPath="/tmp/depli-config.json"
      session={session}
      onConfigChange={() => {}}
      onStateChange={() => {}}
      onHandoff={() => {}}
      onCleared={() => {}}
      onSwitchFlow={async (flow, intent) => {
        switched.push([flow, intent]);
      }}
      {...props}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  );
  return { app, stdin, switched, screen: () => screen };
};

test('f switches flow; F opens the linked flow on its branch picker, to come back here', async () => {
  const { app, stdin, switched, screen } = mount({});
  try {
    await Bun.sleep(150);
    expect(screen()).toContain('FE branch');
    expect(screen()).toContain('release-sprint-26.14');
    stdin.write('f');
    await Bun.sleep(80);
    stdin.write('F');
    await Bun.sleep(80);
    expect(switched).toEqual([
      ['fe', undefined],
      ['fe', { pickBranch: true, returnTo: 'be' }],
    ]);
  } finally {
    app.unmount();
  }
});

test('opened to pick a branch: the picker is up, and closing it goes back to the flow that asked', async () => {
  const { app, stdin, switched, screen } = mount({
    flowIntent: { pickBranch: true, returnTo: 'be' },
  });
  try {
    await Bun.sleep(150);
    expect(screen()).toContain('Pick a branch');
    stdin.write('\u001b');
    await Bun.sleep(120);
    expect(switched).toEqual([['be', undefined]]);
  } finally {
    app.unmount();
  }
});
