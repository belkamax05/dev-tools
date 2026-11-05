import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import exec from '../../process/exec';
import findBrowsers, { type Browser } from '../findBrowsers';
import findPlaywright from '../findPlaywright';

/** How a page becomes a PNG: an installed Chromium's own CLI, or a project's Playwright. */
export type Renderer = 'chrome' | 'playwright';
export const RENDERERS: Renderer[] = ['chrome', 'playwright'];

export interface ScreenshotOptions {
  /**
   * A whole document. Its `<body>` is what gets captured, at the size it lays out to, so give it
   * `display: inline-block` (or a fixed size) and `margin: 0`, and an `html` background in case
   * a browser will not shrink its window that far.
   */
  html: string;
  /** Where to write the PNG; relative to the current directory. */
  output: string;
  /** Device pixels per CSS pixel. 2 by default, for sharp text. */
  scale?: number;
  /** `auto` (the default) prefers an installed Chromium's CLI, then the project's Playwright. */
  renderer?: Renderer | 'auto';
  /** Where the project's Playwright is resolved from; the current directory by default. */
  cwd?: string;
}

export interface ScreenshotResult {
  renderer: Renderer;
  /** The browser executable that drew it; undefined for Playwright's own downloaded browser. */
  browser?: Browser;
  /** Size in CSS pixels; the PNG is this times `scale`. */
  width: number;
  height: number;
}

/** What is installed to render with, as `convi browsers` lists it. */
export const detectRenderers = (cwd = process.cwd()) => ({
  browsers: findBrowsers(),
  playwright: findPlaywright(cwd),
});

const NOTHING_TO_RENDER_WITH = `No browser to render with. Install one of them:
  a Chromium-family browser on PATH  google-chrome, chromium, brave, microsoft-edge (or set $CHROME_PATH)
  playwright in the project          bun add -d playwright`;

/**
 * Which renderer to use. @throws When the one asked for, or any for `auto`, is not installed
 */
export const pickRenderer = (
  choice: Renderer | 'auto',
  found: ReturnType<typeof detectRenderers>,
): Renderer => {
  if (choice === 'chrome' && !found.browsers.length) {
    throw new Error(
      `--renderer=chrome needs a Chromium-family browser.\n${NOTHING_TO_RENDER_WITH}`,
    );
  }
  if (choice === 'playwright' && !found.playwright) {
    throw new Error('--renderer=playwright needs playwright in the project: bun add -d playwright');
  }
  if (choice !== 'auto') return choice;
  if (found.browsers.length) return 'chrome';
  if (found.playwright) return 'playwright';
  throw new Error(NOTHING_TO_RENDER_WITH);
};

//? The page reports its own size through its title, which --dump-dom prints
const MEASURE = `<script>{const r=document.body.getBoundingClientRect();document.title=Math.ceil(r.width)+'x'+Math.ceil(r.height);}</script>`;
const withMeasure = (html: string) =>
  html.includes('</body>') ? html.replace('</body>', `${MEASURE}</body>`) : `${html}${MEASURE}`;

//? Large enough to lay any terminal out unwrapped; the screenshot is then taken at the real size
const LAYOUT_VIEWPORT = { width: 3840, height: 2160 };

/** @throws When the browser fails, or is still running after a minute */
const runChrome = async (bin: string, args: string[]) => {
  const { stdout, stderr, exitCode } = await exec([bin, ...args], { timeout: 60_000 });
  if (exitCode !== 0) throw new Error(`${bin} exited with ${exitCode}:\n${stderr.slice(-2000)}`);
  return stdout;
};

/**
 * Two headless runs of the browser's own CLI: the first lays the page out and prints its DOM,
 * from which its size is read; the second screenshots it with the window at exactly that size.
 * A throwaway profile keeps it from attaching to a browser the user has open.
 */
const renderWithChrome = async (
  browser: Browser,
  page: string,
  output: string,
  scale: number,
  profile: string,
) => {
  const common = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
  ];
  const dom = await runChrome(browser.bin, [
    ...common,
    `--window-size=${LAYOUT_VIEWPORT.width},${LAYOUT_VIEWPORT.height}`,
    '--dump-dom',
    page,
  ]);
  const [, width = '', height = ''] = dom.match(/<title>(\d+)x(\d+)<\/title>/) ?? [];
  if (!width || !height) throw new Error(`${browser.bin} did not report the page size`);
  await runChrome(browser.bin, [
    ...common,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    page,
  ]);
  return { width: Number(width), height: Number(height) };
};

//? Only the corner of Playwright used here, so dev-tools needs none of its types
interface PlaywrightModule {
  chromium: {
    launch: (options: { executablePath?: string; args?: string[] }) => Promise<{
      newPage: (options: {
        viewport: { width: number; height: number };
        deviceScaleFactor: number;
      }) => Promise<{
        goto: (url: string) => Promise<unknown>;
        locator: (selector: string) => {
          boundingBox: () => Promise<{ width: number; height: number } | null>;
          screenshot: (options: { path: string }) => Promise<unknown>;
        };
      }>;
      close: () => Promise<void>;
    }>;
  };
}

/** The project's Playwright, driving an installed Chromium when there is one. */
const renderWithPlaywright = async (
  modulePath: string,
  browser: Browser | undefined,
  page: string,
  output: string,
  scale: number,
) => {
  const { chromium } = (await import(modulePath)) as PlaywrightModule;
  const instance = await chromium.launch({ executablePath: browser?.bin, args: ['--no-sandbox'] });
  try {
    const tab = await instance.newPage({ viewport: LAYOUT_VIEWPORT, deviceScaleFactor: scale });
    await tab.goto(page);
    const body = tab.locator('body');
    const box = await body.boundingBox();
    await body.screenshot({ path: output });
    return { width: Math.ceil(box?.width ?? 0), height: Math.ceil(box?.height ?? 0) };
  } finally {
    await instance.close();
  }
};

/**
 * Render a document to a PNG of its `<body>` with whatever is installed — nothing is downloaded.
 * @throws When no renderer is available, or the browser fails
 */
export const screenshotHtml = async ({
  html,
  output,
  scale = 2,
  renderer = 'auto',
  cwd = process.cwd(),
}: ScreenshotOptions): Promise<ScreenshotResult> => {
  const found = detectRenderers(cwd);
  const picked = pickRenderer(renderer, found);
  const [browser] = found.browsers;
  const target = resolve(cwd, output);
  const dir = mkdtempSync(join(tmpdir(), 'screenshot-html-'));
  try {
    const file = join(dir, 'page.html');
    await Bun.write(file, picked === 'chrome' ? withMeasure(html) : html);
    const page = pathToFileURL(file).href;
    const size =
      picked === 'chrome' && browser
        ? await renderWithChrome(browser, page, target, scale, join(dir, 'profile'))
        : await renderWithPlaywright(found.playwright ?? '', browser, page, target, scale);
    return { renderer: picked, browser, ...size };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export default screenshotHtml;
