#!/usr/bin/env bun
//? The half of the Nix setup activate.test.ts can't reach: evaluates and builds the real .nix files.
//? Slow on a cold store (fetches nixpkgs) and needs Nix, so it's `bun run check:nix`, not part of
//? `bun test`. Skips with a note when Nix isn't installed.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { $ } from 'bun';

const nixDir = import.meta.dir;
const root = join(nixDir, '..');

if (!Bun.which('nix-instantiate') || !Bun.which('nix-build')) {
  console.log('⚠️  Nix not installed, skipping nix checks.');
  process.exit(0);
}

let failures = 0;

const check = async (name: string, body: () => Promise<void>) => {
  try {
    await body();
    console.log(`✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`❌ ${name}\n   ${error instanceof Error ? error.message : String(error)}`);
  }
};

const assertEqual = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const evalJson = async (expression: string) =>
  JSON.parse(await $`nix-instantiate --eval --strict --json -E ${expression}`.quiet().text());

await check(
  'mk-env: later module wins on package name, variables; its paths come first',
  async () => {
    const composed = await evalJson(`
    let
      pkgs = import ${nixDir}/nixpkgs.nix { };
      env = import ${nixDir}/lib/mk-env.nix {
        inherit pkgs;
        name = "check";
        modules = [
          { packages = { bun = "base"; git = "base"; }; paths = [ "/base/bin" ]; variables = { A = "base"; B = "base"; }; }
          { packages = { bun = "repo"; }; paths = [ "/repo/bin" ]; variables = { A = "repo"; }; }
        ];
      };
    in { inherit (env) packages paths variables; }`);

    assertEqual(composed, {
      packages: { bun: 'repo', git: 'base' },
      paths: ['/repo/bin', '/base/bin'],
      variables: { A: 'repo', B: 'base' },
    });
  },
);

await check('env.nix: dev-tools package set and bin/ on PATH', async () => {
  const env = await evalJson(
    `let e = import ${nixDir}/env.nix { }; in { packages = builtins.attrNames e.packages; inherit (e) paths; }`,
  );

  assertEqual(env, {
    packages: ['bun', 'git-subrepo'],
    paths: [join(root, 'bin')],
  });
});

await check('env.nix: bun comes from nixos-unstable, not the stable pin', async () => {
  const [ours, unstable] = await evalJson(
    `[ (import ${nixDir}/env.nix { }).packages.bun.version (import ${nixDir}/unstable.nix { }).bun.version ]`,
  );

  assertEqual(ours, unstable);
});

await check(
  'profile builds, with bun, git-subrepo and an env.sh that puts bin/ on PATH',
  async () => {
    const profile = (
      await $`nix-build ${join(nixDir, 'env.nix')} -A profile --no-out-link`.quiet().text()
    ).trim();

    for (const file of ['bin/bun', 'bin/git-subrepo', 'share/dev-tools/env.sh']) {
      if (!existsSync(join(profile, file))) throw new Error(`${profile} has no ${file}`);
    }
    const envScript = await Bun.file(join(profile, 'share/dev-tools/env.sh')).text();
    if (!envScript.includes(join(root, 'bin')))
      throw new Error(`env.sh doesn't add ${join(root, 'bin')}:\n${envScript}`);

    await $`${join(profile, 'bin/bun')} --version`.quiet();
  },
);

await check('install: only the shell runs pkgi, for the folders env.nix lists', async () => {
  const { install, installScript, envScript, hook } = await evalJson(`
    let e = import ${nixDir}/env.nix { }; in {
      inherit (e) install;
      installScript = builtins.readFile e.installScript;
      envScript = builtins.readFile "\${e.profile}/share/dev-tools/env.sh";
      hook = e.shell.shellHook;
    }`);

  assertEqual(install, [root]);
  const pkgi = join(root, 'bin/pkgi');
  if (!installScript.includes(`${pkgi} install --nix --if-changed`))
    throw new Error(`install script doesn't run ${pkgi}:\n${installScript}`);
  if (!installScript.includes('watch_file') || !installScript.includes('--print-watched'))
    throw new Error(`install script doesn't have direnv watch pkgi's files:\n${installScript}`);
  if (!hook.includes('-install.sh')) throw new Error(`shellHook doesn't source it:\n${hook}`);
  if (envScript.includes('pkgi')) throw new Error(`the profile's env.sh installs:\n${envScript}`);
});

await check('shell.nix evaluates to a shell with the same packages', async () => {
  await $`nix-instantiate ${join(root, 'shell.nix')}`.quiet();
});

if (failures > 0) {
  console.log(`\n${failures} nix check(s) failed.`);
  process.exit(1);
}
