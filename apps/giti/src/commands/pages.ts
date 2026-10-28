import type { CommandRun } from '../types/CommandRun';
import runOpenShortcut from '../utils/runOpenShortcut';

const run: CommandRun = (args) => runOpenShortcut('pages', 'pages', args);

export const meta = {
  name: 'pages',
  description:
    "Open the repository's GitHub Pages (or gitlab.com Pages) site in the browser — `pages print` only prints it",
};

export default run;
