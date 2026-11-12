import { afterAll, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { stateStore } from '../../config/settings';
import { definePlugin } from '../../core/plugin';
import { resolveProject } from '../../core/registry';
import type { Session as DepliSession } from '../../core/session';
import type { Session } from '../types';
import App from '.';

//? Picks are saved like the branch — keep the real state file out of it
const realSave = stateStore.save;
stateStore.save = async () => {};
afterAll(() => {
  stateStore.save = realSave;
});

const plugin = definePlugin({
  id: 'fake',
  label: 'Fake',
  icon: '🧪',
  transports: [
    { id: 'api', label: 'api', capabilities: [], probe: async () => ({ ok: true, detail: 'ok' }) },
  ],
  steps: { job: { status: async () => ({ state: 'done', summary: 'ok' }) } },
  branches: async () => [
    { name: 'master', sha: 'aaaa', committedAt: '2026-11-01' },
    { name: 'newest-unsuggested', sha: 'cccc', committedAt: '2026-11-09' },
    { name: 'develop', sha: 'bbbb', committedAt: '2026-11-02' },
  ],
  suggestions: async (_context, _connection, source) =>
    source?.param === 'SCRIPTS'
      ? [
          { name: 'develop-9115', sha: '' },
          { name: 'cromwell-master', sha: '' },
        ]
      : [
          { name: 'master', sha: '' },
          { name: 'develop', sha: '' },
        ],
});

const session = (): DepliSession => {
  const project = resolveProject('/tmp/depli-picks', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    envs: [{ id: 'qa' }],
    pollSeconds: 0,
    branches: { suggest: { provider: 'ci', source: { job: 'build', param: 'CODE' } } },
    picks: {
      scripts: {
        label: 'scripts',
        hotkey: 'D',
        default: ({ branch }) => (branch === 'master' ? 'cromwell-master' : 'develop-9115'),
        suggest: { provider: 'ci', source: { job: 'build', param: 'SCRIPTS' } },
        custom: true,
      },
    },
    pipeline: [{ id: 'build', label: 'Build', provider: 'ci', kind: 'job' }],
  });
  project.picks = { scripts: { label: 'scripts' } };
  return { project, env: {}, branch: 'develop', targetEnv: 'qa', state: { selected: 'develop' } };
};

const mount = () => {
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
  const depli = session();
  const ui: Session = { tab: 'chain', selected: {} };
  const app = render(
    <App
      depli={depli}
      config={{ theme: 'sakura' }}
      configPath="/tmp/depli-config.json"
      session={ui}
      onConfigChange={() => {}}
      onStateChange={() => {}}
      onHandoff={() => {}}
      onCleared={() => {}}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  );
  return {
    app,
    stdin,
    depli,
    screen: () => screen,
    clear: () => {
      screen = '';
    },
  };
};

test('a pick shows its default under the branch; D picks a suggested value', async () => {
  const { app, stdin, depli, screen, clear } = mount();
  try {
    await Bun.sleep(150);
    expect(screen()).toContain('scripts');
    expect(screen()).toMatch(/scripts +develop-9115/);
    expect(screen()).toMatch(/Branch +\S/);
    clear();
    stdin.write('D');
    await Bun.sleep(150);
    expect(screen()).toContain('Pick scripts');
    expect(screen()).toContain('Suggested by build');
    expect(screen()).toContain('cromwell-master');
    //? The default is its own first row, not listed again among the suggestions
    expect(screen()).toContain('↺ default (develop-9115)');
    expect(screen()).not.toMatch(/(^|[│ ])[✓ ] develop-9115/m);
    //? default, cromwell-master: down once, Enter
    stdin.write('\u001b[B');
    await Bun.sleep(40);
    stdin.write('\r');
    await Bun.sleep(150);
    expect(depli.project.picks?.scripts?.value).toBe('cromwell-master');
  } finally {
    app.unmount();
  }
});

test('a value typed into the pick’s filter is used as it is', async () => {
  const { app, stdin, depli } = mount();
  try {
    await Bun.sleep(150);
    stdin.write('D');
    await Bun.sleep(120);
    stdin.write('/');
    await Bun.sleep(40);
    stdin.write('develop-9115-node24');
    await Bun.sleep(40);
    stdin.write('\r');
    await Bun.sleep(80);
    stdin.write('\r');
    await Bun.sleep(150);
    expect(depli.project.picks?.scripts?.value).toBe('develop-9115-node24');
  } finally {
    app.unmount();
  }
});

test('the branch picker lists the suggested branches, in their order, before the newest others', async () => {
  const { app, stdin, screen, clear } = mount();
  try {
    await Bun.sleep(150);
    clear();
    stdin.write('b');
    await Bun.sleep(200);
    const shown = screen();
    expect(shown).toContain('Suggested by build');
    expect(shown).not.toContain('newest-unsuggested');
  } finally {
    app.unmount();
  }
});
