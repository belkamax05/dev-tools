import gitExec from '../gitExec';

const renameRemote = async (cwd: string, oldName: string, newName: string) =>
  gitExec(['remote', 'rename', oldName, newName], cwd);

export default renameRemote;
