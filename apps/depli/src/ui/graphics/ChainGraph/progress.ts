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

/**
 * Where a step that is behind (stale, never run) meets a done step right below it: the done step
 * only compares against its direct parent, so it reads green while something before it is
 * missing. An orange marker on that connector flags the gap — not broken, just not the latest.
 */
export const staleColumns = (
  chain: readonly ChainStep[],
  above: readonly GraphNode[],
  below: readonly GraphNode[],
): number[] => {
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));
  const columns = above.flatMap((parent) => {
    const state = byId.get(parent.id)?.status.state;
    if (state !== 'stale' && state !== 'none') return [];
    const children = below.filter((node) => {
      const entry = byId.get(node.id);
      return entry?.status.state === 'done' && entry.step.after?.includes(parent.id);
    });
    if (!children.length) return [];
    const [child] = children;
    //? One child of this parent alone marks its own junction; a split or a merge marks the
    //? stale parent's own leg, so the dot says which parent is behind
    return children.length === 1 && (byId.get(child!.id)?.step.after?.length ?? 0) <= 1
      ? [child!.center]
      : [parent.center];
  });
  return [...new Set(columns)];
};
