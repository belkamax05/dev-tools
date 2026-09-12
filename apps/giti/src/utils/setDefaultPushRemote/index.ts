import gitExec from '../gitExec';

const setDefaultPushRemote = async (cwd: string, name: string) =>
  gitExec(['config', 'remote.pushdefault', name], cwd);

export default setDefaultPushRemote;
