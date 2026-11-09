import { type IdeDefinition, type IdeMcpTarget, mcpTargetsFor } from '../ides';
import { buildComparisons, readMcpTarget, readSourceMcp, sameEntry, setMcpServer } from '../mcp';
import type { Scope } from '../scope';

/**
 * The MCP targets a repository's sync keeps in step: its shared project file,
 * and, unless the repository opted out (`agenti mcp-user off`), the IDE's user
 * scope too — for Claude Code that is what makes the servers reach sessions in
 * every other repository. Claude Code's per-user `local` scope is left alone.
 */
export const syncedMcpTargets = (
  scope: Scope,
  ide: IdeDefinition,
  userToo: boolean,
): IdeMcpTarget[] =>
  scope.kind !== 'project'
    ? []
    : mcpTargetsFor(ide, scope.kind).filter(
        (target) =>
          (target.kind === 'file' && target.scope === 'project') ||
          (userToo && target.scope === 'user'),
      );

export interface McpSyncChange {
  ok: boolean;
  /** `ide: added MCP server name (user scope)`, ready to print or notify. */
  text: string;
  /** Why it failed, when it did. */
  detail?: string;
}

/**
 * Bring every synced target of `ide` in line with the reference, where that is
 * safe unattended: a server missing from a target is added, and one an older
 * sync copied without the transport the IDE needs is repaired. Any other
 * difference is someone's own edit, left for the dashboard.
 *
 * Sequential on purpose — each write replaces a whole file, and Claude Code's
 * CLI must not be run in parallel against its own config.
 */
export const syncMcpServers = async (
  scope: Scope,
  ide: IdeDefinition,
  userToo: boolean,
): Promise<McpSyncChange[]> => {
  const source = readSourceMcp(scope.root);
  const changes: McpSyncChange[] = [];
  for (const target of syncedMcpTargets(scope, ide, userToo)) {
    const where = target.scope === 'user' ? ' (user scope)' : '';
    const comparisons = buildComparisons(
      source.servers,
      readMcpTarget(scope.root, target).servers,
      target,
    );
    for (const comparison of comparisons) {
      if (!comparison.sourceEntry) continue;
      const unadapted =
        comparison.status === 'diff' &&
        comparison.targetEntry !== undefined &&
        sameEntry(source.servers[comparison.name] ?? {}, comparison.targetEntry);
      if (comparison.status !== 'missing-in-target' && !unadapted) continue;
      const result = await setMcpServer(
        scope.root,
        readMcpTarget(scope.root, target),
        comparison.name,
        comparison.sourceEntry,
      );
      const verb = unadapted
        ? result.ok
          ? 'repaired'
          : 'could not repair'
        : result.ok
          ? 'added'
          : 'could not add';
      changes.push({
        ok: result.ok,
        text: `${ide.id}: ${verb} MCP server ${comparison.name}${where}`,
        detail: result.ok ? undefined : result.message,
      });
    }
  }
  return changes;
};

export default syncMcpServers;
