import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ScopeKind } from '../ides';
import { AGENTS_DIR } from '../repo';

/**
 * Where a configuration is kept: one repository, or the user's home.
 *
 * Both have the same shape — a root, an `.agents` source folder under it, an
 * `AGENTS.md` — so every operation takes a scope rather than a bare path, and
 * the same code maintains a repository's `.claude/` and the user's `~/.claude/`.
 * The user's `AGENTS.md` sits inside `~/.agents` rather than loose in `~`.
 */
export interface Scope {
  kind: ScopeKind;
  root: string;
  agentsDir: string;
  instructionsPath: string;
}

export const projectScope = (root: string): Scope => ({
  kind: 'project',
  root,
  agentsDir: join(root, AGENTS_DIR),
  instructionsPath: join(root, 'AGENTS.md'),
});

export const userScope = (home: string = homedir()): Scope => ({
  kind: 'user',
  root: home,
  agentsDir: join(home, AGENTS_DIR),
  instructionsPath: join(home, AGENTS_DIR, 'AGENTS.md'),
});

export default projectScope;
