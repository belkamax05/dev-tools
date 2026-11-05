import { basename } from 'node:path';

import { renderOptionsFrom, terminalPage } from '../../core/renderTerminal';
import type { Converter } from '../types';

const ansiToHtml: Converter = {
  name: 'ansi-to-html',
  from: '.ansi',
  to: '.html',
  description: 'Terminal output to a standalone terminal-window page',
  tools: async () => [],
  convert: async ({ input, output, options }) => {
    const { title, prompt, promptLabel } = renderOptionsFrom(options);
    await Bun.write(
      output,
      terminalPage(await Bun.file(input).text(), {
        title: title ?? basename(input),
        prompt,
        promptLabel,
      }),
    );
  },
};

export default ansiToHtml;
