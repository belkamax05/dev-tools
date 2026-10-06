import {
  appendFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { parseFrontMatter } from '../formats';
import { type IdeDefinition, layoutFor } from '../ides';
import { getInstructions, adoptInstructions, linkInstructions } from '../instructions';
import {
  findLiteralSecrets,
  getMcpApprovals,
  readMcpTarget,
  readSourceMcp,
  setMcpApproval,
} from '../mcp';
import type { OperationResult } from '../agents';
import type { Scope } from '../scope';
import { missingFromLock, restoreSkills } from '../skills';

export type Severity = 'error' | 'warn' | 'info';

export interface HealthIssue {
  /** Stable across runs, so a view can keep its selection after a fix. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** What the fix does, as a button label. Absent when the fix is the user's to make. */
  fixLabel?: string;
  fix?: () => OperationResult | Promise<OperationResult>;
}

/**
 * Files that must never be committed: per-user settings and secrets. Checked
 * wherever they exist; the fix ignores them, and a tracked one also needs
 * untracking, which is left to the user as a git command.
 */
export const MUST_IGNORE = ['.env.user', '.claude/settings.local.json'];

/** Rules and instructions are read on every prompt; past this they crowd out the work. */
export const TOKEN_BUDGET = 8000;

const git = (root: string, args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'ignore' });

const isGitRepo = (root: string) =>
  git(root, ['rev-parse', '--is-inside-work-tree']).exitCode === 0;

const walk = (dir: string, depth = 8, out: string[] = []): string[] => {
  if (depth < 0) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(dir, name);
    try {
      const stats = lstatSync(path);
      if (stats.isDirectory()) walk(path, depth - 1, out);
      else out.push(path);
    } catch {
      //? vanished mid-walk
    }
  }
  return out;
};

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
};

const ok = (message: string): OperationResult => ({ ok: true, message });

// ---------------------------------------------------------------------------

const gitHygiene = (scope: Scope): HealthIssue[] => {
  if (scope.kind !== 'project' || !isGitRepo(scope.root)) return [];
  const issues: HealthIssue[] = [];
  for (const rel of MUST_IGNORE) {
    if (!existsSync(join(scope.root, rel))) continue;
    const tracked = git(scope.root, ['ls-files', '--error-unmatch', rel]).exitCode === 0;
    const ignored = git(scope.root, ['check-ignore', '-q', rel]).exitCode === 0;
    if (tracked) {
      issues.push({
        id: `git-tracked:${rel}`,
        severity: 'error',
        title: `${rel} is committed`,
        detail: `It holds per-user settings or secrets. Untrack it yourself — git rm --cached ${rel} — then ignore it.`,
        fixLabel: ignored ? undefined : 'Add to .gitignore',
        fix: ignored ? undefined : () => addToGitignore(scope.root, rel),
      });
    } else if (!ignored) {
      issues.push({
        id: `git-ignore:${rel}`,
        severity: 'warn',
        title: `${rel} is not git-ignored`,
        detail: 'It holds per-user settings or secrets; one careless `git add .` commits it.',
        fixLabel: 'Add to .gitignore',
        fix: () => addToGitignore(scope.root, rel),
      });
    }
  }
  return issues;
};

const addToGitignore = (root: string, rel: string): OperationResult => {
  const path = join(root, '.gitignore');
  const current = read(path) ?? '';
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${prefix}${rel}\n`);
  return ok(`Added ${rel} to .gitignore`);
};

const secrets = (scope: Scope, ides: IdeDefinition[]): HealthIssue[] => {
  if (scope.kind !== 'project') return [];
  const files = [readSourceMcp(scope.root)];
  for (const ide of ides) {
    for (const target of ide.mcp) {
      if (target.kind !== 'file' || target.scope !== 'project') continue;
      const { file } = readMcpTarget(scope.root, target);
      if (file) files.push(file);
    }
  }
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (!file.exists || seen.has(file.path)) return [];
    seen.add(file.path);
    const found = findLiteralSecrets(file.servers);
    return found.length
      ? [
          {
            id: `secret:${file.path}`,
            severity: 'error' as const,
            title: `Secrets written into ${relative(scope.root, file.path)}`,
            detail: `${found.join(', ')}. The file is shared — use \${NAME} placeholders and keep the values in .env.user.`,
          },
        ]
      : [];
  });
};

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const skills = (scope: Scope): HealthIssue[] => {
  const dir = join(scope.agentsDir, 'skills');
  if (!existsSync(dir)) return [];
  const issues: HealthIssue[] = [];
  const byName = new Map<string, string[]>();

  for (const folder of readdirSync(dir)) {
    const skillDir = join(dir, folder);
    if (folder.startsWith('.') || !statSync(skillDir).isDirectory()) continue;
    const doc = read(join(skillDir, 'SKILL.md'));
    const at = `.agents/skills/${folder}`;
    if (doc === undefined) {
      issues.push({
        id: `skill-doc:${folder}`,
        severity: 'error',
        title: `${at} has no SKILL.md`,
        detail: 'Without it no IDE loads the skill.',
      });
      continue;
    }
    const { data } = parseFrontMatter(doc);
    const name = typeof data.name === 'string' ? data.name : undefined;
    const description = typeof data.description === 'string' ? data.description : undefined;
    byName.set(name ?? folder, [...(byName.get(name ?? folder) ?? []), folder]);
    if (!description) {
      issues.push({
        id: `skill-description:${folder}`,
        severity: 'error',
        title: `${at}: no description`,
        detail: 'The description is what an agent reads to decide whether to use the skill at all.',
      });
    } else if (description.length > 1024) {
      issues.push({
        id: `skill-description-long:${folder}`,
        severity: 'warn',
        title: `${at}: description is ${description.length} characters`,
        detail: 'Skill descriptions are capped at 1024; the rest is cut.',
      });
    }
    if (!name) {
      issues.push({
        id: `skill-name:${folder}`,
        severity: 'warn',
        title: `${at}: no name`,
        detail: 'SKILL.md front matter should name the skill.',
      });
    } else if (name !== folder) {
      issues.push({
        id: `skill-name-folder:${folder}`,
        severity: 'warn',
        title: `${at}: named "${name}"`,
        detail: 'A skill is expected to be named after its folder.',
      });
    } else if (!SKILL_NAME.test(name)) {
      issues.push({
        id: `skill-name-format:${folder}`,
        severity: 'warn',
        title: `${at}: "${name}" is not a valid skill name`,
        detail: 'Lowercase letters, digits and hyphens, at most 64.',
      });
    }
  }

  for (const [name, folders] of byName) {
    if (folders.length > 1) {
      issues.push({
        id: `skill-duplicate:${name}`,
        severity: 'error',
        title: `Skill "${name}" is defined ${folders.length} times`,
        detail: `In ${folders.join(', ')} — only one of them will be used.`,
      });
    }
  }
  return issues;
};

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const brokenLinks = (scope: Scope): HealthIssue[] => {
  const files = [...walk(scope.agentsDir), scope.instructionsPath].filter(
    (path) => path.endsWith('.md') && existsSync(path),
  );
  const issues: HealthIssue[] = [];
  for (const file of files) {
    const text = read(file) ?? '';
    const broken = new Set<string>();
    for (const match of text.matchAll(LINK)) {
      const href = match[1] ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('<'))
        continue;
      const path = decodeURIComponent(href.split('#')[0] ?? '');
      if (path && !existsSync(join(dirname(file), path))) broken.add(href);
    }
    if (broken.size) {
      const rel = relative(scope.root, file);
      issues.push({
        id: `links:${rel}`,
        severity: 'warn',
        title: `${rel}: ${broken.size} broken link${broken.size === 1 ? '' : 's'}`,
        detail: [...broken].slice(0, 5).join(', '),
      });
    }
  }
  return issues;
};

/** Roughly: a token is four characters of English. Good enough to see an outlier. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const tokenBudget = (scope: Scope): HealthIssue[] => {
  const files = [...walk(join(scope.agentsDir, 'rules')), scope.instructionsPath].filter(
    (path) => path.endsWith('.md') && existsSync(path),
  );
  const sized = files
    .map((path) => ({ path, tokens: estimateTokens(read(path) ?? '') }))
    .sort((a, b) => b.tokens - a.tokens);
  const total = sized.reduce((sum, file) => sum + file.tokens, 0);
  if (total <= TOKEN_BUDGET) return [];
  return [
    {
      id: 'tokens',
      severity: 'warn',
      title: `Rules and AGENTS.md are ~${total.toLocaleString()} tokens`,
      detail: `Read on every prompt, over the ${TOKEN_BUDGET.toLocaleString()} budget. Largest: ${sized
        .slice(0, 3)
        .map((file) => `${relative(scope.root, file.path)} (~${file.tokens.toLocaleString()})`)
        .join(', ')}. Move detail into skills, which load only when relevant.`,
    },
  ];
};

/** Links in an IDE folder into `.agents` that its layout no longer reads, or that dangle. */
const staleLinks = (scope: Scope, ides: IdeDefinition[]): HealthIssue[] => {
  const issues: HealthIssue[] = [];
  let agentsReal: string | undefined;
  try {
    agentsReal = realpathSync(scope.agentsDir);
  } catch {
    agentsReal = undefined;
  }
  for (const ide of ides) {
    const layout = layoutFor(ide, scope.kind);
    if (!layout || 'mirror' in layout.agents) continue;
    const targets = layout.agents.map((m) => join(scope.root, m.target));
    const folder = join(scope.root, ide.folder);
    let entries: string[] = [];
    try {
      entries = readdirSync(folder).map((name) => join(folder, name));
    } catch {
      continue;
    }
    for (const path of entries) {
      let stats: ReturnType<typeof lstatSync>;
      try {
        stats = lstatSync(path);
      } catch {
        continue;
      }
      if (!stats.isSymbolicLink()) continue;
      let resolved: string | undefined;
      try {
        resolved = realpathSync(path);
      } catch {
        resolved = undefined;
      }
      const dangling = resolved === undefined;
      const intoAgents =
        resolved &&
        agentsReal &&
        (resolved === agentsReal || resolved.startsWith(agentsReal + sep));
      const read = targets.some((target) => target === path || target.startsWith(path + sep));
      if (dangling || (intoAgents && !read)) {
        const rel = relative(scope.root, path);
        issues.push({
          id: `stale:${rel}`,
          severity: 'warn',
          title: `${rel} is a ${dangling ? 'dangling link' : 'link nothing reads'}`,
          detail: dangling
            ? 'It points at something that no longer exists.'
            : `${ide.name} does not read ${rel} — left over from an older layout.`,
          fixLabel: 'Remove the link',
          fix: () => {
            unlinkSync(path);
            return ok(`Removed ${rel}`);
          },
        });
      }
    }
  }
  return issues;
};

const instructions = (scope: Scope, ides: IdeDefinition[]): HealthIssue[] =>
  ides.flatMap((ide): HealthIssue[] => {
    const state = getInstructions(scope, ide);
    const rel = state.targetPath ? relative(scope.root, state.targetPath) : '';
    if (state.status === 'no-source' && state.targetHasContent) {
      return [
        {
          id: `instructions-adopt:${ide.id}`,
          severity: 'info',
          title: `${rel} could become AGENTS.md`,
          detail: `There is no AGENTS.md; moving ${rel} there shares it with every IDE.`,
          fixLabel: `Adopt ${rel}`,
          fix: () => adoptInstructions(state),
        },
      ];
    }
    if (state.status === 'missing') {
      return [
        {
          id: `instructions-missing:${ide.id}`,
          severity: 'info',
          title: `${ide.name} does not see AGENTS.md`,
          detail: `Create ${rel} ${state.mode === 'import' ? 'importing' : 'linking to'} it.`,
          fixLabel: `Create ${rel}`,
          fix: () => linkInstructions(state),
        },
      ];
    }
    if (state.status === 'mismatch') {
      return [
        {
          id: `instructions-mismatch:${ide.id}`,
          severity: 'warn',
          title: `${rel} does not ${state.mode === 'import' ? 'import' : 'link to'} AGENTS.md`,
          detail:
            state.mode === 'import'
              ? 'The import can go on top, keeping everything the file already says.'
              : 'Its content would be replaced by the link — review it on the Agents tab.',
          fixLabel: state.mode === 'import' ? 'Add the import' : undefined,
          fix: state.mode === 'import' ? () => linkInstructions(state) : undefined,
        },
      ];
    }
    return [];
  });

const approvals = (scope: Scope, ides: IdeDefinition[]): HealthIssue[] => {
  if (scope.kind !== 'project' || !ides.some((ide) => ide.id === 'claude-code')) return [];
  const claude = ides.find((ide) => ide.id === 'claude-code');
  const target = claude?.mcp.find((t) => t.kind === 'file' && t.scope === 'project');
  if (!target) return [];
  const servers = Object.keys(readMcpTarget(scope.root, target).servers);
  const states = getMcpApprovals(scope.root, servers);
  return servers
    .filter((name) => states[name] === 'pending')
    .map((name) => ({
      id: `approval:${name}`,
      severity: 'warn' as const,
      title: `MCP server "${name}" is waiting for approval`,
      detail: 'Claude Code will not start it until it is approved for this repository.',
      fixLabel: 'Approve (settings.local.json)',
      fix: () => setMcpApproval(scope.root, name, true),
    }));
};

const lockedSkills = (scope: Scope): HealthIssue[] => {
  if (scope.kind !== 'project') return [];
  const missing = missingFromLock(scope.root);
  return missing.length
    ? [
        {
          id: 'skills-restore',
          severity: 'warn',
          title: `${missing.length} locked skill${missing.length === 1 ? ' is' : 's are'} not installed`,
          detail: `${missing.join(', ')} — listed in skills-lock.json but missing from .agents/skills.`,
          fixLabel: 'Restore from skills-lock.json',
          fix: async () => {
            const result = await restoreSkills(scope.root);
            return {
              ok: result.ok,
              message: result.ok ? 'Restored skills from the lock file' : result.output,
            };
          },
        },
      ]
    : [];
};

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Everything worth fixing about a scope, for the IDEs it is set up for — worst first. */
export const getHealth = (scope: Scope, ides: IdeDefinition[]): HealthIssue[] =>
  [
    ...gitHygiene(scope),
    ...secrets(scope, ides),
    ...approvals(scope, ides),
    ...lockedSkills(scope),
    ...instructions(scope, ides),
    ...staleLinks(scope, ides),
    ...skills(scope),
    ...brokenLinks(scope),
    ...tokenBudget(scope),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

export default getHealth;
