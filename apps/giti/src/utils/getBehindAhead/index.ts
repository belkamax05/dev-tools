import getBranch from '../getBranch';
import gitExec from '../gitExec';

const getBehindAhead = async (cwd: string, branch: string, baseBranch?: string) => {
  const current = baseBranch || (await getBranch(cwd));
  const result = await gitExec(
    ['rev-list', '--left-right', '--count', `${current}...${branch}`],
    cwd,
  );
  if (result.exitCode !== 0) return { ahead: 0, behind: 0 };
  const parts = result.stdout.split(/\s+/).map(Number);
  return { ahead: parts[0] || 0, behind: parts[1] || 0 };
};

export default getBehindAhead;
