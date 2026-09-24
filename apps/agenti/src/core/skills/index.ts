import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import { AGENTS_DIR } from '../repo';

/** One skill as `skills list --json` reports it, plus what the lock file adds. */
export interface InstalledSkill {
  name: string;
  path: string;
  scope: string;
  /** Display names, e.g. "Claude Code". */
  agents: string[];
  /** `owner/repo` it was installed from, when the lock file knows. */
  source?: string;
  lockedHash?: string;
  /** Its files no longer hash to what was installed. */
  hasLocalChanges?: boolean;
  /** Written in this repository rather than installed from a registry. */
  isWorkspaceOrigin?: boolean;
}

export interface SkillSearchResult {
  /** `owner/repo@skill` — exactly what `skills add` takes. */
  id: string;
  owner: string;
  repo: string;
  skillName: string;
  installs: number;
  url: string;
}

export interface SkillActionResult {
  ok: boolean;
  output: string;
}

const LOCK_FILE = 'skills-lock.json';

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (text: string) => text.replace(ANSI, '');

/**
 * Run the `skills` CLI in `root`.
 *
 * Argv rather than a shell string: a search query is user input, and the web
 * version's `exec(\`npx skills find ${query}\`)` needed a quoting helper to be
 * safe. `--yes` on npx so a first run installs it rather than stopping to ask
 * on a stdin nobody is typing into.
 */
export const runSkills = async (args: string[], root: string) => {
  const result = await exec(['npx', '--yes', 'skills', ...args], { cwd: root });
  return {
    stdout: stripAnsi(result.stdout),
    stderr: stripAnsi(result.stderr),
    ok: result.exitCode === 0,
  };
};

const combined = (result: { stdout: string; stderr: string }) =>
  [result.stdout, result.stderr].filter(Boolean).join('\n');

const collectFiles = (base: string, dir: string, out: { rel: string; content: Buffer }[]) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') collectFiles(base, full, out);
    } else if (entry.isFile()) {
      out.push({
        rel: relative(base, full).split('\\').join('/'),
        content: readFileSync(full),
      });
    }
  }
  return out;
};

const hashFiles = (files: { rel: string; content: Buffer }[]) => {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(file.rel);
    hash.update(file.content);
  }
  return hash.digest('hex');
};

/** The hash the `skills` CLI itself computes: every file's path then bytes, in path order. */
export const computeSkillFolderHash = (dir: string): string =>
  hashFiles(collectFiles(dir, dir, []));

/**
 * A skill's hash as it was in the commit that first added it — the
 * "as installed" baseline for a skill the lock file has no hash for yet.
 */
const hashFromFirstCommit = async (name: string, root: string): Promise<string | undefined> => {
  const skillDir = `${AGENTS_DIR}/skills/${name}`;
  const log = await exec(
    ['git', 'log', '--diff-filter=A', '--format=%H', '--reverse', '--', `${skillDir}/`],
    { cwd: root },
  );
  const commit = log.stdout.split('\n')[0]?.trim();
  if (!commit) return undefined;

  const tree = await exec(['git', 'ls-tree', '-r', '--name-only', commit, '--', skillDir], {
    cwd: root,
  });
  const paths = tree.stdout.split('\n').filter(Boolean);
  if (paths.length === 0) return undefined;

  const files = await Promise.all(
    paths.map(async (path) => {
      //? Bytes, not text: `exec` decodes stdout as UTF-8, which would change the
      //? hash of any file that is not
      const child = Bun.spawn(['git', 'cat-file', 'blob', `${commit}:${path}`], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const content = Buffer.from(await new Response(child.stdout).arrayBuffer());
      return { rel: path.slice(skillDir.length + 1), content };
    }),
  );
  return hashFiles(files);
};

interface LockFile {
  version?: number;
  skills?: Record<string, { source?: string; computedHash?: string; [field: string]: unknown }>;
}

const readLock = (root: string): LockFile | undefined => {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LockFile;
  } catch {
    return undefined;
  }
};

const writeLock = (root: string, lock: LockFile) =>
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);

/**
 * The repository's project-scope skills, with the lock file's view of each.
 *
 * A skill in the lock without a hash gets one seeded from the commit that first
 * added it, so "modified locally" has a baseline to compare against — but only
 * in a repository that already has a lock file. The web version created one on
 * a plain listing, which put a new tracked file into repos that had never
 * installed anything from a registry.
 */
export const listSkills = async (root: string): Promise<InstalledSkill[]> => {
  const result = await runSkills(['list', '--json', '-p'], root);
  if (!result.ok || !result.stdout.trim()) return [];

  let skills: InstalledSkill[];
  try {
    skills = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')));
  } catch {
    return [];
  }

  const lock = readLock(root);
  let lockChanged = false;

  for (const skill of skills) {
    //? The CLI reports `source: null` for anything it did not install
    if (!skill.source) delete skill.source;
    if (!lock) continue;

    lock.skills ??= {};
    let entry = lock.skills[skill.name];
    if (entry?.source) skill.source = entry.source;

    if (!entry?.computedHash) {
      const seeded = await hashFromFirstCommit(skill.name, root);
      if (seeded) {
        entry = { ...entry, computedHash: seeded };
        lock.skills[skill.name] = entry;
        lockChanged = true;
      }
    }

    if (entry?.computedHash) {
      skill.lockedHash = entry.computedHash;
      if (entry.source) {
        try {
          skill.hasLocalChanges = computeSkillFolderHash(skill.path) !== entry.computedHash;
        } catch {
          skill.hasLocalChanges = false;
        }
      } else {
        skill.isWorkspaceOrigin = true;
      }
    }
  }

  if (lock && lockChanged) writeLock(root, lock);
  return skills.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * `-a <agent>` for every agent the repo's skills are already installed for, so
 * a new or reinstalled skill lands in the same places as the rest rather than
 * wherever the CLI guesses.
 */
const agentFlags = async (root: string): Promise<string[]> => {
  const result = await runSkills(['list', '--json', '-p'], root);
  try {
    const skills = JSON.parse(result.stdout.slice(result.stdout.indexOf('['))) as InstalledSkill[];
    const agents = [...new Set(skills.flatMap((skill) => skill.agents))];
    //? The JSON has display names ("Claude Code"); `-a` wants ids ("claude-code")
    return agents.flatMap((agent) => ['-a', agent.toLowerCase().replace(/\s+/g, '-')]);
  } catch {
    return [];
  }
};

/** Record where an `owner/repo@skill` came from and what it hashed to — `skills add` does neither. */
const recordInLock = (root: string, source: string) => {
  const at = source.lastIndexOf('@');
  if (at < 0) return;
  const name = source.slice(at + 1);
  const skillDir = join(root, AGENTS_DIR, 'skills', name);
  if (!existsSync(skillDir)) return;
  const lock = readLock(root) ?? { version: 1, skills: {} };
  lock.skills ??= {};
  lock.skills[name] = {
    ...lock.skills[name],
    source: source.slice(0, at),
    sourceType: 'github',
    computedHash: computeSkillFolderHash(skillDir),
  };
  writeLock(root, lock);
};

/** Install `owner/repo@skill` (or anything else `skills add` accepts) into the project. */
export const addSkill = async (source: string, root: string): Promise<SkillActionResult> => {
  const result = await runSkills(['add', source, '-y', ...(await agentFlags(root))], root);
  if (result.ok) recordInLock(root, source);
  return { ok: result.ok, output: combined(result) };
};

export const removeSkill = async (name: string, root: string): Promise<SkillActionResult> => {
  const result = await runSkills(['remove', '-s', name, '-y', ...(await agentFlags(root))], root);
  return { ok: result.ok, output: combined(result) };
};

/**
 * Reinstall a registry skill from the source the lock file recorded.
 *
 * Remove-then-add rather than `skills update`: the update command does not
 * refresh the lock file's hash, so a skill reinstalled that way would go on
 * reporting local changes it no longer has.
 */
export const updateSkill = async (name: string, root: string): Promise<SkillActionResult> => {
  const source = readLock(root)?.skills?.[name]?.source;
  if (!source) {
    return {
      ok: false,
      output: `${LOCK_FILE} has no source for "${name}" — nothing to update from`,
    };
  }
  const flags = await agentFlags(root);
  await runSkills(['remove', '-s', name, '-y', ...flags], root);
  const result = await runSkills(['add', `${source}@${name}`, '-y', ...flags], root);
  if (result.ok) recordInLock(root, `${source}@${name}`);
  return { ok: result.ok, output: combined(result) };
};

const parseInstalls = (raw: string) =>
  raw.endsWith('K')
    ? Math.round(Number.parseFloat(raw) * 1000)
    : raw.endsWith('M')
      ? Math.round(Number.parseFloat(raw) * 1_000_000)
      : Number.parseInt(raw, 10) || 0;

/** Search the public registry. Not repository-specific, so it runs from wherever. */
export const searchSkills = async (query: string, root: string): Promise<SkillSearchResult[]> => {
  if (!query.trim()) return [];
  const result = await runSkills(['find', query], root);
  const lines = result.stdout.split('\n');
  const found: SkillSearchResult[] = [];

  lines.forEach((line, index) => {
    //? owner/repo@skill-name 11.6K installs, then the skills.sh URL on the next line
    const match = line
      .trim()
      .match(/^([\w.-]+)\/([\w.-]+)@([\w.:-]+)\s+([\d.]+[KM]?)\s+installs?$/);
    if (!match) return;
    const [, owner = '', repo = '', skillName = '', installs = '0'] = match;
    const url = lines[index + 1]?.match(/https?:\/\/\S+/)?.[0];
    found.push({
      id: `${owner}/${repo}@${skillName}`,
      owner,
      repo,
      skillName,
      installs: parseInstalls(installs),
      url: url ?? `https://skills.sh/${owner}/${repo}/${skillName}`,
    });
  });

  return found;
};

/** A skill's SKILL.md, for the detail pane. */
export const readSkillDoc = (skill: InstalledSkill): string | undefined => {
  const path = join(skill.path, 'SKILL.md');
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
};

/** The `description:` from a SKILL.md's front matter. */
export const skillDescription = (doc: string | undefined): string | undefined =>
  doc
    ?.match(/^---\n[\s\S]*?^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2');

export default listSkills;
