import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

//? activate.sh and include, sourced by real shells. Nix itself is replaced by a fake `nix-build` that
//? writes a profile shaped like mk-env.nix's (bin/ + share/<name>/env.sh) and logs every call, so this
//? covers the shell-side decisions only; nix/check.ts covers the .nix files against real Nix.

const devToolsRoot = join(import.meta.dir, '../..');
const systemPath = '/usr/bin:/bin';

/** Stands in for nix-build: `<file> -A profile -o <link>`. FAKE_NIX_FAIL=1 makes it fail. */
const fakeNixBuild = `#!/bin/sh
[ "$FAKE_NIX_FAIL" = 1 ] && exit 1
while [ $# -gt 0 ]; do [ "$1" = -o ] && link=$2; shift; done
echo build >>"$FAKE_NIX_LOG"
n=$(wc -l <"$FAKE_NIX_LOG" | tr -d ' ')
name=$(basename "$link")
out="$FAKE_NIX_STORE/$n-$name-env"
mkdir -p "$out/bin" "$out/share/$name"
echo "export FAKE_ENV_BUILD=$n" >"$out/share/$name/env.sh"
ln -sfn "$out" "$link"
`;

const shells = ['bash', 'zsh'].filter((shell) => Bun.which(shell));

interface Fixture {
  dir: string;
  root: string;
  fakeBin: string;
  log: string;
}

let fixture: Fixture;

const past = (path: string) => {
  const then = Date.now() / 1000 - 3600;
  utimesSync(path, then, then);
};

const future = (path: string) => {
  const later = Date.now() / 1000 + 3600;
  utimesSync(path, later, later);
};

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-tools-activate-'));
  const root = join(dir, 'repo');
  const fakeBin = join(dir, 'fake-bin');
  mkdirSync(join(root, 'nix/lib'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(dir, 'store'));
  mkdirSync(join(dir, 'home'));
  mkdirSync(fakeBin);
  cpSync(join(devToolsRoot, 'include'), join(root, 'include'));
  cpSync(join(devToolsRoot, 'nix/lib/activate.sh'), join(root, 'nix/lib/activate.sh'));
  writeFileSync(join(root, 'nix/env.nix'), '{ }\n');
  past(join(root, 'nix/env.nix'));
  writeFileSync(join(fakeBin, 'nix-build'), fakeNixBuild);
  chmodSync(join(fakeBin, 'nix-build'), 0o755);
  fixture = { dir, root, fakeBin, log: join(dir, 'nix-build.log') };
});

afterEach(() => {
  rmSync(fixture.dir, { recursive: true, force: true });
});

interface RunOptions {
  withNix?: boolean;
  env?: Record<string, string>;
}

interface RunResult {
  rc: number;
  path: string[];
  build: string;
  stderr: string;
}

/** Sources `script` in a clean `shell` (from an unrelated cwd), then reports rc, PATH and FAKE_ENV_BUILD. */
const run = (
  shell: string,
  script: string,
  { withNix = true, env = {} }: RunOptions = {},
): RunResult => {
  const proc = Bun.spawnSync(
    [
      Bun.which(shell) as string,
      '-c',
      `${script}; echo "rc=$?"; echo "path=$PATH"; echo "build=$FAKE_ENV_BUILD"`,
    ],
    {
      cwd: tmpdir(),
      env: {
        HOME: join(fixture.dir, 'home'),
        PATH: withNix ? `${fixture.fakeBin}:${systemPath}` : systemPath,
        FAKE_NIX_LOG: fixture.log,
        FAKE_NIX_STORE: join(fixture.dir, 'store'),
        ...env,
      },
    },
  );
  const out = Object.fromEntries(
    proc.stdout
      .toString()
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return {
    rc: Number(out.rc),
    path: (out.path ?? '').split(':'),
    build: out.build ?? '',
    stderr: proc.stderr.toString(),
  };
};

const activate = (...watch: string[]) =>
  `. "${fixture.root}/nix/lib/activate.sh"; dev_tools_nix_env "${fixture.root}" demo ${watch.map((w) => `"${w}"`).join(' ')}`;

const buildCount = () => {
  try {
    return readFileSync(fixture.log, 'utf8').trim().split('\n').length;
  } catch {
    return 0;
  }
};

const profileBin = () => join(fixture.root, '.cache/nix/demo/bin');

describe.each(shells)('activate.sh (%s)', (shell) => {
  test('without nix-build on PATH, returns non-zero and changes nothing', () => {
    const result = run(shell, activate(), { withNix: false });

    expect(result.rc).not.toBe(0);
    expect(result.path.join(':')).toBe(systemPath);
    expect(buildCount()).toBe(0);
  });

  test('DEV_TOOLS_NIX=0 skips Nix even when it is installed', () => {
    for (const off of ['0', 'false', 'no', 'off']) {
      const result = run(shell, activate(), { env: { DEV_TOOLS_NIX: off } });

      expect(result.rc).not.toBe(0);
      expect(result.build).toBe('');
    }
    expect(buildCount()).toBe(0);
  });

  test('first run builds the profile, then puts its bin/ first and loads its env.sh', () => {
    const result = run(shell, activate());

    expect(result.rc).toBe(0);
    expect(result.path[0]).toBe(profileBin());
    expect(result.build).toBe('1');
    expect(buildCount()).toBe(1);
  });

  test('a second shell reuses the cached profile instead of rebuilding', () => {
    run(shell, activate());
    const result = run(shell, activate());

    expect(result.build).toBe('1');
    expect(buildCount()).toBe(1);
  });

  test('a .nix file newer than the last build triggers a rebuild', () => {
    run(shell, activate());
    future(join(fixture.root, 'nix/env.nix'));
    const result = run(shell, activate());

    expect(result.build).toBe('2');
  });

  test('a new .enabled.json triggers a rebuild', () => {
    run(shell, activate());
    mkdirSync(join(fixture.root, 'nix/packages'));
    writeFileSync(join(fixture.root, 'nix/packages/.enabled.json'), '{}');
    future(join(fixture.root, 'nix/packages/.enabled.json'));

    expect(run(shell, activate()).build).toBe('2');
  });

  test('changes in an extra watched dir (an embedded libs/dev-tools/nix) trigger a rebuild', () => {
    const embedded = join(fixture.dir, 'embedded-nix');
    mkdirSync(embedded);
    writeFileSync(join(embedded, 'module.nix'), '{ }\n');
    past(join(embedded, 'module.nix'));

    run(shell, activate(embedded));
    expect(run(shell, activate(embedded)).build).toBe('1');

    future(join(embedded, 'module.nix'));
    expect(run(shell, activate(embedded)).build).toBe('2');
  });

  test('a failed rebuild warns and keeps the previous profile', () => {
    run(shell, activate());
    future(join(fixture.root, 'nix/env.nix'));
    const result = run(shell, activate(), { env: { FAKE_NIX_FAIL: '1' } });

    expect(result.rc).toBe(0);
    expect(result.build).toBe('1');
    expect(result.path[0]).toBe(profileBin());
    expect(result.stderr).toContain('keeping the previous environment');
  });

  test('a failed first build returns non-zero so the caller can fall back', () => {
    const result = run(shell, activate(), { env: { FAKE_NIX_FAIL: '1' } });

    expect(result.rc).not.toBe(0);
    expect(result.path.join(':')).toBe(`${fixture.fakeBin}:${systemPath}`);
    expect(result.stderr).toContain('falling back to non-Nix setup');
  });

  test('leaves no helper variables behind in the caller', () => {
    const proc = Bun.spawnSync(
      [Bun.which(shell) as string, '-c', `${activate()}; set | grep '^_dtne_' || true`],
      {
        env: {
          HOME: join(fixture.dir, 'home'),
          PATH: `${fixture.fakeBin}:${systemPath}`,
          FAKE_NIX_LOG: fixture.log,
          FAKE_NIX_STORE: join(fixture.dir, 'store'),
        },
      },
    );

    expect(proc.stdout.toString().trim()).toBe('');
  });
});

describe.each(shells)('include (%s)', (shell) => {
  const include = () => `. "${fixture.root}/include"`;

  test('without Nix, puts only the repo bin/ on PATH', () => {
    const result = run(shell, include(), { withNix: false });

    expect(result.path).toEqual([join(fixture.root, 'bin'), ...systemPath.split(':')]);
  });

  test('with DEV_TOOLS_NIX=0, puts only the repo bin/ on PATH', () => {
    const result = run(shell, include(), { env: { DEV_TOOLS_NIX: '0' } });

    expect(result.path[0]).toBe(join(fixture.root, 'bin'));
    expect(buildCount()).toBe(0);
  });

  test('with Nix, loads the dev-tools profile instead', () => {
    const result = run(shell, include());

    expect(result.path[0]).toBe(join(fixture.root, '.cache/nix/dev-tools/bin'));
    expect(result.build).toBe('1');
  });

  test('when the first build fails, falls back to the repo bin/', () => {
    const result = run(shell, include(), { env: { FAKE_NIX_FAIL: '1' } });

    expect(result.path[0]).toBe(join(fixture.root, 'bin'));
  });
});
