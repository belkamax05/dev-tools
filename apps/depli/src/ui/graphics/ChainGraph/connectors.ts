import type { GraphNode } from '../../../core/graph';

/** A merging bus belongs to its incoming branches; a splitting bus to its outgoing branches. */
export const connectorOwner = (
  column: number,
  above: readonly GraphNode[],
  below: readonly GraphNode[],
): GraphNode | undefined => {
  const branches = above.length > below.length ? above : below;
  return branches.reduce<GraphNode | undefined>(
    (nearest, node) =>
      !nearest || Math.abs(node.center - column) < Math.abs(nearest.center - column)
        ? node
        : nearest,
    undefined,
  );
};
