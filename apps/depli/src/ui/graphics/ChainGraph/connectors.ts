import type { GraphNode } from '../../../core/graph';

/** Color each bus leg relative to its progress boundary, then its merge/split direction. */
export const connectorOwner = (
  column: number,
  above: readonly GraphNode[],
  below: readonly GraphNode[],
  progress: Iterable<number> = [],
): GraphNode | undefined => {
  const parent = above.length === 1 ? above[0] : undefined;
  if (parent) {
    for (const dot of progress) {
      // A lone remaining build puts the dot on its branch, not the shared push junction.
      // The whole path from the push to that dot is still the completed parent's leg.
      if (
        below.some((node) => node.center === dot) &&
        column >= Math.min(parent.center, dot) &&
        column <= Math.max(parent.center, dot)
      ) {
        return parent;
      }
    }
  }
  const branches = above.length > below.length ? above : below;
  return branches.reduce<GraphNode | undefined>(
    (nearest, node) =>
      !nearest || Math.abs(node.center - column) < Math.abs(nearest.center - column)
        ? node
        : nearest,
    undefined,
  );
};
