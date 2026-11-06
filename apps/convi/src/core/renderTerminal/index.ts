import screenshotHtml, {
  detectRenderers,
  pickRenderer,
  RENDERERS,
  type Renderer,
} from '@/dev-tools/utils/browser/screenshotHtml';
import parseAnsi from '@/dev-tools/ui/terminal/ansi/parse';

import createKittyGraphics from '../kittyGraphics';
import terminalHtml, { TERMINAL_PALETTE, type TerminalHtmlOptions } from '../terminalHtml';

export interface TerminalRenderOptions extends TerminalHtmlOptions {
  /** Device pixels per CSS pixel; 2 by default. */
  scale?: number;
  renderer?: Renderer | 'auto';
}

/** The terminal-render flags: `--title`, `--prompt`, `--label`, `--scale`, `--renderer`. */
export const renderOptionsFrom = (flags: Record<string, string>): TerminalRenderOptions => {
  const renderer = flags.renderer ?? 'auto';
  if (renderer !== 'auto' && !RENDERERS.includes(renderer as Renderer)) {
    throw new Error(`--renderer must be auto, ${RENDERERS.join(' or ')} — not "${renderer}"`);
  }
  const scale = flags.scale === undefined ? undefined : Number(flags.scale);
  if (scale !== undefined && !(scale > 0 && scale <= 4)) {
    throw new Error(`--scale must be a number from 0 to 4 — not "${flags.scale}"`);
  }
  return {
    title: flags.title,
    prompt: flags.prompt,
    promptLabel: flags.label,
    scale,
    renderer: renderer as Renderer | 'auto',
  };
};

/** @throws Before anything runs, when the renderer the options ask for is not installed */
export const assertRenderer = (options: TerminalRenderOptions) => {
  pickRenderer(options.renderer ?? 'auto', detectRenderers());
};

/** Captured terminal output as a terminal-window page; kitty graphics in it are drawn as images. */
export const terminalPage = (ansi: string, options: TerminalRenderOptions = {}) =>
  terminalHtml(
    parseAnsi(ansi, { palette: TERMINAL_PALETTE, onApc: createKittyGraphics() }),
    options,
  );

/** Captured terminal output as a terminal-window PNG. */
export const renderTerminalPng = (
  ansi: string,
  output: string,
  options: TerminalRenderOptions = {},
) =>
  screenshotHtml({
    html: terminalPage(ansi, options),
    output,
    scale: options.scale,
    renderer: options.renderer,
  });
