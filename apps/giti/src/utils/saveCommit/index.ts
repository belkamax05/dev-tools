import gitExec from '../gitExec';

/** Push only after git reports a successful commit; --push never reaches git commit. */
const saveCommit = async (
  cwd: string,
  args: string[],
  push: boolean,
  {
    stream = false,
    send = async () => {
      const { default: command } = await import('../../commands/send');
      await command(['--yes']);
    },
  }: { stream?: boolean; send?: () => Promise<void> } = {},
) => {
  const result = await gitExec(args, cwd, { stream });
  if (result.exitCode === 0 && push) await send();
  return result;
};

export default saveCommit;
