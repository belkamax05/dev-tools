import type { CommandRun } from '../types/CommandRun';
import runOpenShortcut from '../utils/runOpenShortcut';

const run: CommandRun = (args) => runOpenShortcut('url', 'home', args);

export const meta = {
  name: 'url',
  description:
    "Open the repository's web page (GitHub, GitLab, …) in the browser — `url print` only prints it",
};

export default run;
