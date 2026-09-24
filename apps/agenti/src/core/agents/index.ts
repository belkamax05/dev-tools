import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  type Stats,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import type { IdeDefinition } from '../ides';
import { AGENTS_DIR } from '../repo';

/**
 * How one entry of `.agents` stands in the IDE's folder.
 *
 * - `synced` — linked to the source, or an identical copy of it
 * - `mismatch` — a real file whose content differs from the source
 * - `missing` — not in the IDE folder at all
 * - `implicit` — a directory whose children disagree (some synced, some not)
 * - `orphan` — in the IDE folder only, with nothing in `.agents` behind it
 * - `unknown` — present but unreadable, a dangling link, or a file where the
 *   source has a directory
 */
export type AgentStatus = 'synced' | 'mismatch' | 'missing' | 'implicit' | 'orphan' | 'unknown';

/**
 * `directory` when the whole IDE folder is one link to `.agents` (1:1, nothing
 * of its own); `granular` when it is a real folder holding per-entry links.
 */
export type LinkMode = 'granular' | 'directory';

export interface AgentNode {
  name: string;
  /** Relative to both roots, e.g. `rules/styling.md`. */
  relativePath: string;
  type: 'file' | 'directory';
  status: AgentStatus;
  /** In `.agents`. Does not exist for an orphan. */
  sourcePath: string;
  /** In the IDE folder. */
  targetPath: string;
  /** What the target link says, as written, when the target is a symlink. */
  linkTarget?: string;
  /** The target resolves to the source — through its own link or a linked parent. */
  isLinked: boolean;
  children?: AgentNode[];
}

export interface Inventory {
  sourceDir: string;
  targetDir: string;
  mode: LinkMode;
  /** False until the repository has an `.agents` folder at all. */
  hasSource: boolean;
  nodes: AgentNode[];
  /** Files only — a directory's status is a summary of these. */
  counts: Record<AgentStatus, number>;
}

export interface OperationResult {
  ok: boolean;
  message: string;
}

const done = (message: string): OperationResult => ({ ok: true, message });
const refused = (message: string): OperationResult => ({ ok: false, message });

const lstatOrUndefined = (path: string): Stats | undefined => {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
};

const realpathOrUndefined = (path: string): string | undefined => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/** Both paths exist and are the same file once every link is followed. */
const resolvesTo = (target: string, source: string): boolean => {
  const a = realpathOrUndefined(target);
  return a !== undefined && a === realpathOrUndefined(source);
};

const sameBytes = (a: string, b: string): boolean => {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
};

/**
 * Create `target` as a link to `source`, written relative to the link's own
 * directory.
 *
 * Relative rather than absolute — the web version used absolute ones — because
 * these links are usually committed: `.claude/skills -> ../.agents/skills`
 * works in every clone, `/home/you/dev/repo/.agents/skills` works in yours.
 */
const linkRelative = (source: string, target: string, isDirectory: boolean) => {
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(relative(dirname(target), source), target, isDirectory ? 'dir' : 'file');
};

/** Hidden entries are an IDE's own business (`.DS_Store`, a `.gitkeep`), never agent files. */
const listNames = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
};

const byTypeThenName = (a: AgentNode, b: AgentNode) => {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
};

/** Everything under a target-only directory, which is all orphaned with it. */
const scanOrphans = (sourceRoot: string, targetRoot: string, rel: string): AgentNode[] =>
  listNames(join(targetRoot, rel))
    .map((name): AgentNode => {
      const relativePath = rel ? `${rel}/${name}` : name;
      const targetPath = join(targetRoot, relativePath);
      const stats = lstatOrUndefined(targetPath);
      const isDirectory = Boolean(stats?.isDirectory());
      return {
        name,
        relativePath,
        type: isDirectory ? 'directory' : 'file',
        status: 'orphan',
        sourcePath: join(sourceRoot, relativePath),
        targetPath,
        linkTarget: stats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined,
        isLinked: false,
        children: isDirectory ? scanOrphans(sourceRoot, targetRoot, relativePath) : undefined,
      };
    })
    .sort(byTypeThenName);

const summarise = (children: AgentNode[], targetExists: boolean): AgentStatus => {
  //? An empty directory has no children to vote, and `every` on nothing is
  //? true — which would call an empty `.agents/workflows` "synced" whether or
  //? not the IDE has one.
  if (children.length === 0) return targetExists ? 'synced' : 'missing';
  if (children.some((c) => c.status === 'mismatch' || c.status === 'unknown')) return 'mismatch';
  if (children.every((c) => c.status === 'synced')) return 'synced';
  if (children.every((c) => c.status === 'missing')) return 'missing';
  return 'implicit';
};

const scan = (sourceRoot: string, targetRoot: string, rel: string): AgentNode[] => {
  const sourceDir = join(sourceRoot, rel);
  const targetDir = join(targetRoot, rel);
  const nodes: AgentNode[] = [];

  for (const name of listNames(sourceDir)) {
    const relativePath = rel ? `${rel}/${name}` : name;
    const sourcePath = join(sourceDir, name);
    const targetPath = join(targetDir, name);

    let sourceStats: Stats;
    try {
      sourceStats = statSync(sourcePath);
    } catch {
      continue; //? a dangling link inside .agents is nothing to sync
    }

    const targetStats = lstatOrUndefined(targetPath);
    const linkTarget = targetStats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined;
    const isLinked = resolvesTo(targetPath, sourcePath);

    if (sourceStats.isDirectory()) {
      const children = scan(sourceRoot, targetRoot, relativePath);
      nodes.push({
        name,
        relativePath,
        type: 'directory',
        status: summarise(children, existsSync(targetPath)),
        sourcePath,
        targetPath,
        linkTarget,
        isLinked,
        children,
      });
      continue;
    }

    let status: AgentStatus;
    if (!targetStats) status = 'missing';
    else if (isLinked) status = 'synced';
    else if (!existsSync(targetPath))
      status = 'unknown'; //? dangling link
    else if (statSync(targetPath).isDirectory()) status = 'unknown';
    else status = sameBytes(sourcePath, targetPath) ? 'synced' : 'mismatch';

    nodes.push({
      name,
      relativePath,
      type: 'file',
      status,
      sourcePath,
      targetPath,
      linkTarget,
      isLinked,
    });
  }

  //? A target directory that *is* the source directory (linked) lists the same
  //? entries, so there is nothing of its own to report as orphaned.
  if (!resolvesTo(targetDir, sourceDir)) {
    const known = new Set(nodes.map((node) => node.name));
    for (const orphan of scanOrphans(sourceRoot, targetRoot, rel)) {
      if (!known.has(orphan.name)) nodes.push(orphan);
    }
  }

  return nodes.sort(byTypeThenName);
};

const countFiles = (nodes: AgentNode[], counts: Record<AgentStatus, number>) => {
  for (const node of nodes) {
    if (node.type === 'file') counts[node.status] += 1;
    if (node.children) countFiles(node.children, counts);
  }
  return counts;
};

export const getSourceDir = (root: string) => join(root, AGENTS_DIR);
export const getTargetDir = (root: string, ide: IdeDefinition) => join(root, ide.folder);

export const getLinkMode = (root: string, ide: IdeDefinition): LinkMode => {
  const targetDir = getTargetDir(root, ide);
  return lstatOrUndefined(targetDir)?.isSymbolicLink() && resolvesTo(targetDir, getSourceDir(root))
    ? 'directory'
    : 'granular';
};

/** `.agents` against the IDE's folder, entry by entry. */
export const getInventory = (root: string, ide: IdeDefinition): Inventory => {
  const sourceDir = getSourceDir(root);
  const targetDir = getTargetDir(root, ide);
  //? Without an .agents yet, the IDE folder's content is all "orphaned" — which
  //? is what makes adopting it the way to create one
  const nodes = existsSync(sourceDir)
    ? scan(sourceDir, targetDir, '')
    : scanOrphans(sourceDir, targetDir, '');
  return {
    sourceDir,
    targetDir,
    mode: getLinkMode(root, ide),
    hasSource: existsSync(sourceDir),
    nodes,
    counts: countFiles(nodes, {
      synced: 0,
      mismatch: 0,
      missing: 0,
      implicit: 0,
      orphan: 0,
      unknown: 0,
    }),
  };
};

/** Depth-first walk, for finding a node by path or collecting a subtree. */
export const flattenNodes = (nodes: AgentNode[]): AgentNode[] =>
  nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);

/**
 * Replace the nearest linked ancestor of `targetPath` with a real directory of
 * per-entry links, so one entry under it can be changed on its own.
 *
 * `.claude/skills -> ../.agents/skills` is one link for the whole folder;
 * turning off a single skill means the folder has to stop being that link
 * first, with every *other* skill still linked afterwards. Repeats until the
 * parent of `targetPath` is a real directory, since the links it creates for
 * a deeper path are themselves directory links.
 */
const materializeLinkedAncestors = (targetRoot: string, targetPath: string) => {
  const parts = relative(targetRoot, dirname(targetPath)).split(sep).filter(Boolean);
  let dir = targetRoot;
  for (const part of parts) {
    dir = join(dir, part);
    if (!lstatOrUndefined(dir)?.isSymbolicLink()) continue;
    const resolved = realpathOrUndefined(dir);
    unlinkSync(dir);
    mkdirSync(dir);
    if (!resolved) continue;
    for (const name of readdirSync(resolved)) {
      const source = join(resolved, name);
      linkRelative(source, join(dir, name), statSync(source).isDirectory());
    }
  }
};

const enable = (sourcePath: string, targetPath: string, skipped: string[]) => {
  const sourceIsDir = statSync(sourcePath).isDirectory();
  const target = lstatOrUndefined(targetPath);

  if (!target) return linkRelative(sourcePath, targetPath, sourceIsDir);

  if (target.isSymbolicLink()) {
    if (resolvesTo(targetPath, sourcePath)) return;
    //? A link to somewhere else, or to nothing, holds no content of its own —
    //? replacing it loses nothing
    unlinkSync(targetPath);
    return linkRelative(sourcePath, targetPath, sourceIsDir);
  }

  if (sourceIsDir && target.isDirectory()) {
    //? Link the children one by one rather than replacing the directory: it may
    //? hold orphans of the IDE's own, and rm -rf'ing them to make room for a
    //? link is exactly the data loss this tool must never cause
    for (const name of readdirSync(sourcePath)) {
      enable(join(sourcePath, name), join(targetPath, name), skipped);
    }
    return;
  }

  if (!sourceIsDir && target.isFile() && sameBytes(sourcePath, targetPath)) {
    unlinkSync(targetPath);
    return linkRelative(sourcePath, targetPath, false);
  }

  skipped.push(targetPath);
};

const disable = (sourcePath: string, targetPath: string, skipped: string[]) => {
  const target = lstatOrUndefined(targetPath);
  if (!target) return;

  if (target.isSymbolicLink()) {
    if (resolvesTo(targetPath, sourcePath) || !existsSync(targetPath)) unlinkSync(targetPath);
    else skipped.push(targetPath);
    return;
  }

  if (target.isDirectory()) {
    if (existsSync(sourcePath) && statSync(sourcePath).isDirectory()) {
      for (const name of readdirSync(sourcePath)) {
        disable(join(sourcePath, name), join(targetPath, name), skipped);
      }
    }
    //? Only removed once nothing is left in it — whatever stayed is the IDE's own
    if (readdirSync(targetPath).length === 0) rmdirSync(targetPath);
    return;
  }

  if (sameBytes(sourcePath, targetPath)) unlinkSync(targetPath);
  else skipped.push(targetPath);
};

/** "a, b, c and 2 more", relative to the IDE folder. */
const listPaths = (paths: string[], targetRoot: string) => {
  const names = paths.map((path) => relative(targetRoot, path));
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return `${names.slice(0, 3).join(', ')}${more}`;
};

const describeSkipped = (verb: string, skipped: string[], targetRoot: string) =>
  `${verb}, except ${listPaths(skipped, targetRoot)} — they differ from .agents; adopt or push them first`;

/**
 * Link a node into the IDE folder (`on`), or take it out (`off`).
 *
 * Never destroys content the IDE folder has that `.agents` does not: a file that
 * differs from its source is skipped and reported, not overwritten or deleted.
 * That is the one deliberate departure from the web version, which removed
 * whatever was in the way.
 */
export const toggleLink = (inventory: Inventory, node: AgentNode, on: boolean): OperationResult => {
  if (inventory.mode === 'directory') {
    return refused('The whole folder is one link to .agents — switch to granular mode first');
  }
  if (node.status === 'orphan') {
    return refused(`${node.relativePath} is not in .agents — adopt it to bring it in`);
  }
  try {
    const skipped: string[] = [];
    materializeLinkedAncestors(inventory.targetDir, node.targetPath);
    if (on) enable(node.sourcePath, node.targetPath, skipped);
    else disable(node.sourcePath, node.targetPath, skipped);
    const verb = on ? `Linked ${node.relativePath}` : `Unlinked ${node.relativePath}`;
    return skipped.length
      ? refused(describeSkipped(verb, skipped, inventory.targetDir))
      : done(verb);
  } catch (error) {
    return refused((error as Error).message);
  }
};

/**
 * Copy content one way across a node: `push` from `.agents` into the IDE
 * folder, `pull` (adopt) from the IDE folder into `.agents`.
 *
 * On a directory, only the files that disagree are copied — mismatches either
 * way, and orphans when pulling — so pushing a folder never clobbers a file
 * that was already fine, or already a link.
 */
export const syncNode = (
  inventory: Inventory,
  node: AgentNode,
  direction: 'push' | 'pull',
): OperationResult => {
  try {
    if (direction === 'pull' && node.status === 'orphan') {
      //? An orphan directory comes over whole, the way it stands in the IDE folder
      mkdirSync(dirname(node.sourcePath), { recursive: true });
      cpSync(node.targetPath, node.sourcePath, {
        recursive: true,
        dereference: true,
      });
      return done(`Adopted ${node.relativePath} into .agents`);
    }

    const files = flattenNodes([node]).filter(
      (n) =>
        n.type === 'file' &&
        (n.status === 'mismatch' || (direction === 'pull' && n.status === 'orphan')),
    );
    if (files.length === 0) return refused(`Nothing in ${node.relativePath} differs`);

    for (const file of files) {
      const [from, to] =
        direction === 'push'
          ? [file.sourcePath, file.targetPath]
          : [file.targetPath, file.sourcePath];
      mkdirSync(dirname(to), { recursive: true });
      //? A link at the destination would be written *through*, into whatever it
      //? points at — which for a stray link is some other repository's file
      if (lstatOrUndefined(to)?.isSymbolicLink()) unlinkSync(to);
      copyFileSync(from, to);
    }
    const what = files.length === 1 ? node.relativePath : `${files.length} files`;
    return done(
      direction === 'push' ? `Pushed ${what} to the IDE` : `Adopted ${what} into .agents`,
    );
  } catch (error) {
    return refused((error as Error).message);
  }
};

/**
 * Delete a node for good: its source in `.agents` (and the IDE's link to it,
 * which would otherwise dangle), or for an orphan, the IDE's copy.
 */
export const deleteNode = (node: AgentNode): OperationResult => {
  try {
    if (node.status === 'orphan') {
      rmSync(node.targetPath, { recursive: true, force: true });
      return done(`Deleted ${node.relativePath} from the IDE folder`);
    }
    if (node.isLinked && lstatOrUndefined(node.targetPath)?.isSymbolicLink()) {
      unlinkSync(node.targetPath);
    }
    rmSync(node.sourcePath, { recursive: true, force: true });
    return done(`Deleted ${node.relativePath} from .agents`);
  } catch (error) {
    return refused((error as Error).message);
  }
};

/** Paths under `dir` that are not links into, or identical copies of, `source`. */
const findOwnContent = (dir: string, source: string, found: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const counterpart = join(source, name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      if (!resolvesTo(path, counterpart) && existsSync(path)) found.push(path);
    } else if (stats.isDirectory()) {
      if (existsSync(counterpart)) findOwnContent(path, counterpart, found);
      else found.push(path);
    } else if (!sameBytes(path, counterpart)) {
      found.push(path);
    }
  }
  return found;
};

/**
 * Switch between one link for the whole IDE folder and per-entry links.
 *
 * To `directory`: refused while the IDE folder holds anything that is not
 * already `.agents` content — the switch replaces the folder, and anything of
 * its own would go with it. Hidden files count here, unlike in the inventory,
 * because they are deleted just the same.
 *
 * To `granular`: the folder link becomes a real folder with a link per
 * top-level entry, so nothing stops being available on the way. (The web
 * version left an empty folder and every entry had to be re-enabled.)
 */
export const setLinkMode = (inventory: Inventory, mode: LinkMode): OperationResult => {
  const { sourceDir, targetDir } = inventory;
  if (inventory.mode === mode) return done(`Already in ${mode} mode`);
  if (!existsSync(sourceDir)) return refused(`There is no ${AGENTS_DIR} folder to link`);

  try {
    if (mode === 'directory') {
      const target = lstatOrUndefined(targetDir);
      if (target?.isDirectory()) {
        const own = findOwnContent(targetDir, sourceDir);
        if (own.length > 0) {
          return refused(
            `Cannot switch: ${listPaths(own, targetDir)} are the IDE's own — adopt, push or delete them first`,
          );
        }
      }
      if (target) rmSync(targetDir, { recursive: true, force: true });
      linkRelative(sourceDir, targetDir, true);
      return done(`${relative(dirname(targetDir), targetDir)} is now one link to ${AGENTS_DIR}`);
    }

    unlinkSync(targetDir);
    mkdirSync(targetDir);
    for (const name of listNames(sourceDir)) {
      const source = join(sourceDir, name);
      linkRelative(source, join(targetDir, name), statSync(source).isDirectory());
    }
    return done('Switched to granular links, one per entry');
  } catch (error) {
    return refused((error as Error).message);
  }
};

/** Unified diff of source against target, or undefined when there is none. */
export const getNodeDiff = async (node: AgentNode): Promise<string | undefined> => {
  const result = await exec([
    'git',
    'diff',
    '--no-index',
    '--no-color',
    '--',
    node.sourcePath,
    node.targetPath,
  ]);
  //? 1 is "they differ" — the normal case here; 0 identical; anything else failed
  return result.exitCode === 1 ? result.stdout : undefined;
};

/** A file's text for the detail pane, capped so a stray binary does not stall a render. */
export const readPreview = (path: string, maxBytes = 64 * 1024): string => {
  try {
    const buffer = readFileSync(path);
    const slice = buffer.subarray(0, maxBytes);
    if (slice.includes(0)) return '(binary file)';
    return slice.toString('utf-8') + (buffer.length > maxBytes ? '\n…' : '');
  } catch (error) {
    return `(unreadable: ${(error as Error).message})`;
  }
};

export default getInventory;
