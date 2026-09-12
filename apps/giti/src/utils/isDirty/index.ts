import gitExec from '../gitExec';

const isDirty = async (cwd: string) => {
  try {
    const result = await gitExec(['diff-index', '--quiet', 'HEAD', '--'], cwd);
    return result.exitCode !== 0;
  } catch {
    return false;
  }
};

export default isDirty;
