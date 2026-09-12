import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const unstageFiles = async (cwd: string, files: string[]) => {
  if (files.length === 0) return;
  const result = await gitExec(['reset', 'HEAD', ...files], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
};

export default unstageFiles;
