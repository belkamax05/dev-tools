import getCurrentCommit from '../getCurrentCommit';

const getCommitHash = async (cwd: string, short = true) => getCurrentCommit(cwd, { short });

export default getCommitHash;
