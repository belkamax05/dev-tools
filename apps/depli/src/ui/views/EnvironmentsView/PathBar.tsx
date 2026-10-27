import { type DOMElement, Text } from 'ink';
import { useRef } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** One step of the path — a click goes back to it; the last one is where you are. */
const Crumb = ({
  label,
  current,
  onPress,
}: {
  label: string;
  current: boolean;
  onPress: () => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onPress, isActive: !current });
  return (
    <Box ref={ref} flexShrink={0}>
      <Text
        bold={current}
        color={isHovered ? colors.accentText : current ? colors.heading : colors.accent}
        backgroundColor={isHovered ? colors.accent : undefined}
        underline={!current && !isHovered}
      >
        {label}
      </Text>
    </Box>
  );
};

export interface PathBarProps {
  /** Outermost first; the last is the page open. */
  crumbs: ReadonlyArray<{ label: string; onPress: () => void }>;
  /** Said at the right — the keys that move along it. */
  hint?: string;
}

/** Where a page is — `◂ Environments › ci › build-nodejs › #3257` — every step clickable. */
export const PathBar = ({ crumbs, hint }: PathBarProps) => {
  const colors = useColors();
  return (
    <Box flexShrink={0} flexDirection="row" paddingX={1} overflow="hidden">
      {crumbs.map((crumb, index) => (
        <Box key={`${index}:${crumb.label}`} flexShrink={0} flexDirection="row">
          {index > 0 && <Text color={colors.muted}>{' › '}</Text>}
          <Crumb
            label={crumb.label}
            current={index === crumbs.length - 1}
            onPress={crumb.onPress}
          />
        </Box>
      ))}
      <Box flexGrow={1} />
      {hint && (
        <Text color={colors.muted} wrap="truncate">
          {` ${hint}`}
        </Text>
      )}
    </Box>
  );
};

export default PathBar;
