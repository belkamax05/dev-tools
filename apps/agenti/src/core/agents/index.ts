import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import {
  type FormatId,
  isGenerated,
  render,
  sourceName,
  targetName,
  toCanonical,
} from '../formats';
import { type AgentsMapping, type IdeDefinition, type IdeLayout, layoutFor } from '../ides';
import { AGENTS_DIR } from '../repo';
import type { Scope } from '../scope';

/**
 * How one entry of `.agents` stands in an IDE.
 *
 * - `synced` — linked to the source, an identical copy, or (for a converted
 *   format) exactly what the source renders to
 * - `mismatch` — the IDE's file differs from what the source says
 * - `missing` — not in the IDE at all
 * - `implicit` — a directory whose children disagree (some synced, some not)
 * - `orphan` — in the IDE only, with nothing in `.agents` behind it
 * - `unknown` — present but unreadable, a dangling link, or a file where the
 *   source has a directory
 * - `unused` — in `.agents`, but this IDE has nowhere that reads it
 */
export type AgentStatus =
  | 'synced'
  | 'mismatch'
  | 'missing'
  | 'implicit'
  | 'orphan'
  | 'unknown'
  | 'unused';

/**
 * `directory` when the IDE's folder is one link to `.agents` (only possible for
 * a mirror layout); `granular` otherwise.
 */
export type LinkMode = 'granular' | 'directory';

export interface AgentNode {
  name: string;
  /** Relative to `.agents`, e.g. `rules/styling.md` — also for an orphan, named as it would be there. */
  relativePath: string;
  type: 'file' | 'directory';
  status: AgentStatus;
  /** In `.agents`. Does not exist for an orphan. */
  sourcePath: string;
  /** In the IDE. Undefined for an unused entry. */
  targetPath?: string;
  /** The mapping's target root this node sits under — where a linked parent is looked for. */
  targetBase?: string;
  /** Set when the IDE's copy is a conversion rather than a link. */
  format?: FormatId;
  /** What the target link says, as written, when the target is a symlink. */
  linkTarget?: string;
  /** The target resolves to the source — through its own link or a linked parent. */
  isLinked: boolean;
  /** The IDE's file carries agenti's generated marker. */
  isGenerated?: boolean;
  /**
   * Another `.agents` entry lands in the same IDE folder (`workflows` and
   * `commands` in `.claude/commands`), so that folder must be real, with a
   * link per entry — one folder link could only ever point at one of them.
   */
  sharedTarget?: boolean;
  children?: AgentNode[];
}

export interface Inventory {
  scope: Scope;
  ide: IdeDefinition;
  /** Undefined when the IDE keeps nothing in files at this scope. */
  layout?: IdeLayout;
  sourceDir: string;
  /** The IDE-side roots this layout writes to, absolute — for display. */
  targets: string[];
  mode: LinkMode;
  /** Only a mirror layout can be one folder link. */
  canSwitchMode: boolean;
  /** False until the scope has an `.agents` folder at all. */
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

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
};

/**
 * Create `target` as a link to `source`, written relative to the link's own
 * directory, because these links are usually committed:
 * `.claude/skills -> ../.agents/skills` works in every clone, an absolute path
 * only on the machine that made it.
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

/** Whether a file under a converted mapping is converted, or (an image, say) linked as-is. */
const convertsFile = (format: FormatId | undefined, name: string) =>
  Boolean(format) && name.endsWith('.md');

/** What a source file renders to in its IDE, for a converted one. */
const rendered = (format: FormatId, sourcePath: string, relativePath: string) =>
  render(format, readFileSync(sourcePath, 'utf-8'), `${AGENTS_DIR}/${relativePath}`);

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const fileStatus = (
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  format: FormatId | undefined,
): Pick<AgentNode, 'status' | 'isLinked' | 'isGenerated' | 'linkTarget' | 'format'> => {
  const targetStats = lstatOrUndefined(targetPath);
  const linkTarget = targetStats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined;
  const isLinked = resolvesTo(targetPath, sourcePath);

  if (convertsFile(format, basename(sourcePath)) && format) {
    if (!targetStats) return { status: 'missing', isLinked: false, format };
    const text = !linkTarget ? readText(targetPath) : undefined;
    if (text === undefined) return { status: 'unknown', isLinked, linkTarget, format };
    return {
      status: text === rendered(format, sourcePath, relativePath) ? 'synced' : 'mismatch',
      isLinked: false,
      isGenerated: isGenerated(text),
      format,
    };
  }

  if (!targetStats) return { status: 'missing', isLinked };
  if (isLinked) return { status: 'synced', isLinked, linkTarget };
  if (!existsSync(targetPath)) return { status: 'unknown', isLinked, linkTarget };
  if (statSync(targetPath).isDirectory()) return { status: 'unknown', isLinked, linkTarget };
  return {
    status: sameBytes(sourcePath, targetPath) ? 'synced' : 'mismatch',
    isLinked,
    linkTarget,
  };
};

const summarise = (children: AgentNode[], targetExists: boolean): AgentStatus => {
  const counted = children.filter((c) => c.status !== 'unused');
  //? An empty directory has no children to vote, and `every` on nothing is
  //? true — which would call an empty `.agents/workflows` "synced" whether or
  //? not the IDE has one.
  if (counted.length === 0) return targetExists ? 'synced' : 'missing';
  if (counted.some((c) => c.status === 'mismatch' || c.status === 'unknown')) return 'mismatch';
  if (counted.every((c) => c.status === 'synced')) return 'synced';
  if (counted.every((c) => c.status === 'missing')) return 'missing';
  if (counted.every((c) => c.status === 'orphan')) return 'orphan';
  return 'implicit';
};

/** Everything under a target-only directory, orphaned with it, named as `.agents` would name it. */
const scanOrphans = (
  targetDir: string,
  sourceDir: string,
  rel: string,
  format: FormatId | undefined,
  targetBase: string,
  claimed: Set<string> = new Set(),
): AgentNode[] =>
  listNames(targetDir)
    .filter((name) => !claimed.has(name))
    .map((name): AgentNode => {
      const targetPath = join(targetDir, name);
      const stats = lstatOrUndefined(targetPath);
      const isDirectory = Boolean(
        stats && existsSync(targetPath) && statSync(targetPath).isDirectory(),
      );
      const asSource = isDirectory ? name : (sourceName(format, name) ?? name);
      const relativePath = rel ? `${rel}/${asSource}` : asSource;
      return {
        name: asSource,
        relativePath,
        type: isDirectory ? 'directory' : 'file',
        status: 'orphan',
        sourcePath: join(sourceDir, asSource),
        targetPath,
        targetBase,
        format,
        linkTarget: stats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined,
        isLinked: false,
        children: isDirectory
          ? scanOrphans(targetPath, join(sourceDir, asSource), relativePath, format, targetBase)
          : undefined,
      };
    })
    .sort(byTypeThenName);

/** A source directory against its target directory, recursively, orphans included. */
const scanDir = (
  sourceDir: string,
  targetDir: string,
  rel: string,
  format: FormatId | undefined,
  targetBase: string,
  claimedByOthers: Set<string> = new Set(),
): AgentNode[] => {
  const nodes: AgentNode[] = [];
  const expected = new Set(claimedByOthers);

  for (const name of listNames(sourceDir)) {
    const sourcePath = join(sourceDir, name);
    let sourceStats: Stats;
    try {
      sourceStats = statSync(sourcePath);
    } catch {
      continue; //? a dangling link inside .agents is nothing to sync
    }
    const relativePath = rel ? `${rel}/${name}` : name;
    const isDir = sourceStats.isDirectory();
    const inTarget = isDir
      ? name
      : targetName(convertsFile(format, name) ? format : undefined, name);
    const targetPath = join(targetDir, inTarget);
    expected.add(inTarget);

    if (isDir) {
      const targetStats = lstatOrUndefined(targetPath);
      const children = scanDir(sourcePath, targetPath, relativePath, format, targetBase);
      nodes.push({
        name,
        relativePath,
        type: 'directory',
        status: summarise(children, existsSync(targetPath)),
        sourcePath,
        targetPath,
        targetBase,
        format,
        linkTarget: targetStats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined,
        isLinked: resolvesTo(targetPath, sourcePath),
        children,
      });
      continue;
    }

    nodes.push({
      name,
      relativePath,
      type: 'file',
      sourcePath,
      targetPath,
      targetBase,
      ...fileStatus(sourcePath, targetPath, relativePath, format),
    });
  }

  //? A target directory that *is* the source directory (linked) lists the same
  //? entries, so there is nothing of its own to report as orphaned
  if (!resolvesTo(targetDir, sourceDir)) {
    nodes.push(...scanOrphans(targetDir, sourceDir, rel, format, targetBase, expected));
  }
  return nodes.sort(byTypeThenName);
};

/** The layout's mappings; a mirror becomes one mapping per name on either side. */
const mappingsFor = (layout: IdeLayout, scope: Scope): AgentsMapping[] => {
  if (!('mirror' in layout.agents)) return layout.agents;
  const mirror = layout.agents.mirror;
  const names = new Set([...listNames(scope.agentsDir), ...listNames(join(scope.root, mirror))]);
  return [...names].map((name) => ({ source: name, target: `${mirror}/${name}` }));
};

const countFiles = (nodes: AgentNode[], counts: Record<AgentStatus, number>) => {
  for (const node of nodes) {
    if (node.type === 'file' || node.status === 'unused') counts[node.status] += 1;
    if (node.children && node.status !== 'unused') countFiles(node.children, counts);
  }
  return counts;
};

const emptyCounts = (): Record<AgentStatus, number> => ({
  synced: 0,
  mismatch: 0,
  missing: 0,
  implicit: 0,
  orphan: 0,
  unknown: 0,
  unused: 0,
});

/**
 * `.agents` against one IDE at one scope, entry by entry, following that IDE's
 * layout: each top-level entry goes where the IDE reads it (converted where
 * its format differs), and anything it has nowhere for is `unused`.
 */
export const getInventory = (scope: Scope, ide: IdeDefinition): Inventory => {
  const layout = layoutFor(ide, scope.kind);
  const hasSource = existsSync(scope.agentsDir);
  const base = {
    scope,
    ide,
    layout,
    sourceDir: scope.agentsDir,
    hasSource,
  };

  if (!layout) {
    const nodes = listNames(scope.agentsDir).map(
      (name): AgentNode => ({
        name,
        relativePath: name,
        type: statSync(join(scope.agentsDir, name)).isDirectory() ? 'directory' : 'file',
        status: 'unused',
        sourcePath: join(scope.agentsDir, name),
        isLinked: false,
      }),
    );
    return {
      ...base,
      targets: [],
      mode: 'granular',
      canSwitchMode: false,
      nodes,
      counts: countFiles(nodes, emptyCounts()),
    };
  }

  const mappings = mappingsFor(layout, scope);
  const byTarget = new Map<string, AgentsMapping[]>();
  for (const mapping of mappings) {
    byTarget.set(mapping.target, [...(byTarget.get(mapping.target) ?? []), mapping]);
  }

  const nodes: AgentNode[] = [];
  const sourceNames = new Set(listNames(scope.agentsDir));

  for (const name of sourceNames) {
    const sourcePath = join(scope.agentsDir, name);
    let isDir: boolean;
    try {
      isDir = statSync(sourcePath).isDirectory();
    } catch {
      continue;
    }
    const mapping = mappings.find((m) => m.source === name);
    if (!mapping) {
      nodes.push({
        name,
        relativePath: name,
        type: isDir ? 'directory' : 'file',
        status: 'unused',
        sourcePath,
        isLinked: false,
      });
      continue;
    }
    const targetPath = join(scope.root, mapping.target);

    if (!isDir) {
      nodes.push({
        name,
        relativePath: name,
        type: 'file',
        sourcePath,
        targetPath,
        targetBase: targetPath,
        ...fileStatus(sourcePath, targetPath, name, mapping.format),
      });
      continue;
    }

    //? Names another source that shares this target will put there — not orphans
    const claimed = new Set<string>();
    for (const sibling of byTarget.get(mapping.target) ?? []) {
      if (sibling === mapping) continue;
      for (const child of listNames(join(scope.agentsDir, sibling.source))) {
        claimed.add(
          targetName(convertsFile(sibling.format, child) ? sibling.format : undefined, child),
        );
      }
    }
    //? Only one of the sources sharing a target reports its orphans, or each
    //? IDE-only file would be listed once per source
    const owner = (byTarget.get(mapping.target) ?? []).find((m) => sourceNames.has(m.source));
    const children = scanDir(
      sourcePath,
      targetPath,
      name,
      mapping.format,
      targetPath,
      claimed,
    ).filter((child) => child.status !== 'orphan' || owner === mapping);
    const targetStats = lstatOrUndefined(targetPath);
    nodes.push({
      name,
      relativePath: name,
      type: 'directory',
      sharedTarget: (byTarget.get(mapping.target) ?? []).length > 1,
      status: summarise(children, existsSync(targetPath)),
      sourcePath,
      targetPath,
      targetBase: targetPath,
      format: mapping.format,
      linkTarget: targetStats?.isSymbolicLink() ? readlinkSync(targetPath) : undefined,
      isLinked: resolvesTo(targetPath, sourcePath),
      children,
    });
  }

  //? A target with content but no source behind it at all: the IDE has, say,
  //? .claude/commands and .agents has neither commands nor workflows. Shown as
  //? one orphan under the source named like the target, so adopting it is how
  //? the source gets created.
  for (const [target, group] of byTarget) {
    if (group.some((m) => sourceNames.has(m.source))) continue;
    const mapping = group.find((m) => m.source === basename(target)) ?? group[0];
    if (!mapping) continue;
    const targetPath = join(scope.root, target);
    const stats = lstatOrUndefined(targetPath);
    if (!stats || !existsSync(targetPath)) continue;
    const isDir = statSync(targetPath).isDirectory();
    if (isDir && listNames(targetPath).length === 0) continue;
    nodes.push({
      name: mapping.source,
      relativePath: mapping.source,
      type: isDir ? 'directory' : 'file',
      status: 'orphan',
      sourcePath: join(scope.agentsDir, mapping.source),
      targetPath,
      targetBase: targetPath,
      format: mapping.format,
      isLinked: false,
      children: isDir
        ? scanOrphans(
            targetPath,
            join(scope.agentsDir, mapping.source),
            mapping.source,
            mapping.format,
            targetPath,
          )
        : undefined,
    });
  }

  const mirror = 'mirror' in layout.agents ? join(scope.root, layout.agents.mirror) : undefined;
  const sorted = nodes.sort(byTypeThenName);
  return {
    ...base,
    targets: mirror ? [mirror] : [...new Set(mappings.map((m) => join(scope.root, m.target)))],
    mode:
      mirror && lstatOrUndefined(mirror)?.isSymbolicLink() && resolvesTo(mirror, scope.agentsDir)
        ? 'directory'
        : 'granular',
    canSwitchMode: Boolean(mirror),
    nodes: sorted,
    counts: countFiles(sorted, emptyCounts()),
  };
};

/** Depth-first walk, for finding a node by path or collecting a subtree. */
export const flattenNodes = (nodes: AgentNode[]): AgentNode[] =>
  nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);

/** Whether anything in an inventory needs attention — what `status --check` fails on. */
export const hasDrift = (inventory: Inventory): boolean => {
  const { counts } = inventory;
  return counts.mismatch + counts.missing + counts.orphan + counts.unknown > 0;
};

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/**
 * Replace the nearest linked ancestor of `targetPath` with a real directory of
 * per-entry links, so one entry under it can be changed on its own.
 *
 * `.claude/skills -> ../.agents/skills` is one link for the whole folder;
 * turning off a single skill means the folder has to stop being that link
 * first, with every *other* skill still linked afterwards. Walks from the
 * parent of the mapping's target, since the target folder itself is the usual
 * link.
 */
const materializeLinkedAncestors = (targetBase: string, targetPath: string) => {
  const from = dirname(targetBase);
  const parts = relative(from, dirname(targetPath)).split(sep).filter(Boolean);
  let dir = from;
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

/** Replace a folder link with a real folder holding one link per entry of what it pointed at. */
const explodeLink = (path: string) => {
  const resolved = realpathOrUndefined(path);
  unlinkSync(path);
  mkdirSync(path);
  if (!resolved) return;
  for (const name of readdirSync(resolved)) {
    const source = join(resolved, name);
    linkRelative(source, join(path, name), statSync(source).isDirectory());
  }
};

const enable = (
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  format: FormatId | undefined,
  skipped: string[],
  shared = false,
) => {
  const sourceIsDir = statSync(sourcePath).isDirectory();
  let target = lstatOrUndefined(targetPath);

  if (shared && sourceIsDir) {
    //? A shared folder is real: a folder link already there (from before it was
    //? shared) is expanded rather than replaced, so its entries stay linked
    if (target?.isSymbolicLink() && existsSync(targetPath)) {
      if (resolvesTo(targetPath, sourcePath)) return;
      explodeLink(targetPath);
    } else if (!target) {
      mkdirSync(targetPath, { recursive: true });
    }
    target = lstatOrUndefined(targetPath);
  }

  if (!sourceIsDir && convertsFile(format, basename(sourcePath)) && format) {
    const text = rendered(format, sourcePath, relativePath);
    const current = target && !target.isSymbolicLink() ? readText(targetPath) : undefined;
    //? Written over only when it is ours to write over: missing, a stray link,
    //? or a file this tool generated before. A hand-written one is skipped.
    if (target && !target.isSymbolicLink() && current !== text && !isGenerated(current ?? '')) {
      skipped.push(targetPath);
      return;
    }
    if (target?.isSymbolicLink()) unlinkSync(targetPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, text);
    return;
  }

  if (!target) {
    //? A converted folder cannot be one link — its files are named differently
    if (sourceIsDir && format) {
      for (const name of readdirSync(sourcePath)) {
        const inTarget = targetName(convertsFile(format, name) ? format : undefined, name);
        enable(
          join(sourcePath, name),
          join(targetPath, inTarget),
          `${relativePath}/${name}`,
          format,
          skipped,
        );
      }
      return;
    }
    return linkRelative(sourcePath, targetPath, sourceIsDir);
  }

  if (target.isSymbolicLink()) {
    if (resolvesTo(targetPath, sourcePath)) return;
    //? A link to somewhere else, or to nothing, holds no content of its own —
    //? replacing it loses nothing
    unlinkSync(targetPath);
    return enable(sourcePath, targetPath, relativePath, format, skipped);
  }

  if (sourceIsDir && target.isDirectory()) {
    //? Link the children one by one rather than replacing the directory: it may
    //? hold orphans of the IDE's own, and rm -rf'ing them to make room for a
    //? link is exactly the data loss this tool must never cause
    for (const name of readdirSync(sourcePath)) {
      if (name.startsWith('.')) continue;
      const inTarget = targetName(convertsFile(format, name) ? format : undefined, name);
      enable(
        join(sourcePath, name),
        join(targetPath, inTarget),
        `${relativePath}/${name}`,
        format,
        skipped,
      );
    }
    return;
  }

  if (!sourceIsDir && target.isFile() && sameBytes(sourcePath, targetPath)) {
    unlinkSync(targetPath);
    return linkRelative(sourcePath, targetPath, false);
  }

  skipped.push(targetPath);
};

const disable = (
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  format: FormatId | undefined,
  skipped: string[],
) => {
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
        if (name.startsWith('.')) continue;
        const inTarget = targetName(convertsFile(format, name) ? format : undefined, name);
        disable(
          join(sourcePath, name),
          join(targetPath, inTarget),
          `${relativePath}/${name}`,
          format,
          skipped,
        );
      }
    }
    //? Only removed once nothing is left in it — whatever stayed is the IDE's own
    if (readdirSync(targetPath).length === 0) rmdirSync(targetPath);
    return;
  }

  if (convertsFile(format, basename(sourcePath)) && format) {
    const current = readText(targetPath) ?? '';
    const ours = existsSync(sourcePath) && current === rendered(format, sourcePath, relativePath);
    if (ours || isGenerated(current)) unlinkSync(targetPath);
    else skipped.push(targetPath);
    return;
  }

  if (sameBytes(sourcePath, targetPath)) unlinkSync(targetPath);
  else skipped.push(targetPath);
};

/** "a, b, c and 2 more", relative to the scope root. */
const listPaths = (paths: string[], root: string) => {
  const names = paths.map((path) => relative(root, path));
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return `${names.slice(0, 3).join(', ')}${more}`;
};

const describeSkipped = (verb: string, skipped: string[], root: string) =>
  `${verb}, except ${listPaths(skipped, root)} — they differ from .agents; adopt or push them first`;

/**
 * Put a node into the IDE (`on`) — a link, or a generated copy for a converted
 * format — or take it out (`off`).
 *
 * Never destroys content the IDE has that `.agents` does not: a file that
 * differs from its source (and was not generated by this tool) is skipped and
 * reported, not overwritten or deleted.
 */
export const toggleLink = (inventory: Inventory, node: AgentNode, on: boolean): OperationResult => {
  if (inventory.mode === 'directory') {
    return refused('The whole folder is one link to .agents — switch to granular mode first');
  }
  if (node.status === 'orphan') {
    return refused(`${node.relativePath} is not in .agents — adopt it to bring it in`);
  }
  if (node.status === 'unused' || !node.targetPath || !node.targetBase) {
    return refused(`${inventory.ide.name} does not read ${node.relativePath}`);
  }
  try {
    const skipped: string[] = [];
    materializeLinkedAncestors(node.targetBase, node.targetPath);
    if (on) {
      enable(
        node.sourcePath,
        node.targetPath,
        node.relativePath,
        node.format,
        skipped,
        node.sharedTarget,
      );
    } else disable(node.sourcePath, node.targetPath, node.relativePath, node.format, skipped);
    const verb = on ? `Linked ${node.relativePath}` : `Unlinked ${node.relativePath}`;
    return skipped.length
      ? refused(describeSkipped(verb, skipped, inventory.scope.root))
      : done(verb);
  } catch (error) {
    return refused((error as Error).message);
  }
};

/** Copy a whole IDE-side tree into `.agents`, converting files back to the canonical form. */
const adoptTree = (targetPath: string, sourcePath: string, format: FormatId | undefined) => {
  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    mkdirSync(sourcePath, { recursive: true });
    for (const name of readdirSync(targetPath)) {
      const asSource = format ? (sourceName(format, name) ?? name) : name;
      adoptTree(join(targetPath, name), join(sourcePath, asSource), format);
    }
    return;
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  if (format && sourceName(format, basename(targetPath))) {
    writeFileSync(sourcePath, toCanonical(readFileSync(targetPath, 'utf-8')));
  } else {
    copyFileSync(targetPath, sourcePath);
  }
};

/**
 * Copy content one way across a node: `push` from `.agents` into the IDE,
 * `pull` (adopt) from the IDE into `.agents` — converting back to the
 * canonical form where the IDE's format differs.
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
    if (direction === 'pull' && node.status === 'orphan' && node.targetPath) {
      adoptTree(node.targetPath, node.sourcePath, node.format);
      return done(`Adopted ${node.relativePath} into .agents`);
    }

    const files = flattenNodes([node]).filter(
      (n) =>
        n.type === 'file' &&
        n.targetPath &&
        (n.status === 'mismatch' || (direction === 'pull' && n.status === 'orphan')),
    );
    if (files.length === 0) return refused(`Nothing in ${node.relativePath} differs`);

    for (const file of files) {
      const target = file.targetPath as string;
      const converted = convertsFile(file.format, file.name) && file.format;
      const to = direction === 'push' ? target : file.sourcePath;
      mkdirSync(dirname(to), { recursive: true });
      //? A link at the destination would be written *through*, into whatever it
      //? points at — which for a stray link is some other repository's file
      if (lstatOrUndefined(to)?.isSymbolicLink()) unlinkSync(to);
      if (converted && direction === 'push') {
        writeFileSync(to, rendered(converted, file.sourcePath, file.relativePath));
      } else if (converted) {
        writeFileSync(to, toCanonical(readFileSync(target, 'utf-8')));
      } else if (direction === 'push') {
        copyFileSync(file.sourcePath, to);
      } else {
        copyFileSync(target, to);
      }
    }
    const what = files.length === 1 ? node.relativePath : `${files.length} files`;
    return done(
      direction === 'push'
        ? `Pushed ${what} to ${inventory.ide.name}`
        : `Adopted ${what} into .agents`,
    );
  } catch (error) {
    return refused((error as Error).message);
  }
};

/**
 * Delete a node for good: its source in `.agents` (and the IDE's link or
 * generated copy of it, which would otherwise dangle), or for an orphan, the
 * IDE's copy.
 */
export const deleteNode = (node: AgentNode): OperationResult => {
  try {
    if (node.status === 'orphan' && node.targetPath) {
      rmSync(node.targetPath, { recursive: true, force: true });
      return done(`Deleted ${node.relativePath} from the IDE`);
    }
    if (node.targetPath) {
      const target = lstatOrUndefined(node.targetPath);
      if (node.isLinked && target?.isSymbolicLink()) unlinkSync(node.targetPath);
      else if (target?.isFile() && node.isGenerated) unlinkSync(node.targetPath);
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
 * Switch a mirror layout between one link for the whole IDE folder and
 * per-entry links. Refused for a mapped layout, where `.agents` goes to several
 * places and "one link" has no meaning.
 *
 * To `directory`: refused while the folder holds anything that is not already
 * `.agents` content — the switch replaces the folder, and anything of its own
 * would go with it. Hidden files count here, because they are deleted too.
 *
 * To `granular`: the folder link becomes a real folder with a link per
 * top-level entry, so nothing stops being available on the way.
 */
export const setLinkMode = (inventory: Inventory, mode: LinkMode): OperationResult => {
  const { sourceDir, layout } = inventory;
  if (!layout || !('mirror' in layout.agents)) {
    return refused(
      `${inventory.ide.name} reads .agents from several places, so it cannot be one folder link`,
    );
  }
  const targetDir = join(inventory.scope.root, layout.agents.mirror);
  if (inventory.mode === mode) return done(`Already in ${mode} mode`);
  if (!existsSync(sourceDir)) return refused(`There is no ${AGENTS_DIR} folder to link`);

  try {
    if (mode === 'directory') {
      const target = lstatOrUndefined(targetDir);
      if (target?.isDirectory()) {
        const own = findOwnContent(targetDir, sourceDir);
        if (own.length > 0) {
          return refused(
            `Cannot switch: ${listPaths(own, inventory.scope.root)} are the IDE's own — adopt, push or delete them first`,
          );
        }
      }
      if (target) rmSync(targetDir, { recursive: true, force: true });
      linkRelative(sourceDir, targetDir, true);
      return done(`${layout.agents.mirror} is now one link to ${AGENTS_DIR}`);
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

/**
 * Unified diff of what the IDE should have against what it has, or undefined
 * when there is none. For a converted file, "should have" is the rendering,
 * written to a temporary file so git can diff it.
 */
export const getNodeDiff = async (node: AgentNode): Promise<string | undefined> => {
  if (!node.targetPath) return undefined;
  let expected = node.sourcePath;
  let scratch: string | undefined;
  if (node.format && convertsFile(node.format, node.name) && existsSync(node.sourcePath)) {
    scratch = mkdtempSync(join(tmpdir(), 'agenti-diff-'));
    expected = join(scratch, basename(node.targetPath));
    writeFileSync(expected, rendered(node.format, node.sourcePath, node.relativePath));
  }
  try {
    const result = await exec([
      'git',
      'diff',
      '--no-index',
      '--no-color',
      '--',
      expected,
      node.targetPath,
    ]);
    //? 1 is "they differ" — the normal case here; 0 identical; anything else failed
    return result.exitCode === 1 ? result.stdout : undefined;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
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

/**
 * Make an IDE match `.agents` wherever that is safe to do unattended: put in
 * what is missing, and regenerate generated copies that have gone stale.
 * Nothing that differs by hand, and nothing only the IDE has, is touched —
 * those are the cases a person has to decide.
 */
export const syncInventory = (inventory: Inventory): { changed: string[]; left: string[] } => {
  const changed: string[] = [];
  const left: string[] = [];
  if (inventory.mode === 'directory') return { changed, left };

  const visit = (node: AgentNode) => {
    if (node.status === 'unused' || node.status === 'synced') return;
    if (node.status === 'missing') {
      const result = toggleLink(inventory, node, true);
      (result.ok ? changed : left).push(node.relativePath);
      return;
    }
    if (node.type === 'file' && node.status === 'mismatch' && node.isGenerated) {
      const result = syncNode(inventory, node, 'push');
      (result.ok ? changed : left).push(node.relativePath);
      return;
    }
    if (node.type === 'directory' && node.children) {
      for (const child of node.children) visit(child);
      return;
    }
    left.push(node.relativePath);
  };

  for (const node of inventory.nodes) visit(node);
  return { changed, left };
};

export default getInventory;
