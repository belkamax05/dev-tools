import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import gitiTheme from '../../theme';

/** Seconds between background re-reads of the repository; 0 switches them off. */
export const REFRESH_CHOICES = [0, 2, 5, 10, 30] as const;

/**
 * 5s: `git status` is cheap even in a large tree, and the file watcher already catches almost
 * every change as it happens — the timer is the safety net for what it misses (a network drive,
 * a platform with no recursive watch, a change made while the watcher was out of handles), so it
 * only has to be quick enough that nothing looks stale for long.
 */
export const DEFAULT_REFRESH_SECONDS = 5;

export interface SettingsViewProps {
  paletteId: string;
  onThemeChange: (id: string) => void;
  refreshSeconds: number;
  onRefreshChange: (seconds: number) => void;
}

type Setting = { kind: 'theme'; id: string } | { kind: 'refresh'; seconds: number };

const refreshLabel = (seconds: number) => (seconds === 0 ? 'Off' : `Every ${seconds}s`);

/**
 * What a person chooses once and keeps: the colour theme and how often the dashboard re-reads the
 * repository on its own. Both are saved to giti's config as they are picked.
 */
export const SettingsView = ({
  paletteId,
  onThemeChange,
  refreshSeconds,
  onRefreshChange,
}: SettingsViewProps) => {
  const colors = useColors();
  const [current, setCurrent] = useState<Setting | undefined>(undefined);

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (setting.kind === 'theme') onThemeChange(setting.id);
    else onRefreshChange(setting.seconds);
  };

  //? Space applies too, the same as Enter and a click
  useInput((input) => {
    if (input === ' ') apply(current);
  });

  const items: PickItem<Setting>[] = [
    { id: 'header-theme', label: 'Theme', isHeader: true },
    ...gitiTheme.palettes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      hint: theme.id === paletteId ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: theme.id === paletteId,
      value: { kind: 'theme' as const, id: theme.id },
    })),
    { id: 'header-refresh', label: 'Auto refresh', isHeader: true },
    ...REFRESH_CHOICES.map((seconds) => ({
      id: `refresh:${seconds}`,
      label: refreshLabel(seconds),
      hint: [
        seconds === DEFAULT_REFRESH_SECONDS ? 'recommended' : '',
        seconds === refreshSeconds ? 'in use' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      hintColor: seconds === refreshSeconds ? colors.accent : undefined,
      isCurrent: seconds === refreshSeconds,
      value: { kind: 'refresh' as const, seconds },
    })),
  ];

  return (
    <ListDetail
      title="Settings"
      items={items}
      emptyText="Nothing to set."
      detailTitle={current?.kind === 'refresh' ? 'Auto refresh' : 'Theme'}
      activateLabel="apply"
      hints={[{ key: 'Space', label: 'apply', onPress: () => apply(current) }]}
      onActivate={(item) => apply(item.value)}
      onSelectionChange={(item) => setCurrent(item?.value)}
      renderDetail={(item) => {
        const setting = item?.value;
        if (!setting) return null;
        if (setting.kind === 'theme') {
          const theme = gitiTheme.palettes.find((t) => t.id === setting.id);
          return (
            <Box flexDirection="column">
              <Text bold color={theme?.colors.accent}>
                {theme?.label}
              </Text>
              <Text color={colors.muted}>{theme?.blurb}</Text>
            </Box>
          );
        }
        return (
          <Box flexDirection="column">
            <Text bold color={colors.accent}>
              {refreshLabel(setting.seconds)}
            </Text>
            <Text color={colors.muted} wrap="wrap">
              {setting.seconds === 0
                ? 'Only the file watcher keeps the dashboard current — a change it misses shows after [r] or the next action.'
                : `The repository is re-read every ${setting.seconds}s in the background, on top of the file watcher, so nothing stays stale for longer than that.`}
            </Text>
          </Box>
        );
      }}
    />
  );
};

export default SettingsView;
