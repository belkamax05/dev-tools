import type { ChainStep } from '../../../core/chain';
import type { GraphNode } from '../../../core/graph';

/** The completed frontier on the connector immediately before recommended steps. */
export const progressColumns = (
  chain: readonly ChainStep[],
  above: readonly GraphNode[],
  below: readonly GraphNode[],
): number[] => {
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));
  const next = below.filter((node) => {
    const entry = byId.get(node.id);
    const parents = entry?.step.after ?? [];
    return (
      entry?.recommended &&
      parents.length > 0 &&
      parents.every((id) => byId.get(id)?.status.state === 'done') &&
      parents.some((id) => above.some((parent) => parent.id === id))
    );
  });
  if (!next.length) return [];
  // Two parallel builds share a completed push: show one marker at their common junction.
  if (next.length > 1) {
    const common = above.find((parent) =>
      next.every((node) => byId.get(node.id)?.step.after?.includes(parent.id)),
    );
    if (common) return [common.center];
  }
  // A merge uses the next step's junction; one unfinished parallel sibling stays unmarked.
  return [...new Set(next.map((node) => node.center))];
};
