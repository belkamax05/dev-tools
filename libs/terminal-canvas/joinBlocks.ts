/**
 * Lay multi-line blocks out side by side.
 *
 * Every block has to declare its own visible width, because the lines are full
 * of SGR escapes and `String.length` counts those. Each canvas already knows
 * its column count, so the caller has the number for free — cheaper and more
 * reliable than stripping escapes to measure.
 */
export interface Block {
  lines: string[];
  width: number;
}

export function joinBlocks(blocks: Block[], gap = 2): string {
  if (blocks.length === 0) return '';
  const height = Math.max(...blocks.map((b) => b.lines.length));
  const spacer = ' '.repeat(gap);
  const out: string[] = [];

  for (let y = 0; y < height; y++) {
    const parts = blocks.map((block) => {
      const line = block.lines[y];
      if (line === undefined) return ' '.repeat(block.width);
      // Reset before the gap so a background colour cannot bleed sideways.
      return `${line}\x1b[0m`;
    });
    out.push(parts.join(spacer));
  }
  return out.join('\n');
}

export default joinBlocks;
