import pickCommand from '@/dev-tools/ui/dialogs/pickCommand';
import getCommandEntries from '../../utils/getCommandEntries';
import getCommandPickerItems from '../../utils/getCommandPickerItems';

interface Options {
  /**
   * Groups to descend into before the first render, outermost first.
   *
   * E.g. `['mega']` opens the picker already inside the mega group, so `giti mega` behaves
   * like pressing Enter on the mega folder from the top-level picker.
   */
  initialPath?: string[];
}

/**
 * Browse giti commands interactively and resolve with the one picked, or `undefined` when the
 * user backs out.
 *
 * Dispatching is left to `src/cli/index.ts`: the returned name is exactly what the CLI resolves
 * onto a file, so the picker feeds the one dispatch path instead of growing a second one.
 */
const renderInkCommands = async ({ initialPath }: Options = {}): Promise<string | undefined> => {
  const entries = await getCommandEntries();

  const selection = await pickCommand({
    items: getCommandPickerItems(entries),
    title: 'giti TUI',
    commandPrefix: 'giti',
    initialPath,
  });

  return selection?.item.value;
};

export default renderInkCommands;
