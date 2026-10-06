import { MultiSelect } from '@inkjs/ui';
import { Box, render, Text, useInput } from 'ink';

import renderInkImmediate from '@/dev-tools/ui/utils/renderInkImmediate';

interface PickPackagesProps {
  message: string;
  names: string[];
  onDone: (picked: string[]) => void;
}

const PickPackages = ({ message, names, onDone }: PickPackagesProps) => {
  useInput((_input, key) => {
    if (key.escape) onDone([]);
  });
  return (
    <Box flexDirection="column">
      <Text bold>{message}</Text>
      <Text dimColor>Space ticks · Enter confirms · Esc cancels</Text>
      <MultiSelect
        options={names.map((name) => ({ label: name, value: name }))}
        visibleOptionCount={Math.min(names.length, 15)}
        onSubmit={onDone}
      />
    </Box>
  );
};

/**
 * Tick packages from a list — `pkgi remove` with no names. Resolves with the ticked ones, empty
 * when the user backed out. Mounted and torn down in here, so the scripted commands around it
 * never load Ink unless they get this far.
 */
const pickPackages = async (message: string, names: string[]): Promise<string[]> => {
  let settle: (picked: string[]) => void = () => {};
  const picked = new Promise<string[]>((resolve) => {
    settle = resolve;
  });
  return (
    (await renderInkImmediate<string[]>(
      <PickPackages message={message} names={names} onDone={(names) => settle(names)} />,
      { render, clear: true, until: picked, exitOnCtrlC: true },
    )) ?? []
  );
};

export default pickPackages;
