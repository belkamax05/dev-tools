import gitExec from '../gitExec';

const removeRemote = async (cwd: string, name: string) => gitExec(['remote', 'remove', name], cwd);

export default removeRemote;
