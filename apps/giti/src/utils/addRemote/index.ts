import gitExec from '../gitExec';

const addRemote = async (cwd: string, name: string, url: string) =>
  gitExec(['remote', 'add', name, url], cwd);

export default addRemote;
