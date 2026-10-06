import type { CommandRun } from '../types/CommandRun';
import runStageCommand from '../utils/runStageCommand';
import { CHANGE_KINDS } from '../utils/selectChanges';
import stageFiles from '../utils/stageFiles';

const run: CommandRun = async (args) => {
  try {
    await runStageCommand(args, {
      from: 'unstaged',
      verb: 'stage',
      //? `added` never shows up unstaged — a new file is untracked until it is first staged
      kinds: CHANGE_KINDS.filter((kind) => kind !== 'added'),
      apply: stageFiles,
    });
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'stage',
  description:
    'Stage paths, or every change of a kind: --modified, --deleted, --renamed, --untracked, --all. Bare: count what is unstaged',
};

export default run;
