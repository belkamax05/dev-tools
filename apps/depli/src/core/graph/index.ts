/**
 * Laying a pipeline out as a graph in character cells — top to bottom, one row of boxes per
 * level, steps that wait on the same things side by side (they can run in parallel). Pure, so
 * the shapes are tested without a terminal.
 */

export interface GraphStep {
  id: string;
  after?: string[];
}

/** Each step's level: 0 for a step with nothing before it, else one past its latest upstream. */
export const levelsOf = (steps: readonly GraphStep[]): Map<string, number> => {
  const levels = new Map<string, number>();
  for (const step of steps) {
    const upstream = (step.after ?? []).map((id) => levels.get(id) ?? -1);
    levels.set(step.id, upstream.length ? Math.max(...upstream) + 1 : 0);
  }
  return levels;
};

export interface GraphNode {
  id: string;
  /** Column of the box's left edge, and its width, within the graph. */
  x: number;
  width: number;
  /** The column its connector meets the box at. */
  center: number;
}

export interface GraphLevel {
  nodes: GraphNode[];
}

/** The levels in order, each node given its cells: parallel steps share the width evenly. */
export const layoutGraph = (steps: readonly GraphStep[], width: number, gap = 1): GraphLevel[] => {
  const levels = levelsOf(steps);
  const count = Math.max(0, ...levels.values()) + (steps.length ? 1 : 0);
  return Array.from({ length: count }, (_, level) => {
    const ids = steps.filter((step) => levels.get(step.id) === level).map((step) => step.id);
    const nodeWidth = Math.max(5, Math.floor((width - gap * (ids.length - 1)) / ids.length));
    return {
      nodes: ids.map((id, index) => {
        const x = index * (nodeWidth + gap);
        return { id, x, width: nodeWidth, center: x + Math.floor(nodeWidth / 2) };
      }),
    };
  });
};

/**
 * The connector row between two levels: a bus from the leftmost to the rightmost centre, with
 * the boxes above meeting it from the top (┴), the ones below from the bottom (┬), and both at
 * once where they line up (┼, ├, ┤, │). Fan-out and fan-in in one row.
 */
export const busRow = (
  above: readonly number[],
  below: readonly number[],
  width: number,
): string => {
  const ups = new Set(above);
  const downs = new Set(below);
  const all = [...above, ...below];
  if (!all.length) return ' '.repeat(width);
  const from = Math.min(...all);
  const to = Math.max(...all);
  let row = '';
  for (let column = 0; column < width; column++) {
    if (column < from || column > to) {
      row += ' ';
      continue;
    }
    const up = ups.has(column);
    const down = downs.has(column);
    const left = column > from;
    const right = column < to;
    row +=
      up && down
        ? left && right
          ? '┼'
          : right
            ? '├'
            : left
              ? '┤'
              : '│'
        : up
          ? left && right
            ? '┴'
            : right
              ? '└'
              : left
                ? '┘'
                : '│'
          : down
            ? left && right
              ? '┬'
              : right
                ? '┌'
                : left
                  ? '┐'
                  : '│'
            : '─';
  }
  return row;
};

/** A box border with a tee where a connector meets it. */
export const borderRow = (
  width: number,
  [leftCorner, rightCorner]: readonly [string, string],
  line: string,
  tee: string | undefined,
  teeAt: number,
): string => {
  const inner = Array.from({ length: Math.max(0, width - 2) }, (_, at) =>
    tee && at === teeAt - 1 ? tee : line,
  ).join('');
  return `${leftCorner}${inner}${rightCorner}`;
};
