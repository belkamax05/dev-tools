import getRemotes from '../getRemotes';
import gitExec from '../gitExec';

const getRemoteDetails = async (cwd: string) => {
  const names = await getRemotes(cwd);
  return Promise.all(
    names.map(async (name) => {
      const fetchResult = await gitExec(['remote', 'get-url', name], cwd);
      const pushResult = await gitExec(['remote', 'get-url', '--push', name], cwd);
      return {
        name,
        fetchUrl: fetchResult.exitCode === 0 ? fetchResult.stdout.trim() : '',
        pushUrl: pushResult.exitCode === 0 ? pushResult.stdout.trim() : '',
      };
    }),
  );
};

export default getRemoteDetails;
