import gitExec from '../gitExec';

const setConfig = async (key: string, value: string, cwd: string) => {
  await gitExec(['config', '--replace-all', key, value], cwd);
};

export default setConfig;
