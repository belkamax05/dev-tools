import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ClearDataDialog, {
  type ClearResult,
  type ClearTarget,
} from '@/dev-tools/ui/components/ClearDataDialog';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  DEFAULT_REFRESH_SECONDS,
  type ProcessiConfig,
  REFRESH_CHOICES,
} from '../../../config/settings';
import processiTheme from '../../theme';
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
  | { kind: 'theme'; id: string }
  | { kind: 'refresh'; seconds: number }
  | { kind: 'file' }
  | { kind: 'clear' };

const refreshLabel = (seconds: number) => (seconds === 0 ? 'Off' : `Every ${seconds}s`);

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
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (setting.kind === 'theme') onConfigChange({ ...config, theme: setting.id });
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
    { id: 'header-theme', label: 'Theme', isHeader: true },
    ...processiTheme.palettes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      hint: theme.id === config.theme ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: theme.id === config.theme,
      value: { kind: 'theme' as const, id: theme.id },
    })),
    { id: 'header-refresh', label: 'Auto refresh', isHeader: true },
    ...REFRESH_CHOICES.map((seconds) => ({
      id: `refresh:${seconds}`,
      label: refreshLabel(seconds),
      hint: [
        seconds === DEFAULT_REFRESH_SECONDS ? 'recommended' : '',
        seconds === config.refreshSeconds ? 'in use' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      hintColor: seconds === config.refreshSeconds ? colors.accent : undefined,
      isCurrent: seconds === config.refreshSeconds,
      value: { kind: 'refresh' as const, seconds },
    })),
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
      renderDetail={(item) => {
        const setting = item?.value;
        if (!setting) return null;
        if (setting.kind === 'theme') {
          const theme = processiTheme.palettes.find((candidate) => candidate.id === setting.id);
          return (
            <Box flexDirection="column">
              <Text bold color={theme?.colors.accent}>
                {theme?.label}
              </Text>
              <Text color={colors.muted}>{theme?.blurb}</Text>
            </Box>
          );
        }
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
              disk, after a confirmation that lists both. processi quits afterwards and starts from
              its defaults next time.
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
      }}
    />
  );
};

export default SettingsView;
