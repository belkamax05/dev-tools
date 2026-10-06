import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A throwaway repository for the core's tests: one commit on `main`, an
 * identity set locally (the tests must not depend on the machine's config),
 * and optionally a bare "remote" it is pushed to.
 */
export const makeRepo = ({ remote = false } = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'giti-core-'));
  const root = join(base, 'work');
  mkdirSync(root);
  const sh = (args: string[], cwd = root) => {
    const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0)
      throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
    return result.stdout.toString();
  };
  sh(['init', '-q', '-b', 'main']);
  sh(['config', 'user.email', 'test@example.com']);
  sh(['config', 'user.name', 'Test']);
  sh(['config', 'commit.gpgsign', 'false']);
  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  const read = (rel: string) => readFileSync(join(root, rel), 'utf-8');
  write('a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
  sh(['add', '.']);
  sh(['commit', '-q', '-m', 'first']);
  if (remote) {
    const bare = join(base, 'remote.git');
    sh(['init', '-q', '--bare', bare], base);
    sh(['remote', 'add', 'origin', bare]);
    sh(['push', '-q', '-u', 'origin', 'main']);
  }
  return {
    root,
    base,
    sh,
    write,
    read,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
};

export default makeRepo;
