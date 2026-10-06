import joinBlocks, { type Block } from './joinBlocks.ts';
import renderSubjectPanel from './renderSubjectPanel.ts';
import type { Subject } from './subjects.ts';
import { TEXT_TECHNIQUES } from './techniques.ts';

/** Columns between two panels, and the narrowest a panel is worth drawing. */
const GAP = 2;
const MIN_PANEL = 18;

/** Rows a panel's label takes: the name, and the blank row under the group. */
const LABEL_ROWS = 2;

/**
 * Every text technique at once, drawing the same subject into the same size
 * panel — the point being that the differences you see are the technique and
 * nothing else.
 *
 * This is the diagnostic worth having: whether a terminal's font really covers
 * sextants and braille is not something `$TERM` or a capability query will tell
 * you, and the answer is obvious the moment the panels sit side by side.
 *
 * Raster protocols are left out. They are not text, so they cannot be tiled into
 * a layout — each would need its own absolutely-positioned overlay.
 */
export function renderTechniqueComparison(
  subject: Subject,
  time: number,
  cols: number,
  rows: number,
): string[] {
  if (cols <= 0 || rows <= 0) return [];

  let perRow = TEXT_TECHNIQUES.length;
  while (perRow > 1 && (MIN_PANEL + GAP) * perRow - GAP > cols) perRow--;
  const panelCols = Math.max(
    MIN_PANEL,
    Math.floor((cols - GAP * (perRow - 1)) / Math.max(1, perRow)),
  );
  const gridRows = Math.ceil(TEXT_TECHNIQUES.length / perRow);
  const panelRows = Math.max(3, Math.floor(rows / gridRows) - LABEL_ROWS);

  const output: string[] = [];
  for (let start = 0; start < TEXT_TECHNIQUES.length; start += perRow) {
    const group = TEXT_TECHNIQUES.slice(start, start + perRow);

    const headers: Block[] = group.map((technique) => ({
      width: panelCols,
      lines: [`\x1b[1m${technique.label.padEnd(panelCols).slice(0, panelCols)}\x1b[0m`],
    }));

    const panels: Block[] = group.map((technique) => ({
      width: panelCols,
      lines: renderSubjectPanel(technique, subject, time, panelCols, panelRows),
    }));

    output.push(...joinBlocks(headers, GAP).split('\n'));
    output.push(...joinBlocks(panels, GAP).split('\n'));
    output.push('');
  }
  return output.slice(0, rows);
}

export default renderTechniqueComparison;
