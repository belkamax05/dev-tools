import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const discardChanges = async (cwd: string, files: string[]) => {
  if (files.length === 0) return;
  const result = await gitExec(['restore', ...files], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
};

export default discardChanges;
