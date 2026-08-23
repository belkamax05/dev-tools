import { render } from 'ink';
import type PickerItem from '../../../types/PickerItem';
import type PickerSelection from '../../../types/PickerSelection';
import CommandPicker from '../../components/CommandPicker';
import renderInkImmediate from '../../utils/renderInkImmediate';

export interface PickCommandOptions {
  items: PickerItem[];
  /** Shown in the header, e.g. `giti` or `shu`. */
  title: string;
  /** Leads the example command line — defaults to `title`. */
  commandPrefix?: string;
}

/**
 * Show the interactive command browser and resolve with what the user picked, or `undefined`
 * when they backed out.
 *
 * The whole Ink tree is mounted and torn down in here, with this lib's own `ink`, so callers
 * exchange plain data with it and never a React element — see {@link PickerItem}.
 */
const pickCommand = async ({
  items,
  title,
  commandPrefix,
}: PickCommandOptions): Promise<PickerSelection | undefined> => {
  let settle: (selection: PickerSelection | undefined) => void;
  const picked = new Promise<PickerSelection | undefined>((resolve) => {
    settle = resolve;
  });

  return renderInkImmediate<PickerSelection | undefined>(
    <CommandPicker
      items={items}
      title={title}
      commandPrefix={commandPrefix}
      onPick={(selection) => settle(selection)}
      onCancel={() => settle(undefined)}
    />,
    {
      render,
      //? The menu is transient — its frame is erased before the picked command runs
      clear: true,
      until: picked,
      //? Long-lived TUI, so console output has to be kept out of the rendered frame
      patchConsole: true,
    },
  );
};

export default pickCommand;
