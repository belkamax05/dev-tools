/** Columns between tab stops, as most editors show them. */
export const TAB_WIDTH = 4;

/**
 * One line of someone else's text — a file, a diff — made safe to hand to `<Text>`.
 *
 * Ink measures a tab as one cell, but the terminal jumps to its next tab stop, up to eight
 * columns on. A line with tabs in it is therefore wider on screen than the box Ink laid it out
 * in: it runs past the pane's border, the terminal wraps it, and every row below lands one line
 * lower than Ink thinks — the frame comes apart a little more with each redraw. So tabs become
 * spaces up to the next stop, counted in cells from the start of the line.
 *
 * The other control characters (a carriage return, an escape that would start a colour or
 * move the cursor) do worse, and are drawn as `�` instead of being sent.
 */
export const terminalText = (line: string, tabWidth = TAB_WIDTH): string => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
  if (!/[\u0000-\u001F\u007F]/.test(line)) return line;
  let out = '';
  let column = 0;
  for (const char of line) {
    if (char === '\t') {
      const pad = tabWidth - (column % tabWidth);
      out += ' '.repeat(pad);
      column += pad;
    } else if (char < ' ' || char === '\u007F') {
      out += '�';
      column += 1;
    } else {
      out += char;
      column += Bun.stringWidth(char);
    }
  }
  return out;
};

export default terminalText;
