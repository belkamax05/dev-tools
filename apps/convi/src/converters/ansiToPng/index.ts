import { basename } from 'node:path';

import { assertRenderer, renderOptionsFrom, renderTerminalPng } from '../../core/renderTerminal';
import type { Converter, ConvertJob } from '../types';

//? A saved stream has no command to show, so its file name stands in as the title
const optionsOf = ({ input, options }: ConvertJob) => ({
  title: basename(input),
  ...Object.fromEntries(
    Object.entries(renderOptionsFrom(options)).filter(([, value]) => value !== undefined),
  ),
});

const ansiToPng: Converter = {
  name: 'ansi-to-png',
  from: '.ansi',
  to: '.png',
  description: 'Terminal output (colours, spinners) to a terminal-window screenshot',
  tools: async () => [],
  check: async (job) => assertRenderer(optionsOf(job)),
  convert: async (job) => {
    await renderTerminalPng(await Bun.file(job.input).text(), job.output, optionsOf(job));
  },
};

export default ansiToPng;
