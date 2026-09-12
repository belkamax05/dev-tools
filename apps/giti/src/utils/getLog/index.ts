import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getLog = async (cwd: string, count = 10) => {
  const format = '%H|%h|%an|%ae|%ad|%s';
  const result = await gitExec(['log', `-${count}`, `--format=${format}`, '--date=iso'], cwd);

  if (result.exitCode !== 0) {
    throw new GitError(result);
  }

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [fullHash, hash, author, authorEmail, date, message] = line.split('|');
      return { hash, fullHash, author, authorEmail, date, message };
    });
};

export default getLog;
