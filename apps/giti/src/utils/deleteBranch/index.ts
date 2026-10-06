import gitExec from '../gitExec';

const deleteBranch = async (cwd: string, branch: string, force = false) => {
  const args = ['branch', force ? '-D' : '-d', branch];
  return gitExec(args, cwd);
};

export default deleteBranch;
