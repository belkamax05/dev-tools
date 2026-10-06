/** A rectangle of terminal cells. */
export interface Footprint {
  cols: number;
  rows: number;
}

/**
 * Fit a footprint into the available cells, preserving a subject's shape.
 *
 * A cell is about twice as tall as it is wide, so the physical proportions of a
 * `cols` x `rows` block are `cols : rows * 2` — which is why the 2 appears here,
 * and why circles come out as ellipses without it.
 *
 * No aspect means no shape to keep: a procedural scene fills whatever it is
 * given and gets the whole rectangle.
 */
export function fitFootprint(
  maxCols: number,
  maxRows: number,
  aspect: number | undefined,
): Footprint {
  const cols = Math.max(1, maxCols);
  const rows = Math.max(1, maxRows);
  if (!aspect) return { cols, rows };

  const colsFromRows = Math.floor(rows * 2 * aspect);
  const fittedCols = Math.max(1, Math.min(cols, colsFromRows));
  const fittedRows = Math.max(1, Math.min(rows, Math.round(fittedCols / (2 * aspect))));
  return { cols: fittedCols, rows: fittedRows };
}

export default fitFootprint;
