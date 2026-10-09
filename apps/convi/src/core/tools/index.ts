import type { Tool } from '../../converters/types';

/**
 * Fail early, with every missing tool and how to get it, instead of letting a converter's
 * subprocess die halfway with its own error. convi only ever reports; it never installs.
 * @throws When any of `tools` is not on PATH
 */
export const assertTools = (tools: Tool[]) => {
  const missing = tools.filter((tool) => !Bun.which(tool.bin));
  if (!missing.length) return;
  throw new Error(
    [
      `Missing ${missing.length === 1 ? 'a tool' : 'tools'} this conversion needs:`,
      ...missing.map((tool) => `  ${tool.bin.padEnd(16)} ${tool.hint}`),
    ].join('\n'),
  );
};
