import createBrailleCanvas from './createBrailleCanvas.ts';
import type { Subject } from './subjects.ts';
import type { Technique } from './techniques.ts';

/**
 * One subject, drawn with one technique, as terminal rows.
 *
 * Strings rather than a canvas, because that is all either caller wants: both
 * hosts are Ink apps, and Ink needs one `<Text>` per row anyway — a single
 * multi-line `<Text>` under `wrap="truncate"` collapses to one line, because
 * cli-truncate treats the whole string as one.
 *
 * A raster technique returns blank rows of exactly the same shape. The picture
 * is not text and cannot be laid out; it is written over this rectangle
 * afterwards, and the blanks are what reserve the space for it.
 */
export function renderSubjectPanel(
  technique: Technique,
  subject: Subject,
  time: number,
  cols: number,
  rows: number,
): string[] {
  if (cols <= 0 || rows <= 0) return [];
  if (technique.kind === 'raster') {
    return Array.from({ length: rows }, () => ' '.repeat(cols));
  }

  // Line art needs dithering off, or the depth-shaded strokes break up into
  // stipple; a shaded surface needs it on to read as continuous tone.
  const canvas =
    subject.lineArt && technique.id === 'braille'
      ? createBrailleCanvas(cols, rows, { dither: false, threshold: 0.02 })
      : technique.create(cols, rows);
  canvas.clear(0, 0, 0);
  subject.draw(canvas, time);
  return canvas.render().split('\n');
}

export default renderSubjectPanel;
