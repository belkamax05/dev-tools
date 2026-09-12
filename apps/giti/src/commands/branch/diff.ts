import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isCancel, select } from '@clack/prompts';
import sysPaths from '../../config/sysPaths';
import type { CommandRun } from '../../types/CommandRun';
import getDiff from '../../utils/getDiff';
import getDiffHtml from '../../utils/getDiffHtml';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';
import openFile from '../../utils/openFile';

const sanitizePath = (branch: string) =>
  branch.replace(/\//g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');

const run: CommandRun = async (args) => {
  try {
    const cwd = getWorkingDir();
    const { current, others } = await getOtherLocalBranches(cwd);

    let baseBranch = args[0];
    const compareBranch = args[1] ?? current;

    if (!baseBranch) {
      if (others.length === 0) {
        console.log('No other local branches to compare against.');
        return;
      }

      const choice = await select({
        message: `Select base branch to compare against (compare: ${compareBranch}):`,
        options: others.map((b) => ({ value: b, label: b })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      baseBranch = choice as string;
    }

    console.log(`📊 Diffing ${baseBranch}..${compareBranch}...`);

    const diffString = await getDiff(cwd, baseBranch, compareBranch);

    if (!diffString.trim()) {
      console.log('✨ No differences found between the two branches.');
      return;
    }

    const title = `diff: ${baseBranch} → ${compareBranch}`;
    const html = getDiffHtml(diffString, title);

    const outDir = join(sysPaths.cacheDir, 'git-diff');
    mkdirSync(outDir, { recursive: true });

    const fileName = `from-${sanitizePath(baseBranch)}-to-${sanitizePath(compareBranch)}.html`;
    const outPath = join(outDir, fileName);

    await Bun.write(outPath, html);

    console.log(`✅ Diff saved to: ${outPath}`);
    openFile(outPath);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-diff',
  description: 'Generate an HTML diff between two branches and open it in the browser',
};

export default run;
