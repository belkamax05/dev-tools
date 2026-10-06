import { Text, useInput } from 'ink';
import { type ReactNode, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ClearDataDialog, {
  ClearButton,
  type ClearResult,
  type ClearTarget,
} from '@/dev-tools/ui/components/ClearDataDialog';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useThemeSettings, { type ThemeSetting } from '@/dev-tools/ui/hooks/useThemeSettings';
import {
  type RefreshSetting,
  refreshLabel,
  refreshRows,
} from '@/dev-tools/ui/utils/choiceRows';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

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
  refreshSeconds: number;
  onRefreshChange: (seconds: number) => void;
  /** The files the Clear dialog offers — giti's config and state. Without them, no Clear row. */
  clearTargets?: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared?: (results: ClearResult[]) => void;
  onCaptureInput?: (captured: boolean) => void;
}

type Setting =
  | ThemeSetting
  | RefreshSetting
  | { kind: 'clear' };

/**
 * What a person chooses once and keeps: the colour theme and how often the dashboard re-reads the
 * repository on its own. Both are saved to giti's config as they are picked.
 */
export const SettingsView = ({
  refreshSeconds,
  onRefreshChange,
  clearTargets,
  onCleared,
  onCaptureInput,
}: SettingsViewProps) => {
  const colors = useColors();
  const themes = useThemeSettings();
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);
  const canClear = Boolean(clearTargets?.length && onCleared);

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (themes.owns(setting)) themes.activate(setting);
    else if (setting.kind === 'refresh') onRefreshChange(setting.seconds);
    else setClearing(true);
  };

  //? Space applies too, the same as Enter and a click
  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'X' && canClear) setClearing(true);
    },
    { isActive: !clearing },
  );

  const items: PickItem<Setting>[] = [
    ...themes.items,
    ...refreshRows(REFRESH_CHOICES, refreshSeconds, DEFAULT_REFRESH_SECONDS, colors.accent),
    ...(canClear
      ? [
          { id: 'header-reset', label: 'Reset', isHeader: true },
          {
            id: 'clear',
            label: 'Clear settings & state…',
            hint: 'X',
            hintColor: colors.error,
            value: { kind: 'clear' as const },
          },
        ]
      : []),
  ];

  if (clearing && clearTargets && onCleared) {
    return (
      <ClearDataDialog
        title="Clear giti's settings and state"
        targets={clearTargets}
        onDone={onCleared}
        onCancel={() => setClearing(false)}
        onCaptureInput={onCaptureInput}
      />
    );
  }

  const detailFor = (item: PickItem<Setting> | undefined): ReactNode => {
    const setting = item?.value;
    if (!setting) return null;
    if (themes.owns(setting)) return themes.renderDetail(setting);
    if (setting.kind === 'clear') {
      return (
        <Text color={colors.muted} wrap="wrap">
          Remove giti's config (theme, refresh rate) and state (last tab, Overview details) from
          disk, after a confirmation that lists both. giti quits afterwards and starts from its
          defaults next time.
        </Text>
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
  };

  return (
    <ListDetail
      title="Settings"
      items={items}
      emptyText="Nothing to set."
      detailTitle={
        current?.kind === 'refresh' ? 'Auto refresh' : current?.kind === 'clear' ? 'Reset' : 'Theme'
      }
      activateLabel="apply"
      onActivate={(item) => apply(item.value)}
      hints={canClear ? [{ key: 'X', label: 'clear all', onPress: () => setClearing(true) }] : []}
      onSelectionChange={(item) => setCurrent(item?.value)}
      renderDetail={(item) => (
        <Box flexDirection="column">
          {canClear && <ClearButton onPress={() => setClearing(true)} />}
          {detailFor(item)}
        </Box>
      )}
    />
  );
};

export default SettingsView;
