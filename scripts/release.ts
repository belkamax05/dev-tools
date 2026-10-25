import { join } from 'node:path';
import { $ } from 'bun';

// Bump package.json's version, commit, tag v<version> and push both - the tag
// push is what runs .github/workflows/publish.yml. Run from a clean master:
//   bun run release              patch: 0.1.0 -> 0.1.1
//   bun run release minor        0.1.0 -> 0.2.0
//   bun run release major        0.1.0 -> 1.0.0
//   bun run release 0.3.0        exactly that; the current version tags it as is
//   --dry-run                    say what would happen, change nothing
//   --no-push                    commit and tag locally only

const BUMPS = ['patch', 'minor', 'major'] as const;
type Bump = (typeof BUMPS)[number];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const push = !args.includes('--no-push');
const target = args.find((arg) => !arg.startsWith('--')) ?? 'patch';

const fail = (message: string): never => {
  console.error(`release: ${message}`);
  process.exit(1);
};

const bump = (version: string, kind: Bump): string => {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const root = join(import.meta.dir, '..');
$.cwd(root);
const pkgPath = join(root, 'package.json');
const pkgText = await Bun.file(pkgPath).text();
const current: string = JSON.parse(pkgText).version ?? fail('package.json has no version');

const next = BUMPS.includes(target as Bump)
  ? bump(current, target as Bump)
  : /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target)
    ? target
    : fail(`"${target}" is not ${BUMPS.join('/')} or a x.y.z version`);
const tag = `v${next}`;

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
if (branch !== 'master') fail(`on ${branch}, release from master`);
if ((await $`git status --porcelain`.text()).trim()) fail('working tree not clean - commit or stash first');
if ((await $`git tag --list ${tag}`.text()).trim()) fail(`tag ${tag} already exists`);
if (push) {
  await $`git fetch --quiet origin master --tags`;
  if ((await $`git ls-remote --tags origin ${tag}`.text()).trim()) fail(`tag ${tag} already on origin`);
  const behind = Number((await $`git rev-list --count HEAD..origin/master`.text()).trim());
  if (behind > 0) fail(`master is ${behind} commit(s) behind origin - pull first`);
}

const bumping = next !== current;
console.log(`release: ${bumping ? `${current} -> ${next}` : `tagging ${current} as is`}, tag ${tag}${push ? ', push' : ''}`);
if (dryRun) process.exit(0);

if (bumping) {
  // Replace the field in place, so the rest of package.json keeps its formatting.
  await Bun.write(pkgPath, pkgText.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
  await $`git commit --quiet -m ${`release ${tag}`} -- package.json`;
}
await $`git tag -a ${tag} -m ${tag}`;
if (push) {
  // --atomic: the commit and the tag land together or not at all.
  await $`git push --atomic origin master ${tag}`;
  console.log(`release: pushed ${tag} - publish runs at https://github.com/belkamax05/dev-tools/actions`);
} else {
  console.log(`release: tagged ${tag} locally - push with: git push --atomic origin master ${tag}`);
}
