import gitExec from '../gitExec';

const renameBranch = async (cwd: string, oldName: string, newName: string) =>
  gitExec(['branch', '-m', oldName, newName], cwd);

export default renameBranch;
