import gitExec from '../gitExec';

const push = async (cwd: string) => gitExec(['push'], cwd);

export default push;
