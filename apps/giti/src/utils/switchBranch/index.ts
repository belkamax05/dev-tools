import gitExec from '../gitExec';

const switchBranch = async (cwd: string, branch: string) => gitExec(['switch', branch], cwd);

export default switchBranch;
