import { join } from 'node:path';
import sysPaths from '../../config/sysPaths';
import type { CommandEntry } from '../../types/CommandEntry';
import type { CommandMeta } from '../../types/CommandMeta';

/**
 * Every command module under `src/commands`, nested ones included, in stable name order.
 *
 * Each module is imported to read its optional `meta`, which is the only place a command's
 * description lives — both the picker and the `.gitconfig` alias generator read it from here.
 * Importing is safe: a command's work sits behind its default export, and the ones runnable on
 * their own guard the call with `import.meta.main`.
 *
 * @param commandsDir - Directory to scan, defaulting to the CLI's own `src/commands`
 */
const getCommandEntries = async (
  commandsDir: string = sysPaths.commandsDir,
): Promise<CommandEntry[]> => {
  const files = await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: commandsDir }));

  const names = files
    .filter((file) => !file.endsWith('.test.ts'))
    .map((file) => file.slice(0, -'.ts'.length))
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const path = join(commandsDir, `${name}.ts`);
      const { meta } = (await import(path)) as { meta?: CommandMeta };
      //? `lastIndexOf` returns -1 for a top-level command, so the slice keeps the whole name
      return { name, key: name.slice(name.lastIndexOf('/') + 1), path, meta };
    }),
  );
};

export default getCommandEntries;
