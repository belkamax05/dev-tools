import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where an IDE reads its MCP servers from, and under which key. */
export interface IdeMcpTarget {
  /**
   * `project` files live in the repository and are shared with everyone who
   * clones it; `user` files are per machine and shared across every repository.
   * Worth showing, because copying a server into a `user` file turns it on
   * everywhere, not just here.
   */
  scope: 'project' | 'user';
  /** The file, for a given repository root. */
  path: (root: string) => string;
  /**
   * The object inside the file that holds the servers. VS Code calls it
   * `servers`; everything else here calls it `mcpServers`.
   */
  key: 'mcpServers' | 'servers';
}

export interface IdeDefinition {
  id: string;
  name: string;
  /**
   * The folder in the repository this IDE reads agent files from. `.agents` is
   * the source of truth and is linked into it — see `core/agents`.
   */
  folder: string;
  /** Binaries that mean it is installed, most specific first. */
  commands: string[];
  /** Undefined for an IDE with no MCP config this tool knows how to manage. */
  mcp?: IdeMcpTarget;
  /**
   * The logo is a single-colour mark in black (Cursor's and Devin's are), which
   * a dark terminal would show as nothing — drawn tinted instead.
   */
  monochromeLogo?: boolean;
}

/** `assets/img/<id>.png` in this app — 512px, transparent; see the README there. */
export const logoPath = (ide: IdeDefinition): string =>
  join(import.meta.dir, '..', '..', '..', 'assets', 'img', `${ide.id}.png`);

/**
 * The IDEs agenti can link `.agents` into.
 *
 * The first five are shulker-controller's `system/config/agents.ts`, with the
 * same folders; the MCP paths are its `getIdeMcpPaths` plus the project files
 * Cursor and VS Code read, which it did not cover.
 */
export const IDES: readonly IdeDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    folder: '.claude',
    commands: ['claude'],
    //? Claude Code reads project-scope servers from .mcp.json at the repo root,
    //? not from inside .claude/
    mcp: {
      scope: 'project',
      key: 'mcpServers',
      path: (root) => join(root, '.mcp.json'),
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    folder: '.cursor',
    commands: ['cursor'],
    monochromeLogo: true,
    mcp: {
      scope: 'project',
      key: 'mcpServers',
      path: (root) => join(root, '.cursor', 'mcp.json'),
    },
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    folder: '.agent',
    commands: ['antigravity', 'agy'],
    mcp: {
      scope: 'user',
      key: 'mcpServers',
      path: () => join(homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
    },
  },
  {
    id: 'devin',
    name: 'Devin',
    folder: '.devin',
    commands: ['devin-desktop', 'devin'],
    monochromeLogo: true,
    mcp: {
      scope: 'user',
      key: 'mcpServers',
      path: () => join(homedir(), '.config', 'devin', 'mcp_config.json'),
    },
  },
  {
    id: 'vscode',
    name: 'VS Code',
    folder: '.vscode',
    commands: ['code'],
    mcp: {
      scope: 'project',
      key: 'servers',
      path: (root) => join(root, '.vscode', 'mcp.json'),
    },
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

export default IDES;
