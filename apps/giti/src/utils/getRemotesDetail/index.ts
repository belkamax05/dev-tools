import gitExec from '../gitExec';

const getRemotesDetail = async (cwd: string) => {
  const namesResult = await gitExec(['remote'], cwd);
  if (namesResult.exitCode !== 0 || !namesResult.stdout) return [];
  const names = namesResult.stdout.split('\n').filter(Boolean);
  return Promise.all(
    names.map(async (name) => {
      const fetchRes = await gitExec(['remote', 'get-url', name], cwd);
      const pushRes = await gitExec(['remote', 'get-url', '--push', name], cwd);
      return {
        name,
        fetchUrl: fetchRes.exitCode === 0 ? fetchRes.stdout : '',
        pushUrl: pushRes.exitCode === 0 ? pushRes.stdout : '',
      };
    }),
  );
};

export default getRemotesDetail;
