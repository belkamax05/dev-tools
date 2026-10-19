import { expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { useState } from 'react';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import * as branches from '../../../../core/branches';
import gitExecSync from '../../../../utils/gitExecSync';
import App, { TABS } from '../../App';
import type { RemoteSync } from '../../useRemoteSync';
import BranchesView from '.';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'giti-branches-test-'));
  const git = (...args: string[]) => {
    const result = gitExecSync(args, root);
    if (result.exitCode) throw new Error(result.stderr);
    return result.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'file.txt'), 'test\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  git('branch', 'feature-a');
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

const terminal = () => {
  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 40, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  stdout.on('data', (chunk) => {
    output = chunk.toString();
  });
  return {
    stdin,
    options: {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
      onRender: emitFrame,
    },
    text: () => Bun.stripANSI(output),
    clear: () => {
      output = '';
    },
  };
};
const until = async (ready: () => boolean, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for branch view');
    await Bun.sleep(20);
  }
};
const sync: RemoteSync = {
  progress: undefined,
  lastFetch: undefined,
  vendoredBehind: 0,
  fetch: () => {},
  pull: () => {},
  push: () => {},
};

for (const mode of ['keyboard', 'mouse', 'double-click'])
  test(`selection follows the switched branch after ${mode} checkout moves it to the first row`, async () => {
    const mouse = mode !== 'keyboard';
    const repo = fixture();
    const term = terminal();
    const Harness = () => {
      const [refreshKey, setRefreshKey] = useState(0);
      return (
        <BranchesView
          root={repo.root}
          refreshKey={refreshKey}
          reload={() => setRefreshKey((key) => key + 1)}
          notify={() => {}}
          onCaptureInput={() => {}}
          offerUndo={() => {}}
          handoff={() => {}}
          reservedChrome={[]}
          sync={sync}
        />
      );
    };
    const app = render(<Harness />, term.options);
    const reporting = isMouseReporting();
    const click = (text: string) => {
      const lines = term.text().split('\n');
      const row = lines.findIndex(
        (line) =>
          line.includes(text) && (text !== 'feature-a' || line.indexOf(text) < line.indexOf('││')),
      );
      if (row < 0) throw new Error(`No click target: ${text}`);
      emitMouseEvent({
        type: 'release',
        button: 'left',
        row: row + 1,
        column: lines[row]!.indexOf(text) + 2,
        ctrl: false,
        alt: false,
        shift: false,
      });
    };
    try {
      await until(() => term.text().includes('Branches (2)'));
      await Bun.sleep(60);
      if (mouse) {
        setMouseReporting(true);
        click('feature-a');
      } else term.stdin.write('\u001b[B');
      await Bun.sleep(80);
      if (mode === 'double-click') {
        expect(repo.git('branch', '--show-current')).toBe('main');
        click('feature-a');
      } else if (mouse) click('Switch');
      else term.stdin.write(' ');
      await until(() => repo.git('branch', '--show-current') === 'feature-a');
      await Bun.sleep(150);
      term.clear();
      term.stdin.write('n');
      await until(() => term.text().includes('New branch from feature-a:'));
      expect(term.text()).not.toContain('New branch from main:');
    } finally {
      setMouseReporting(reporting);
      app.unmount();
      repo.cleanup();
    }
  });

test('Overview opens the dual-panel branch picker with b and Escape returns after cancelling search', async () => {
  const repo = fixture();
  const term = terminal();
  const app = render(
    <App
      cwd={repo.root}
      commands={[]}
      onRunCommand={() => {}}
      onHandoff={() => {}}
      initialRefreshSeconds={0}
    />,
    term.options,
  );
  try {
    expect(TABS.some((tab) => String(tab.id) === 'branches')).toBe(false);
    await until(() => term.text().includes('Branches') && term.text().includes('Fetch'));
    await Bun.sleep(150);
    term.clear();
    term.stdin.write('b');
    await until(() => term.text().includes('Branches (2)'));
    await until(() => term.text().includes('Set upstream'));
    expect(term.text()).toContain('Checked out');
    expect(term.text()).toContain('Set upstream');
    term.stdin.write('/');
    await Bun.sleep(80);
    term.stdin.write('feature');
    await until(() => term.text().includes('/feature'));
    term.clear();
    term.stdin.write('\u001b');
    await Bun.sleep(100);
    expect(term.text()).toContain('Branches (2)');
    term.clear();
    term.stdin.write('\u001b');
    await until(() => term.text().includes('Fetch'));
    expect(term.text()).not.toContain('Branches (2)');
    const reporting = isMouseReporting();
    try {
      setMouseReporting(true);
      const lines = term.text().split('\n');
      const row = lines.findIndex((line) => line.includes('main') && line.includes('no upstream'));
      expect(row).toBeGreaterThanOrEqual(0);
      emitMouseEvent({
        type: 'release',
        button: 'left',
        row: row + 1,
        column: lines[row]!.indexOf('main') + 2,
        ctrl: false,
        alt: false,
        shift: false,
      });
      await until(() => term.text().includes('Branches (2)'));
    } finally {
      setMouseReporting(reporting);
    }
  } finally {
    app.unmount();
    await Bun.sleep(100);
    repo.cleanup();
  }
});

test('clicking HEAD copies its full hash and shows a temporary overlay', async () => {
  const repo = fixture();
  const term = terminal();
  const hash = repo.git('rev-parse', 'HEAD');
  const app = render(
    <App
      cwd={repo.root}
      commands={[]}
      onRunCommand={() => {}}
      onHandoff={() => {}}
      initialRefreshSeconds={0}
      initialDetails
    />,
    term.options,
  );
  const reporting = isMouseReporting();
  let write: ReturnType<typeof spyOn<typeof process.stdout, 'write'>> | undefined;
  try {
    await until(() => term.text().includes(hash));
    await Bun.sleep(150);
    const lines = term.text().split('\n');
    const row = lines.findIndex((line) => line.includes('HEAD') && line.includes(hash));
    expect(row).toBeGreaterThanOrEqual(0);
    write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    setMouseReporting(true);
    emitMouseEvent({
      type: 'release',
      button: 'left',
      row: row + 1,
      column: lines[row]!.indexOf(hash) + 2,
      ctrl: false,
      alt: false,
      shift: false,
    });
    await until(() => term.text().includes('Copied to clipboard'));
    expect(write).toHaveBeenCalledWith(`\u001b]52;c;${Buffer.from(hash).toString('base64')}\u0007`);
    write.mockRestore();
    await until(() => !term.text().includes('Copied to clipboard'));
    expect(term.text()).toContain(hash);
  } finally {
    write?.mockRestore();
    setMouseReporting(reporting);
    app.unmount();
    await Bun.sleep(100);
    repo.cleanup();
  }
});

for (const mouse of [false, true])
  test(`Overview opens Log, Stashes and Remotes with ${mouse ? 'mouse buttons' : 'hotkeys'} and Escape returns`, async () => {
    const repo = fixture();
    const term = terminal();
    const reporting = isMouseReporting();
    const app = render(
      <App
        cwd={repo.root}
        commands={[]}
        onRunCommand={() => {}}
        onHandoff={() => {}}
        initialRefreshSeconds={0}
      />,
      term.options,
    );
    try {
      expect(TABS.map((tab) => tab.id)).toEqual(['overview', 'settings']);
      await until(() => term.text().includes('[S] Stashes'));
      await Bun.sleep(150);
      for (const [key, label, title] of [
        ['l', 'Log', 'Log (1)'],
        ['S', 'Stashes', 'Stash (0)'],
        ['R', 'Remotes', 'Remotes (0)'],
      ] as const) {
        if (mouse) {
          setMouseReporting(true);
          const lines = term.text().split('\n');
          const target = `[${key}] ${label}`;
          const row = lines.findIndex((line) => line.includes(target));
          expect(row).toBeGreaterThanOrEqual(0);
          emitMouseEvent({
            type: 'release',
            button: 'left',
            row: row + 1,
            column: lines[row]!.indexOf(target) + 3,
            ctrl: false,
            alt: false,
            shift: false,
          });
        } else term.stdin.write(key);
        await until(() => term.text().includes(title));
        await Bun.sleep(80);
        if (key === 'S') {
          term.stdin.write('s');
          await until(() => term.text().includes('Stash your changes as:'));
          term.stdin.write('\u001b');
          await Bun.sleep(100);
          expect(term.text()).toContain('Stash (0)');
        }
        term.stdin.write('\u001b');
        await until(() => term.text().includes('[S] Stashes'));
        expect(term.text()).not.toContain(title);
        await Bun.sleep(80);
      }
    } finally {
      setMouseReporting(reporting);
      app.unmount();
      await Bun.sleep(100);
      repo.cleanup();
    }
  });

test('a branch switched to from the dashboard picker closes it, and says so in a passing tooltip', async () => {
  const repo = fixture();
  const term = terminal();
  //? One Enter, one `git switch`: two at once fought over index.lock and one of them failed
  const switches = spyOn(branches, 'switchBranch');
  const app = render(
    <App
      cwd={repo.root}
      commands={[]}
      onRunCommand={() => {}}
      onHandoff={() => {}}
      initialRefreshSeconds={0}
    />,
    term.options,
  );
  try {
    await until(() => term.text().includes('Branches') && term.text().includes('Fetch'));
    await Bun.sleep(150);
    term.stdin.write('b');
    await until(() => term.text().includes('Branches (2)'));
    term.stdin.write('/feature-a');
    await until(() => term.text().includes('/feature-a'));
    term.stdin.write('\r');
    await Bun.sleep(100);
    term.clear();
    term.stdin.write('\r');
    await until(() => !term.text().includes('Branches (2)') && term.text().includes('Fetch'));
    expect(repo.git('branch', '--show-current').trim()).toBe('feature-a');
    expect(switches).toHaveBeenCalledTimes(1);
    //? Drawn as the copy-hash tooltip is — boxed, over the layout — and gone by itself
    await until(() => /│ Switched to feature-a │/.test(term.text()));
    await until(() => !term.text().includes('Switched to feature-a'), 4000);
  } finally {
    switches.mockRestore();
    app.unmount();
    repo.cleanup();
  }
});

/** The fixture, with a submodule `mod` whose upstream also has `feature-a`. */
const withSubmodule = () => {
  const repo = fixture();
  const upstream = mkdtempSync(join(tmpdir(), 'giti-branches-mod-'));
  const inUpstream = (...args: string[]) => gitExecSync(args, upstream);
  inUpstream('init', '-q', '-b', 'main');
  inUpstream('config', 'user.name', 'Test');
  inUpstream('config', 'user.email', 'test@example.com');
  inUpstream('commit', '-q', '--allow-empty', '-m', 'initial');
  inUpstream('branch', 'feature-a');
  //? file:// submodules are refused by default since git 2.38.1 — allowed for this test only
  repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', upstream, 'mod');
  repo.git('commit', '-qm', 'add mod');
  //? Moved up to the commit that has the submodule — on the old one there is nothing to follow
  repo.git('branch', '-f', 'feature-a');
  const modBranch = () => gitExecSync(['branch', '--show-current'], join(repo.root, 'mod')).stdout;
  return {
    ...repo,
    modBranch,
    cleanup: () => {
      repo.cleanup();
      rmSync(upstream, { recursive: true, force: true });
    },
  };
};

for (const mode of ['keyboard', 'mouse'])
  test(`a dashboard switch offers the branch to submodules, applied with ${mode}`, async () => {
    const repo = withSubmodule();
    const term = terminal();
    const captured: boolean[] = [];
    const Harness = () => {
      const [refreshKey, setRefreshKey] = useState(0);
      return (
        <BranchesView
          root={repo.root}
          refreshKey={refreshKey}
          reload={() => setRefreshKey((key) => key + 1)}
          notify={() => {}}
          onCaptureInput={(on) => captured.push(on)}
          offerUndo={() => {}}
          handoff={() => {}}
          reservedChrome={[]}
          sync={sync}
        />
      );
    };
    const app = render(<Harness />, term.options);
    const reporting = isMouseReporting();
    const click = (text: string) => {
      const lines = term.text().split('\n');
      const row = lines.findIndex((line) => line.includes(text));
      if (row < 0) throw new Error(`No click target: ${text}`);
      emitMouseEvent({
        type: 'release',
        button: 'left',
        row: row + 1,
        column: lines[row]!.indexOf(text) + 2,
        ctrl: false,
        alt: false,
        shift: false,
      });
    };
    try {
      await until(() => term.text().includes('Branches (2)'));
      await Bun.sleep(60);
      term.stdin.write('\u001b[B');
      await Bun.sleep(80);
      term.stdin.write(' ');
      await until(() => term.text().includes('Follow feature-a in vendored repos'), 20_000);
      //? Ticked for you: the submodule's upstream has the branch
      expect(term.text()).toContain('[x]');
      await until(() => captured.at(-1) === true);
      if (mode === 'mouse') {
        setMouseReporting(true);
        click('Apply 1');
      } else term.stdin.write('\r');
      await until(() => repo.modBranch().trim() === 'feature-a', 20_000);
      await until(() => !term.text().includes('Follow feature-a'));
      await until(() => captured.at(-1) === false);
    } finally {
      setMouseReporting(reporting);
      app.unmount();
      repo.cleanup();
    }
  }, 30_000);

test('a click unticks a submodule, and Esc leaves it where it was', async () => {
  const repo = withSubmodule();
  const term = terminal();
  const Harness = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    return (
      <BranchesView
        root={repo.root}
        refreshKey={refreshKey}
        reload={() => setRefreshKey((key) => key + 1)}
        notify={() => {}}
        onCaptureInput={() => {}}
        offerUndo={() => {}}
        handoff={() => {}}
        reservedChrome={[]}
        sync={sync}
      />
    );
  };
  const app = render(<Harness />, term.options);
  const reporting = isMouseReporting();
  try {
    await until(() => term.text().includes('Branches (2)'));
    await Bun.sleep(60);
    term.stdin.write('\u001b[B');
    await Bun.sleep(80);
    term.stdin.write(' ');
    await until(() => term.text().includes('[x]'), 20_000);
    setMouseReporting(true);
    const lines = term.text().split('\n');
    const row = lines.findIndex((line) => line.includes('[x]'));
    emitMouseEvent({
      type: 'release',
      button: 'left',
      row: row + 1,
      column: lines[row]!.indexOf('mod') + 2,
      ctrl: false,
      alt: false,
      shift: false,
    });
    await until(() => term.text().includes('[ ]') && term.text().includes('Done'));
    term.stdin.write('\u001b');
    await until(() => term.text().includes('Branches (2)'));
    expect(repo.modBranch().trim()).toBe('main');
  } finally {
    setMouseReporting(reporting);
    app.unmount();
    repo.cleanup();
  }
}, 30_000);

test('`giti hop` (followVendored off) gets no checklist here — it asks after its screen closes', async () => {
  const repo = withSubmodule();
  const term = terminal();
  const switched: string[] = [];
  const app = render(
    <BranchesView
      root={repo.root}
      refreshKey={0}
      reload={() => {}}
      notify={() => {}}
      onCaptureInput={() => {}}
      offerUndo={() => {}}
      handoff={() => {}}
      reservedChrome={[]}
      sync={sync}
      onSwitched={(message) => switched.push(message)}
      followVendored={false}
    />,
    term.options,
  );
  const plan = spyOn(await import('../../../../core/vendoredHop'), 'planVendoredHopAtHead');
  try {
    await until(() => term.text().includes('Branches (2)'));
    await Bun.sleep(60);
    term.stdin.write('\u001b[B');
    await Bun.sleep(80);
    term.stdin.write(' ');
    await until(() => switched.length === 1);
    await Bun.sleep(200);
    expect(plan).not.toHaveBeenCalled();
    expect(term.text()).not.toContain('vendored repos');
    expect(repo.modBranch().trim()).toBe('main');
  } finally {
    plan.mockRestore();
    app.unmount();
    repo.cleanup();
  }
}, 30_000);

test('the dashboard asks about submodules before its picker closes back to Overview', async () => {
  const repo = withSubmodule();
  const term = terminal();
  const app = render(
    <App
      cwd={repo.root}
      commands={[]}
      onRunCommand={() => {}}
      onHandoff={() => {}}
      initialRefreshSeconds={0}
    />,
    term.options,
  );
  try {
    await until(() => term.text().includes('Fetch'), 10_000);
    await Bun.sleep(150);
    term.stdin.write('b');
    await until(() => term.text().includes('Branches (2)'));
    await Bun.sleep(80);
    term.stdin.write('\u001b[B');
    await Bun.sleep(80);
    term.stdin.write(' ');
    await until(() => term.text().includes('Follow feature-a in vendored repos'), 20_000);
    expect(repo.git('branch', '--show-current').trim()).toBe('feature-a');
    await Bun.sleep(80);
    term.stdin.write('\r');
    await until(() => repo.modBranch().trim() === 'feature-a', 20_000);
    //? Answered: the picker closes as a plain switch always did
    await until(() => !term.text().includes('Branches (2)') && term.text().includes('Fetch'));
  } finally {
    app.unmount();
    repo.cleanup();
  }
}, 30_000);
