import getWorkingDir from '../utils/getWorkingDir';
import printGraph from '../utils/printGraph';

const run = async () => {
  const result = await printGraph(getWorkingDir());
  console.log(result.stdout);
};

export const meta = {
  name: 'print-graph',
  description: 'Print the commit history as an ASCII branch graph',
};

export default run;
