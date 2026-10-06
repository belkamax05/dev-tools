import getBranch from '../getBranch';
import getBranches from '../getBranches';

/**
 * Returns the current branch and all other local branches (excluding current).
 */
const getOtherLocalBranches = async (cwd: string) => {
  const current = await getBranch(cwd);
  const { local } = await getBranches(cwd);
  const others = local.filter((b) => b !== current);
  return { current, others };
};

export default getOtherLocalBranches;
