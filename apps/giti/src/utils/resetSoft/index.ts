import gitExec from '../gitExec';

const resetSoft = async (cwd: string, ref = 'HEAD~1') => gitExec(['reset', '--soft', ref], cwd);

export default resetSoft;
