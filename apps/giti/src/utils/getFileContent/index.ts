import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getFileContent = async (cwd: string, file: string) => {
  const result = await gitExec(['show', `HEAD:${file}`], cwd);
  if (result.exitCode !== 0) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      const content = await readFile(join(cwd, file), 'utf-8');
      return content;
    } catch {
      throw new GitError(result);
    }
  }
  return result.stdout;
};

export default getFileContent;
