import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Converter, ConvertJob, Tool } from '../types';

const PANDOC: Tool = {
  bin: 'pandoc',
  hint: 'https://pandoc.org/installing.html (nixpkgs: pandoc)',
};
const WEASYPRINT: Tool = {
  bin: 'weasyprint',
  hint: 'pip install weasyprint (nixpkgs: python3Packages.weasyprint)',
};
const MERMAID_FILTER: Tool = {
  bin: 'mermaid-filter',
  hint: 'npm install -g mermaid-filter (nixpkgs: mermaid-filter)',
};

//? A ``` or ~~~ fence opening a mermaid block - the only thing mermaid-filter is needed for
const MERMAID_FENCE = /^ {0,3}(`{3,}|~{3,})\s*\{?\s*\.?mermaid\b/m;

const hasMermaid = async (input: string) => MERMAID_FENCE.test(await Bun.file(input).text());

//? mermaid-filter renders through puppeteer; Chromium's sandbox fails in most containers and
//? some distros, so it is launched without one
const puppeteerConfig = async () => {
  const path = join(tmpdir(), 'convi-puppeteer.json');
  await Bun.write(path, JSON.stringify({ args: ['--no-sandbox'] }));
  return path;
};

//? mermaid-filter always writes its log to ./mermaid-filter.err, even an empty one on success.
//? Removed afterwards when it is empty and was not already there; a real error log stays
const ERR_LOG = 'mermaid-filter.err';
const cleanErrLog = (existedBefore: boolean) => {
  const path = join(process.cwd(), ERR_LOG);
  if (!existedBefore && existsSync(path) && statSync(path).size === 0) rmSync(path);
};

const mdToPdf: Converter = {
  name: 'md-to-pdf',
  from: '.md',
  to: '.pdf',
  description: 'Markdown to PDF — pandoc + WeasyPrint, mermaid diagrams rendered',
  tools: async ({ input }: ConvertJob) =>
    (await hasMermaid(input)) ? [PANDOC, WEASYPRINT, MERMAID_FILTER] : [PANDOC, WEASYPRINT],

  convert: async ({ input, output }: ConvertJob) => {
    const mermaid = await hasMermaid(input);
    const errLogExisted = existsSync(join(process.cwd(), ERR_LOG));
    const proc = Bun.spawn(
      [
        'pandoc',
        input,
        ...(mermaid ? ['--filter', 'mermaid-filter'] : []),
        '--pdf-engine=weasyprint',
        '-o',
        output,
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: mermaid
          ? {
              ...process.env,
              MERMAID_FILTER_PUPPETEER_CONFIG: await puppeteerConfig(),
            }
          : process.env,
      },
    );
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (mermaid) cleanErrLog(errLogExisted);
    if (exitCode !== 0) {
      throw new Error(`pandoc exited with code ${exitCode}${stderr ? `:\n${stderr.trim()}` : ''}`);
    }
  },
};

export default mdToPdf;
