import gitExec from '../gitExec';

const commit = async (
  cwd: string,
  message?: string,
  options: { noVerify?: boolean; allowEmpty?: boolean; amend?: boolean; noEdit?: boolean } = {},
) => {
  const args = ['commit'];
  if (message) args.push('-m', message);
  if (options.noVerify) args.push('--no-verify');
  if (options.allowEmpty) args.push('--allow-empty');
  if (options.amend) args.push('--amend');
  if (options.noEdit) args.push('--no-edit');
  return gitExec(args, cwd);
};

export default commit;
