import gitExec from '../gitExec';

const pull = async (cwd: string) => gitExec(['pull'], cwd);

export default pull;
