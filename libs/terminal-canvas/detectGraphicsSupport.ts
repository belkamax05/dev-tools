/**
 * Ask the terminal what it can actually do, rather than guessing from $TERM.
 *
 * Three queries go out together and the replies are read off stdin in raw mode:
 *
 *   kitty  — an `a=q` graphics query for a 1x1 image. A terminal that speaks
 *            the protocol answers `ESC _G i=31;OK ESC \`; one that doesn't is
 *            supposed to ignore the APC string entirely.
 *   cell   — `CSI 16 t`, the cell size in device pixels, with `CSI 14 t` (text
 *            area in pixels, divided by the grid) as a fallback.
 *   sixel  — Primary Device Attributes (`CSI c`). Sixel-capable terminals
 *            include attribute 4 in the reply.
 *
 * Getting the cell size right is what keeps the protocols agreeing on size.
 * kitty and iTerm2 scale an image into a box measured in *cells*, so they are
 * self-correcting; sixel has no cell concept and lands at one device pixel per
 * image pixel. Guess the cell size and sixel comes out a different size from
 * the other two.
 *
 * DA1 is answered by essentially every terminal, so its reply doubles as the
 * signal that all replies have arrived — otherwise we would always pay the full
 * timeout. Without a TTY we fall back to environment sniffing.
 */
export interface GraphicsSupport {
  kitty: boolean;
  sixel: boolean;
  iterm2: boolean;
  truecolor: boolean;
  /** Cell size in device pixels. Falls back to a common 10x20 if unmeasurable. */
  cellWidth: number;
  cellHeight: number;
  /** How the cell size was arrived at. */
  cellSizeSource: 'cell-query' | 'window-size' | 'assumed';
  /** Best guess at the emulator, for display only. */
  terminal: string;
  method: 'query' | 'env';
}

const QUERY_TIMEOUT_MS = 400;

// Built from a char code rather than written inline: an ESC in a regex literal
// trips `no-control-regex`, and matching ESC is the entire job here.
const ESC = String.fromCharCode(27);
const DA1_PATTERN = new RegExp(`${ESC}\\[\\?([0-9;]*)c`);
// Both replies are `CSI <n> ; height ; width t`; n distinguishes them.
const CELL_SIZE_PATTERN = new RegExp(`${ESC}\\[6;(\\d+);(\\d+)t`);
const TEXT_AREA_PATTERN = new RegExp(`${ESC}\\[4;(\\d+);(\\d+)t`);

const DEFAULT_CELL_WIDTH = 10;
const DEFAULT_CELL_HEIGHT = 20;

function sniffEnv(): GraphicsSupport {
  const env = process.env;
  const term = env.TERM ?? '';
  const program = env.TERM_PROGRAM ?? '';
  const isKitty = term.includes('kitty') || Boolean(env.KITTY_WINDOW_ID);
  const isGhostty = program === 'ghostty' || term.includes('ghostty');
  const isWezTerm = program === 'WezTerm' || Boolean(env.WEZTERM_PANE);
  const isIterm2 = program === 'iTerm.app' || env.LC_TERMINAL === 'iTerm2';
  const isKonsole = Boolean(env.KONSOLE_VERSION);
  const isFoot = term.includes('foot');

  return {
    kitty: isKitty || isGhostty || isWezTerm,
    // Deliberately not Ghostty: it implements the kitty protocol and does not
    // speak sixel. Claiming otherwise makes the app emit a DCS the terminal
    // silently discards, which looks exactly like a broken encoder.
    sixel: isFoot || isWezTerm || isKonsole,
    iterm2: isIterm2 || isWezTerm,
    truecolor: env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit',
    cellWidth: DEFAULT_CELL_WIDTH,
    cellHeight: DEFAULT_CELL_HEIGHT,
    cellSizeSource: 'assumed',
    terminal:
      program ||
      (isKitty ? 'kitty' : '') ||
      (isFoot ? 'foot' : '') ||
      (isKonsole ? 'konsole' : '') ||
      term ||
      'unknown',
    method: 'env',
  };
}

/**
 * Resolve the cell size from whichever reply arrived, preferring the direct
 * measurement. Dividing the text area by the grid is only approximate — the
 * result is rounded, and any window padding is folded into it — but it is far
 * closer than a hardcoded guess.
 */
function measureCell(buf: string): {
  width: number;
  height: number;
  source: GraphicsSupport['cellSizeSource'];
} {
  const direct = CELL_SIZE_PATTERN.exec(buf);
  if (direct) {
    const width = Number(direct[2]);
    const height = Number(direct[1]);
    if (width > 0 && height > 0) return { width, height, source: 'cell-query' };
  }

  const area = TEXT_AREA_PATTERN.exec(buf);
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (area && cols && rows) {
    const width = Math.round(Number(area[2]) / cols);
    const height = Math.round(Number(area[1]) / rows);
    if (width > 0 && height > 0) return { width, height, source: 'window-size' };
  }

  return { width: DEFAULT_CELL_WIDTH, height: DEFAULT_CELL_HEIGHT, source: 'assumed' };
}

export function detectGraphicsSupport(): Promise<GraphicsSupport> {
  const fallback = sniffEnv();
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(fallback);

  return new Promise<GraphicsSupport>((resolve) => {
    let buf = '';
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();

      const da1 = DA1_PATTERN.exec(buf);
      const attributes = da1?.[1]?.split(';') ?? [];
      const cell = measureCell(buf);
      // When the terminal answered, its answer is the truth. ORing the
      // environment guess on top is how a terminal that correctly reports
      // "no sixel" ends up being sent sixel anyway.
      resolve({
        kitty: buf.includes('_Gi=31;OK'),
        // Only trust the absence of attribute 4 if DA1 actually came back;
        // on a timeout there is nothing to conclude, so fall back.
        sixel: da1 ? attributes.includes('4') : fallback.sixel,
        iterm2: fallback.iterm2,
        truecolor: true,
        cellWidth: cell.width,
        cellHeight: cell.height,
        cellSizeSource: cell.source,
        terminal: fallback.terminal,
        method: 'query',
      });
    };

    const onData = (data: Buffer) => {
      buf += data.toString('latin1');
      // DA1 is answered last, so once it lands there is nothing left to wait for.
      if (DA1_PATTERN.test(buf)) finish();
    };

    const timer = setTimeout(finish, QUERY_TIMEOUT_MS);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    // Order matters: DA1 goes last because its reply is the completion signal.
    process.stdout.write(
      `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\${ESC}[16t${ESC}[14t${ESC}[c`,
    );
  });
}

export default detectGraphicsSupport;
