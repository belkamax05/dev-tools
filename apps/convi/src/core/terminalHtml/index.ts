import type { AnsiPalette, Line, Style } from '@/dev-tools/ui/terminal/ansi/parse';
import escapeHtml from '@/dev-tools/utils/format/escapeHtml';

/** The window's 16 base colours (Catppuccin Mocha), to parse its output with. */
export const TERMINAL_PALETTE: AnsiPalette = [
  '#45475a',
  '#f38ba8',
  '#a6e3a1',
  '#f9e2af',
  '#89b4fa',
  '#f5c2e7',
  '#94e2d5',
  '#bac2de',
  '#7f849c',
  '#f38ba8',
  '#a6e3a1',
  '#f9e2af',
  '#89b4fa',
  '#f5c2e7',
  '#94e2d5',
  '#ffffff',
];

export interface TerminalHtmlOptions {
  /** Text in the window's title bar; no title bar text when omitted. */
  title?: string;
  /** A first line drawn as a shell prompt (`❯ <prompt>`), e.g. the command that was run. */
  prompt?: string;
  /** The prompt's folder label, shown before `❯`. */
  promptLabel?: string;
}

const FG = '#cdd6f4';
const BG = '#1e1e2e';

const css = (style: Style) => {
  const fg = style.inverse ? (style.bg ?? BG) : style.fg;
  const bg = style.inverse ? (style.fg ?? FG) : style.bg;
  const decoration = [style.underline && 'underline', style.strike && 'line-through'].filter(
    Boolean,
  );
  return [
    fg && `color:${fg}`,
    bg && `background:${bg}`,
    style.bold && 'font-weight:700',
    style.dim && 'opacity:.6',
    style.italic && 'font-style:italic',
    decoration.length && `text-decoration:${decoration.join(' ')}`,
  ]
    .filter(Boolean)
    .join(';');
};

const lineHtml = (line: Line) =>
  line
    .map(({ text, style }) => {
      const styles = css(style);
      return styles ? `<span style="${styles}">${escapeHtml(text)}</span>` : escapeHtml(text);
    })
    .join('');

const isBlank = (line: Line) => line.every((span) => !span.text.trim());

/**
 * A terminal window as a standalone page: title bar with the three dots, an optional prompt line,
 * then the lines, coloured. The `<body>` wraps the window exactly, ready for `screenshotHtml`.
 * Blank lines at either end are dropped.
 */
export const terminalHtml = (
  lines: Line[],
  { title, prompt, promptLabel }: TerminalHtmlOptions = {},
) => {
  const trimmed = [...lines];
  while (trimmed.length && isBlank(trimmed[0] as Line)) trimmed.shift();
  while (trimmed.length && isBlank(trimmed[trimmed.length - 1] as Line)) trimmed.pop();
  const promptLine =
    prompt === undefined
      ? ''
      : `<span class="p">${promptLabel ? `${escapeHtml(promptLabel)} ` : ''}❯</span> ${escapeHtml(prompt)}\n`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
html{background:#11111b}
body{margin:0;background:#11111b;padding:24px;display:inline-block}
.win{background:${BG};border-radius:10px;box-shadow:0 10px 30px #0008;overflow:hidden}
.bar{background:#181825;padding:10px 14px;display:flex;align-items:center;gap:8px;color:#a6adc8;font:13px system-ui,sans-serif;min-height:12px}
.dot{width:12px;height:12px;border-radius:50%;flex:none}
.t{margin-left:12px;white-space:nowrap}
pre{margin:0;padding:16px 20px;color:${FG};font:13px/19px 'JetBrains Mono','DejaVu Sans Mono',monospace;white-space:pre}
.p{color:#a6e3a1}
</style></head><body><div class="win"><div class="bar"><span class="dot" style="background:#f38ba8"></span><span class="dot" style="background:#f9e2af"></span><span class="dot" style="background:#a6e3a1"></span>${
    title ? `<span class="t">${escapeHtml(title)}</span>` : ''
  }</div><pre>${promptLine}${trimmed.map(lineHtml).join('\n')}</pre></div></body></html>
`;
};

export default terminalHtml;
