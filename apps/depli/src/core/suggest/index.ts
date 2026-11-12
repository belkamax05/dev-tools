import type { SuggestSource } from '../../config/project';
import type { BranchHead, Connection, Env } from '../plugin';
import { contextFor, type Project } from '../registry';

/**
 * What `suggest` names — its provider's list from its source, in the provider's order. Undefined
 * when that provider cannot be asked now (not configured, cannot suggest, not connected).
 */
export const readSuggestions = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  suggest?: SuggestSource,
): Promise<BranchHead[] | undefined> => {
  if (!suggest) return undefined;
  const provider = project.providers.find((entry) => entry.name === suggest.provider);
  const connection = provider && connections[provider.name];
  if (!provider?.plugin.suggestions || !connection?.transport) return undefined;
  return provider.plugin.suggestions(
    contextFor(project, provider, env, connection),
    connection,
    suggest.source,
  );
};

/**
 * The suggested branches, each as the branch provider knows it (its commit) when it does — the
 * suggestion's note kept under the commit's message — else as suggested. In the suggested order.
 */
export const withHeads = (
  suggested: readonly BranchHead[],
  heads: readonly BranchHead[] = [],
): BranchHead[] =>
  suggested.map((suggestion) => {
    const head = heads.find((item) => item.name === suggestion.name);
    if (!head) return suggestion;
    const message = [head.message, suggestion.message].filter(Boolean).join('\n');
    return { ...head, message };
  });
