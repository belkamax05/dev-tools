import { stateStore } from '../../../config/settings';
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
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { Session } from '../../types';

export interface SettingsViewProps {
  configPath: string;
  /** The project's depli.config.ts, when there is one. */
  projectPath?: string;
  session: Session;
  onEditFile: (path: string) => void;
  onCaptureInput: (captured: boolean) => void;
  /** The files the Clear dialog offers — depli's config and state stores. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting = ThemeSetting | { kind: 'file'; path: string } | { kind: 'clear' };

/** The theme, the two files depli reads, and a reset — processi's settings tab, minus refresh. */
export const SettingsView = ({
  configPath,
  projectPath,
  session,
  onEditFile,
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
    else if (setting.kind === 'clear') setClearing(true);
    else onEditFile(setting.path);
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'e') onEditFile(current?.kind === 'file' ? current.path : configPath);
      else if (input === 'X') setClearing(true);
    },
    { isActive: !clearing },
  );

  const items: PickItem<Setting>[] = [
    ...themes.items,
    { id: 'header-file', label: 'Files', isHeader: true },
    { id: 'file', label: 'Settings in $EDITOR', value: { kind: 'file', path: configPath } },
    { id: 'state-file', label: 'State in $EDITOR', value: { kind: 'file', path: stateStore.path } },
    ...(projectPath
      ? [
          {
            id: 'project',
            label: 'depli.config.ts in $EDITOR',
            value: { kind: 'file' as const, path: projectPath },
          },
        ]
      : []),
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
        title="Clear depli's settings and state"
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
          Remove depli's config (theme) and state (last tab) from disk, after a confirmation that
          lists both. depli quits afterwards. depli.config.ts is the project's and is not touched.
        </Text>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color={colors.text}>{setting.path}</Text>
        <Text color={colors.muted} wrap="wrap">
          {setting.path === stateStore.path
            ? 'Last tab, and each project’s selected branch and environment. Reloaded after editing.'
            : setting.path === configPath
              ? 'Plain JSON, safe to keep in dotfiles.'
              : 'The targets this project deploys to and their options — secrets stay in the environment.'}
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
        {
          key: 'e',
          label: 'edit file',
          onPress: () => onEditFile(current?.kind === 'file' ? current.path : configPath),
        },
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
