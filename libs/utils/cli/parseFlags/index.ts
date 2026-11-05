/**
 * Split a command line into `--name=value` flags (`--name` alone is `"true"`) and positionals.
 * A bare `--` ends the flags: everything after it is positional, flags or not.
 */
export const parseFlags = (argv: string[]) => {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const flag = arg.match(/^--([^=]+)(?:=(.*))?$/s);
    if (flag) flags[flag[1] as string] = flag[2] ?? 'true';
    else positionals.push(arg);
  }
  return { flags, positionals };
};

/**
 * Flags up to the first positional (or `--`), then the rest untouched — for a command line that
 * ends in another command, whose own flags must not be taken as ours: `shot --scale=1 ls -la`.
 */
export const parseLeadingFlags = (argv: string[]) => {
  const end = argv.findIndex((arg) => arg === '--' || !arg.startsWith('--'));
  const head = end < 0 ? argv : argv.slice(0, end);
  const rest = end < 0 ? [] : argv.slice(argv[end] === '--' ? end + 1 : end);
  return { flags: parseFlags(head).flags, rest };
};

/** The value of the first `--name=value` among `args`, or undefined — for one flag at a time. */
export const flagValue = (args: string[], name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

export default parseFlags;
