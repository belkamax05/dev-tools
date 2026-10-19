import { Text, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { type Location, locationLabel, sameLocation } from '../../core/locations';

interface Pick {
  message: string;
  targets: Location[];
  /** Picked by Enter — the setTarget setting's place, usually. */
  preferred?: Location;
  onPick: (target: Location) => void;
}

/**
 * "Move API_URL to: [1] your vars [2] machine vars [3] .env [4] .env.user" — a choice of where a
 * value goes, drawn on the view's prompt line. A digit (or a click) picks; Enter takes the
 * preferred one, Esc cancels. It owns the keyboard while open, as `usePrompt` does.
 */
export const useLocationPicker = (onCaptureInput: (captured: boolean) => void) => {
  const colors = useColors();
  const [pick, setPick] = useState<Pick | undefined>(undefined);

  useEffect(() => {
    onCaptureInput(Boolean(pick));
  }, [pick, onCaptureInput]);

  const choose = (target: Location | undefined) => {
    if (!pick || !target) return;
    setPick(undefined);
    pick.onPick(target);
  };

  useInput(
    (input, key) => {
      if (!pick) return;
      if (key.escape) setPick(undefined);
      else if (key.return) choose(pick.preferred ?? pick.targets[0]);
      else if (/^[1-9]$/.test(input)) choose(pick.targets[Number(input) - 1]);
    },
    { isActive: Boolean(pick) },
  );

  const open = (
    message: string,
    targets: Location[],
    onPick: (target: Location) => void,
    preferred?: Location,
  ) => {
    if (!targets.length) return;
    setPick({ message, targets: targets.slice(0, 9), onPick, preferred });
  };

  const line: ReactNode | undefined = pick ? (
    <Box flexDirection="row">
      <Box flexShrink={0} marginRight={1}>
        <Text color={colors.accent}>{pick.message}</Text>
      </Box>
      <Box flexShrink={1} flexWrap="wrap">
        {pick.targets.map((target, index) => {
          const preferred = pick.preferred && sameLocation(target, pick.preferred);
          return (
            <ActionButton
              key={`${index}:${locationLabel(target)}`}
              hotkey={String(index + 1)}
              label={`${locationLabel(target)}${preferred ? ' ⏎' : ''}`}
              onPress={() => choose(target)}
            />
          );
        })}
        <ActionButton hotkey="Esc" label="Cancel" onPress={() => setPick(undefined)} />
      </Box>
    </Box>
  ) : undefined;

  return { open, line, isOpen: Boolean(pick) };
};

export default useLocationPicker;
