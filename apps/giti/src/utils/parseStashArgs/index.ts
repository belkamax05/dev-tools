import { parseArgs } from 'node:util';
import { z } from 'zod';

import { normalizeStashName } from '../../core/remoteStash';

const StashArgs = z.object({
  name: z.string().optional(),
  remote: z.string().optional(),
  yes: z.boolean().default(false),
  force: z.boolean().default(false),
  unstaged: z.boolean().default(false),
});

export type StashArgs = z.infer<typeof StashArgs>;

/**
 * argv of the `stash/*` commands: `[<name>] [--remote=<name>] [--yes] [--force] [--unstaged]`.
 *
 * Every flag is giti's own — nothing here is forwarded to git — so an unknown one is an error
 * rather than passthrough.
 *
 * @throws on a flag none of the stash commands take
 */
const parseStashArgs = (args: string[]): StashArgs => {
  const { values, positionals } = parseArgs({
    args,
    options: {
      remote: { type: 'string', short: 'r' },
      yes: { type: 'boolean', short: 'y' },
      force: { type: 'boolean', short: 'f' },
      unstaged: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  const name = positionals.join('-');
  return StashArgs.parse({ ...values, name: name ? normalizeStashName(name) : undefined });
};

export default parseStashArgs;
