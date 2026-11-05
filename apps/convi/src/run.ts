import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import * as p from '@clack/prompts';
import { detectRenderers, pickRenderer } from '@/dev-tools/utils/browser/screenshotHtml';
import { parseFlags, parseLeadingFlags } from '@/dev-tools/utils/cli/parseFlags';

import converters from './converters';
import type { Converter } from './converters/types';
import captureCommand, { commandLine, slugOf } from './core/captureCommand';
import { replaceExtension, withExtension } from './core/paths';
import { assertRenderer, renderOptionsFrom, renderTerminalPng } from './core/renderTerminal';
import { resolveConverter } from './core/resolve';
import { assertTools } from './core/tools';

const listLine = (converter: Converter) =>
  `  ${converter.name.padEnd(12)} ${`${converter.from} → ${converter.to}`.padEnd(14)} ${converter.description}`;

const SHOT_FLAGS = `shot / ansi-to-png flags:
  --output=<file>        shot only; default: the command as a file name, in the current directory
  --title=<text>         title bar (default: folder — command, or the input's file name)
  --prompt=<text>        the prompt line (default: the command; none for a file)
  --label=<text>         the prompt's folder label (default: the current folder's name)
  --scale=<n>            pixels per CSS pixel, default 2
  --renderer=<name>      auto (default), chrome or playwright
  --columns=<n>          shot only; the terminal width the command is told, default 120
  --keep-ansi            shot only; also keep the captured output next to the PNG, as .ansi`;

const help = () => `convi — file format converter, and terminal screenshots

usage:
  convi <converter> <input> [output]   convi md-to-pdf notes.md  (output: notes.pdf next to it)
  convi <input> <output>               picked by the two extensions: convi notes.md out.pdf
  convi shot [flags] [--] <command…>   run a command, save its coloured output as a terminal PNG
  convi browsers [--json]              what is installed to render PNGs with, and which is used
  convi list [--json]                  the converters

converters:
${converters.map(listLine).join('\n')}

${SHOT_FLAGS}

Paths are relative to the current directory. External tools a converter needs (pandoc, a browser,
…) are checked first and never installed for you - a missing one is reported with how to get it.
`;

const shotHelp = () => `convi shot — run a command, save its coloured output as a terminal PNG

usage:
  convi shot [flags] [--] <command…>   flags first; everything after the command is its own
  convi shot 'bun test | tail -20'     one quoted argument is a shell line

examples:
  convi shot bun run validate                       → bun-run-validate.png here
  convi shot --output=reports/lint -- bun run lint  → reports/lint.png
  convi shot -- help                                a command called help, not this text

${SHOT_FLAGS}

The command runs in the current directory with colour forced on (FORCE_COLOR, TERM=xterm-256color).
Its exit code is reported, not passed on: a screenshot of a failure is still a screenshot.
`;

//? `help`, `-h` or `--help` (a flag before the command) asks for the help — unless `--` says
//? the command really is called that
const wantsShotHelp = (argv: string[], flags: Record<string, string>, command: string[]) =>
  flags.help === 'true' ||
  (!argv.includes('--') && ['help', '-h', '--help'].includes(command[0] ?? ''));

const fail = (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
};

/** @throws When the output's directory does not exist */
const assertOutputDir = (output: string) => {
  if (!existsSync(dirname(output))) {
    throw new Error(`Output directory does not exist: ${dirname(output)}`);
  }
};

/** Turn the arguments into absolute, checked paths. @throws On a missing input or output dir */
const preparePaths = (converter: Converter, inputArg: string, outputArg?: string) => {
  const cwd = process.cwd();
  const input = resolve(cwd, withExtension(inputArg, converter.from));
  const output = resolve(
    cwd,
    outputArg ? withExtension(outputArg, converter.to) : replaceExtension(input, converter.to),
  );

  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  if (statSync(input).isDirectory()) throw new Error(`Input is a directory: ${input}`);
  assertOutputDir(output);
  return { input, output };
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * `convi shot [flags] [--] <command…>`: run the command as a colour terminal would show it, then
 * render what it printed as a terminal window. The command failing is no failure of ours — a
 * screenshot of an error is often the point — so its exit code is reported, not passed on.
 */
const runShot = async (argv: string[]) => {
  const { flags, rest: command } = parseLeadingFlags(argv);
  if (wantsShotHelp(argv, flags, command)) {
    process.stdout.write(shotHelp());
    return;
  }
  if (!command.length) {
    console.error('No command to run.\n');
    process.stderr.write(shotHelp());
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const line = commandLine(command);
  const columns = flags.columns === undefined ? undefined : Number(flags.columns);
  let options: ReturnType<typeof renderOptionsFrom>;
  let output: string;
  try {
    options = renderOptionsFrom(flags);
    if (columns !== undefined && !(columns >= 20)) throw new Error('--columns must be 20 or more');
    output = resolve(cwd, withExtension(flags.output ?? slugOf(line), '.png'));
    assertOutputDir(output);
    assertRenderer(options);
  } catch (error) {
    fail(error);
    return;
  }

  const label = options.promptLabel ?? basename(cwd);
  const s = p.spinner();
  s.start(`Running ${line}`);
  try {
    const captured = await captureCommand(command, { cwd, columns });
    if (flags['keep-ansi'] === 'true')
      await Bun.write(replaceExtension(output, '.ansi'), captured.output);
    s.message(`Rendering ${basename(output)}`);
    const result = await renderTerminalPng(captured.output, output, {
      ...options,
      title: options.title ?? `${label} — ${line}`,
      prompt: options.prompt ?? line,
      promptLabel: label,
    });
    const scale = options.scale ?? 2;
    const via = result.browser ? `${result.renderer}: ${result.browser.name}` : result.renderer;
    s.stop(
      `${output}  ${result.width * scale}×${result.height * scale}px (${via}) — command exited ${captured.exitCode} in ${seconds(captured.ms)}`,
    );
  } catch (error) {
    s.error('shot failed');
    fail(error);
  }
};

/** `convi browsers`: every renderer found, and the one `--renderer=auto` would take. */
const runBrowsers = (json: boolean) => {
  const found = detectRenderers();
  let auto: string | undefined;
  try {
    auto = pickRenderer('auto', found);
  } catch {}
  if (json) {
    console.log(JSON.stringify({ ...found, auto: auto ?? null }, null, 2));
    return;
  }
  const mark = (renderer: string) => (auto === renderer ? '  ← auto' : '');
  console.log(`chrome      ${found.browsers.length ? '✔' : '✖'}${mark('chrome')}`);
  for (const browser of found.browsers) console.log(`  ${browser.name.padEnd(22)} ${browser.bin}`);
  if (!found.browsers.length) {
    console.log('  none: install google-chrome, chromium, brave or edge, or set $CHROME_PATH');
  }
  console.log(`playwright  ${found.playwright ? '✔' : '✖'}${mark('playwright')}`);
  console.log(`  ${found.playwright ?? 'not in this project: bun add -d playwright'}`);
  if (!auto) process.exitCode = 1;
};

/**
 * `convi [converter] <input> [output]` — convert one file — plus `shot`, `browsers` and `list`.
 * Without arguments it prints the help and the converter list; errors go to stderr with exit
 * code 1.
 */
export const run = async (...argv: string[]) => {
  const [first, ...rest] = argv;

  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(help());
    return;
  }

  if (first === 'shot' || first === 'capture') {
    await runShot(rest);
    return;
  }

  if (first === 'browsers') {
    runBrowsers(rest.includes('--json'));
    return;
  }

  if (first === 'list' || first === 'ls') {
    if (rest.includes('--json')) {
      console.log(
        JSON.stringify(
          converters.map(({ name, from, to, description }) => ({
            name,
            from,
            to,
            description,
          })),
          null,
          2,
        ),
      );
      return;
    }
    console.log(converters.map(listLine).join('\n'));
    return;
  }

  const { flags, positionals } = parseFlags(argv);
  const resolved = resolveConverter(positionals, converters);
  if (resolved.kind === 'unknown') {
    console.error(`${resolved.reason}\n`);
    process.stderr.write(help());
    process.exitCode = 1;
    return;
  }

  const { converter } = resolved;

  //? Bad paths, missing tools and bad flags are reported before the spinner starts - nothing ran yet
  let job: ReturnType<typeof preparePaths> & { options: Record<string, string> };
  try {
    job = { ...preparePaths(converter, resolved.input, resolved.output), options: flags };
    assertTools(await converter.tools(job));
    await converter.check?.(job);
  } catch (error) {
    fail(error);
    return;
  }

  const s = p.spinner();
  s.start(`${basename(job.input)} → ${basename(job.output)}`);
  try {
    await converter.convert(job);
    s.stop(`Converted ${basename(job.input)} → ${job.output}`);
  } catch (error) {
    s.error(`${converter.name} failed`);
    fail(error);
  }
};

export default run;
