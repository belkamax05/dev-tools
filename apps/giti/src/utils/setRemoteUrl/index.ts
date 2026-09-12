import gitExec from '../gitExec';

const setRemoteUrl = async (cwd: string, name: string, url: string, push = false) => {
  const args = ['remote', 'set-url'];
  if (push) args.push('--push');
  args.push(name, url);
  return gitExec(args, cwd);
};

export default setRemoteUrl;
