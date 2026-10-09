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
  session: Session;
  onEditConfig: () => void;
  onCaptureInput: (captured: boolean) => void;
  /** The files the Clear dialog offers — proji's config and state stores. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting = ThemeSetting | { kind: 'file' } | { kind: 'clear' };

/**
 * The theme, saved to `config.json` as it is picked. The show filter is not here: it is chosen
 * on the Commands tab and remembered as state. Aliases live in the project's `proji.config.ts`.
 */
export const SettingsView = ({
  configPath,
  session,
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
        title="Clear proji's settings and state"
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
          Remove proji's config (theme) and state (last tab, show filter) from disk, after a
          confirmation that lists both. proji quits afterwards and starts from its defaults next
          time. Project aliases in proji.config.ts are not touched.
        </Text>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color={colors.text}>{configPath}</Text>
        <Text color={colors.muted} wrap="wrap">
          Plain JSON, safe to keep in dotfiles. A project's aliases are not here but in its own
          proji.config.ts.
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
