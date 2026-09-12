import gitExec from '../gitExec';

const checkout = async (cwd: string, branch: string) => gitExec(['checkout', branch], cwd);

export default checkout;
