import gitExec from '../gitExec';

const fetch = async (cwd: string) => gitExec(['fetch', '--all', '--prune'], cwd);

export default fetch;
