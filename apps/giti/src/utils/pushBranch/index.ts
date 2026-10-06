import gitExec from '../gitExec';

/** Pushes a branch to the given remote and sets it as the upstream. */
const pushBranch = async (cwd: string, remote: string, branch: string) =>
  gitExec(['push', '-u', remote, branch], cwd);

export default pushBranch;
