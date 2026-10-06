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
import { type RefreshSetting, refreshRows } from '@/dev-tools/ui/utils/choiceRows';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  DEFAULT_REFRESH_SECONDS,
  type ProcessiConfig,
  REFRESH_CHOICES,
} from '../../../config/settings';
import type { Session } from '../../types';

export interface SettingsViewProps {
  config: ProcessiConfig;
  configPath: string;
  session: Session;
  onConfigChange: (config: ProcessiConfig) => void;
  onEditConfig: () => void;
  onCaptureInput: (captured: boolean) => void;
  /** The files the Clear dialog offers — processi's config and state stores. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | ThemeSetting
  | RefreshSetting
  | { kind: 'file' }
  | { kind: 'clear' };

/**
 * The theme and the refresh rate, saved to `config.json` as they are picked. The sort and scope
 * are not here: they are chosen on the process tabs and remembered as state.
 */
export const SettingsView = ({
  config,
  configPath,
  session,
  onConfigChange,
  onEditConfig,
  onCaptureInput,
  clearTargets,
  onCleared,
}: SettingsViewProps) => {
  const colors = useColors();
  const themes = useThemeSettings();
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (themes.owns(setting)) themes.activate(setting);
    else if (setting.kind === 'refresh')
      onConfigChange({ ...config, refreshSeconds: setting.seconds });
    else if (setting.kind === 'clear') setClearing(true);
    else onEditConfig();
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'e') onEditConfig();
      else if (input === 'X') setClearing(true);
    },
    { isActive: !clearing },
  );

  const items: PickItem<Setting>[] = [
    ...themes.items,
    ...refreshRows(REFRESH_CHOICES, config.refreshSeconds, DEFAULT_REFRESH_SECONDS, colors.accent),
    { id: 'header-file', label: 'Config file', isHeader: true },
    { id: 'file', label: 'Open in $EDITOR', value: { kind: 'file' as const } },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & state…',
      hint: 'X',
      hintColor: colors.error,
      value: { kind: 'clear' as const },
    },
  ];

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear processi's settings and state"
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
    if (setting.kind === 'refresh') {
      return (
        <Text color={colors.muted} wrap="wrap">
          {setting.seconds === 0
            ? 'The table is read when a tab opens, after an action and on [r] — never on its own.'
            : `The process table is re-read every ${setting.seconds}s, and CPU is what each process used over that interval. The timer stops while a question is on screen.`}
        </Text>
      );
    }
    if (setting.kind === 'clear') {
      return (
        <Text color={colors.muted} wrap="wrap">
          Remove processi's config (theme, refresh rate) and state (last tab, sort, scope) from
          disk, after a confirmation that lists both. processi quits afterwards and starts from its
          defaults next time.
        </Text>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color={colors.text}>{configPath}</Text>
        <Text color={colors.muted} wrap="wrap">
          Plain JSON, safe to keep in dotfiles. The tab, sort and scope are kept apart, in
          processi's state directory.
        </Text>
      </Box>
    );
  };

  return (
    <ListDetail
      title="Settings"
      items={items}
      detailTitle="Setting"
      activateLabel="apply"
      initialSelectedId={session.selected.settings}
      hints={[
        { key: 'e', label: 'edit file', onPress: onEditConfig },
        { key: 'X', label: 'clear all', onPress: () => setClearing(true) },
      ]}
      onActivate={(item) => apply(item.value)}
      onSelectionChange={(item) => {
        setCurrent(item?.value);
        session.selected.settings = item?.id;
      }}
      renderDetail={(item) => (
        <Box flexDirection="column">
          <ClearButton onPress={() => setClearing(true)} />
          {detailFor(item)}
        </Box>
      )}
    />
  );
};

export default SettingsView;
