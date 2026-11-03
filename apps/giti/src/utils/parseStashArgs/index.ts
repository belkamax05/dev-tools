import { parseArgs } from 'node:util';
import { z } from 'zod';

import { normalizeStashName } from '../../core/remoteStash';

const StashArgs = z.object({
  name: z.string().optional(),
  remote: z.string().optional(),
  yes: z.boolean().default(false),
  force: z.boolean().default(false),
  unstaged: z.boolean().default(false),
  /** `save` only: the files to stash, as typed after `--`; every change when left out. */
  paths: z.array(z.string()).optional(),
});

export type StashArgs = z.infer<typeof StashArgs>;

/**
 * argv of the `stash/*` commands:
 * `[<name>] [--remote=<name>] [--yes] [--force] [--unstaged] [-- <paths>…]`.
 *
 * Every flag is giti's own — nothing here is forwarded to git — so an unknown one is an error
 * rather than passthrough. Paths come only after `--`, as with git, so a stash name can never be
 * mistaken for a file.
 *
 * @throws on a flag none of the stash commands take
 */
const parseStashArgs = (args: string[]): StashArgs => {
  const separator = args.indexOf('--');
  const own = separator === -1 ? args : args.slice(0, separator);
  const paths = separator === -1 ? undefined : args.slice(separator + 1);
  const { values, positionals } = parseArgs({
    args: own,
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
  return StashArgs.parse({
    ...values,
    name: name ? normalizeStashName(name) : undefined,
    ...(paths?.length && { paths }),
  });
};

export default parseStashArgs;
