import gitExec from '../gitExec';

const deleteRemoteBranch = async (cwd: string, remote: string, branch: string) =>
  gitExec(['push', remote, '--delete', branch], cwd);

export default deleteRemoteBranch;
