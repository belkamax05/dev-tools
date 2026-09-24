import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { FormatId } from '../formats';

/** Which side of the line a configuration lives on. */
export type ScopeKind = 'project' | 'user';

/**
 * One entry of `.agents` and where an IDE reads it from.
 *
 * `target` is relative to the scope's root — the repository, or the home
 * directory — so an IDE whose files live outside its own folder (Copilot reads
 * `.github/instructions`) is described the same way as one whose do not.
 * Several sources may share a target (`workflows` and `commands` both land in
 * `.claude/commands`).
 */
export interface AgentsMapping {
  source: string;
  target: string;
  /** Converted into the IDE's own format rather than linked — see `core/formats`. */
  format?: FormatId;
}

/**
 * The IDE's own instructions file, and how it points at `AGENTS.md`.
 *
 * - `import`: a file whose first line is `@<path to AGENTS.md>` (Claude Code's
 *   import syntax), leaving room under it for anything IDE-specific
 * - `link`: a symlink to `AGENTS.md`
 * - `native`: the IDE reads `AGENTS.md` itself; nothing to maintain
 */
export type InstructionsTarget = { path: string; mode: 'import' | 'link' } | 'native';

export interface IdeLayout {
  /** Per-entry mappings, or `{ mirror }`: the whole of `.agents`, 1:1, into one folder. */
  agents: AgentsMapping[] | { mirror: string };
  instructions?: InstructionsTarget;
}

/**
 * Where an IDE keeps MCP servers at one scope.
 *
 * - `file`: a JSON file this tool reads and writes, servers under `key`
 * - `claude-cli`: Claude Code's own `~/.claude.json`, which Claude Code rewrites
 *   constantly while it runs — read directly, but written only through
 *   `claude mcp add-json` / `claude mcp remove`, never by hand
 */
export type IdeMcpTarget =
  | {
      scope: 'project' | 'user';
      kind: 'file';
      key: 'mcpServers' | 'servers';
      path: (root: string) => string;
    }
  | { scope: 'local' | 'user'; kind: 'claude-cli' };

export interface IdeDefinition {
  id: string;
  name: string;
  /** The folder that says "this IDE is set up here", and where directory-link mode points. */
  folder: string;
  /** Binaries that mean it is installed, most specific first. */
  commands: string[];
  layouts: { project: IdeLayout; user?: IdeLayout };
  /** Every scope this IDE reads MCP servers from, the shared one first. */
  mcp: IdeMcpTarget[];
  /** A terminal program (`claude`) takes over the terminal; a GUI one is launched beside it. */
  launch: 'terminal' | 'gui';
  /**
   * The logo is a single-colour mark in black (Cursor's and Devin's are), which
   * a dark terminal would show as nothing — drawn tinted instead.
   */
  monochromeLogo?: boolean;
}

/** `assets/img/<id>.png` in this app — 512px, transparent; see the README there. */
export const logoPath = (ide: IdeDefinition): string =>
  join(import.meta.dir, '..', '..', '..', 'assets', 'img', `${ide.id}.png`);

//? Claude Code has no "workflows"; a workflow is a prompt you invoke, which is
//? exactly what a slash command is, so both land in commands/
const CLAUDE_AGENTS: AgentsMapping[] = [
  { source: 'rules', target: '.claude/rules' },
  { source: 'skills', target: '.claude/skills' },
  { source: 'agents', target: '.claude/agents' },
  { source: 'commands', target: '.claude/commands' },
  { source: 'workflows', target: '.claude/commands' },
  //? Permissions, hooks and env — Claude Code's settings format, shared the
  //? same way as everything else here; `settings.local.json` stays per user
  { source: 'settings.json', target: '.claude/settings.json' },
];

/**
 * The IDEs agenti knows, and what each reads from where.
 *
 * Layouts are what each IDE documents; where one reads `AGENTS.md` itself it is
 * marked `native` rather than given a file to keep in step. Anything in
 * `.agents` an IDE has no place for is shown as unused rather than linked
 * somewhere it will never be read.
 */
export const IDES: readonly IdeDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    folder: '.claude',
    commands: ['claude'],
    layouts: {
      project: {
        agents: CLAUDE_AGENTS,
        instructions: { path: 'CLAUDE.md', mode: 'import' },
      },
      //? The same folder names under ~/.claude, and ~/.claude/CLAUDE.md for
      //? instructions that apply in every repository
      user: {
        agents: CLAUDE_AGENTS,
        instructions: { path: '.claude/CLAUDE.md', mode: 'import' },
      },
    },
    mcp: [
      {
        scope: 'project',
        kind: 'file',
        key: 'mcpServers',
        path: (root) => join(root, '.mcp.json'),
      },
      { scope: 'local', kind: 'claude-cli' },
      { scope: 'user', kind: 'claude-cli' },
    ],
    launch: 'terminal',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    folder: '.cursor',
    commands: ['cursor'],
    monochromeLogo: true,
    layouts: {
      project: {
        agents: [
          { source: 'rules', target: '.cursor/rules', format: 'cursor-mdc' },
          { source: 'commands', target: '.cursor/commands' },
          { source: 'workflows', target: '.cursor/commands' },
        ],
        instructions: 'native',
      },
      //? Cursor's user rules live in its settings UI, not in files
    },
    mcp: [
      {
        scope: 'project',
        kind: 'file',
        key: 'mcpServers',
        path: (root) => join(root, '.cursor', 'mcp.json'),
      },
      {
        scope: 'user',
        kind: 'file',
        key: 'mcpServers',
        path: () => join(homedir(), '.cursor', 'mcp.json'),
      },
    ],
    launch: 'gui',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    folder: '.agent',
    commands: ['antigravity', 'agy'],
    layouts: {
      project: {
        agents: [
          { source: 'rules', target: '.agent/rules' },
          { source: 'workflows', target: '.agent/workflows' },
        ],
        //? The Gemini family's context file
        instructions: { path: 'GEMINI.md', mode: 'link' },
      },
    },
    mcp: [
      {
        scope: 'user',
        kind: 'file',
        key: 'mcpServers',
        path: () => join(homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
      },
    ],
    launch: 'gui',
  },
  {
    id: 'devin',
    name: 'Devin',
    folder: '.devin',
    commands: ['devin-desktop', 'devin'],
    monochromeLogo: true,
    layouts: {
      //? No published per-folder layout to map onto, so `.agents` goes in whole
      project: { agents: { mirror: '.devin' }, instructions: 'native' },
    },
    mcp: [
      {
        scope: 'user',
        kind: 'file',
        key: 'mcpServers',
        path: () => join(homedir(), '.config', 'devin', 'mcp_config.json'),
      },
    ],
    launch: 'gui',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    folder: '.github',
    commands: ['code'],
    layouts: {
      //? GitHub Copilot's layout: instruction files and prompt files under
      //? .github, each with its own suffix and front matter
      project: {
        agents: [
          { source: 'rules', target: '.github/instructions', format: 'copilot-instructions' },
          { source: 'commands', target: '.github/prompts', format: 'copilot-prompt' },
          { source: 'workflows', target: '.github/prompts', format: 'copilot-prompt' },
        ],
        instructions: { path: '.github/copilot-instructions.md', mode: 'link' },
      },
    },
    mcp: [
      {
        scope: 'project',
        kind: 'file',
        key: 'servers',
        path: (root) => join(root, '.vscode', 'mcp.json'),
      },
    ],
    launch: 'gui',
  },
];

/**
 * Directories a GUI-launched binary is often in without being on this shell's
 * PATH. `Bun.which` only searches PATH, and an IDE installed by a desktop
 * package is the usual case for one that is missing from it.
 */
const FALLBACK_BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')];

/** The first of `ide.commands` found, as a path, or undefined when none is. */
export const findIdeBinary = (ide: IdeDefinition): string | undefined => {
  for (const command of ide.commands) {
    const onPath = Bun.which(command);
    if (onPath) return onPath;
    for (const dir of FALLBACK_BIN_DIRS) {
      const candidate = join(dir, command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
};

export const getIde = (id: string | undefined): IdeDefinition | undefined =>
  IDES.find((ide) => ide.id === id);

/** The IDE's layout at a scope, or undefined when it keeps nothing in files there. */
export const layoutFor = (ide: IdeDefinition, scope: ScopeKind): IdeLayout | undefined =>
  ide.layouts[scope];

/** Its MCP targets that belong to a scope: project/local for a repository, user for home. */
export const mcpTargetsFor = (ide: IdeDefinition, scope: ScopeKind): IdeMcpTarget[] =>
  ide.mcp.filter((target) =>
    scope === 'user' ? target.scope === 'user' : target.scope !== 'user',
  );

export default IDES;
