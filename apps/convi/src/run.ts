import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import * as p from '@clack/prompts';

import converters from './converters';
import type { Converter } from './converters/types';
import { replaceExtension, withExtension } from './core/paths';
import { resolveConverter } from './core/resolve';
import { assertTools } from './core/tools';

const listLine = (converter: Converter) =>
  `  ${converter.name.padEnd(12)} ${`${converter.from} → ${converter.to}`.padEnd(14)} ${converter.description}`;

const help = () => `convi — file format converter

usage:
  convi <converter> <input> [output]   convi md-to-pdf notes.md  (output: notes.pdf next to it)
  convi <input> <output>               picked by the two extensions: convi notes.md out.pdf
  convi list [--json]                  the converters

converters:
${converters.map(listLine).join('\n')}

Paths are relative to the current directory. External tools a converter needs (pandoc, …)
are checked first and never installed for you - a missing one is reported with how to get it.
`;

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
  if (!existsSync(dirname(output))) {
    throw new Error(`Output directory does not exist: ${dirname(output)}`);
  }
  return { input, output };
};

/**
 * `convi [converter] <input> [output]` — convert one file. Without arguments it prints the help
 * and the converter list; errors go to stderr with exit code 1.
 */
export const run = async (...argv: string[]) => {
  const [first, ...rest] = argv;

  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(help());
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

  const resolved = resolveConverter(argv, converters);
  if (resolved.kind === 'unknown') {
    console.error(`${resolved.reason}\n`);
    process.stderr.write(help());
    process.exitCode = 1;
    return;
  }

  const { converter } = resolved;
  const fail = (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  };

  //? Bad paths and missing tools are reported before the spinner starts - nothing ran yet
  let job: ReturnType<typeof preparePaths>;
  try {
    job = preparePaths(converter, resolved.input, resolved.output);
    assertTools(await converter.tools(job));
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
