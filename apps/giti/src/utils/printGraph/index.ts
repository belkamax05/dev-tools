import gitExec from '../gitExec';

const printGraph = (cwd: string) =>
  gitExec(['log', '--graph', '--abbrev-commit', '--decorate', '--oneline'], cwd);

export default printGraph;
