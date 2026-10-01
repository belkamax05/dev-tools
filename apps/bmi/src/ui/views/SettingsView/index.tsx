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
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { BmiConfig } from '../../../config/settings';
import bmiTheme from '../../theme';
import type { Session } from '../../types';

export interface SettingsViewProps {
  config: BmiConfig;
  configPath: string;
  staticPath: string;
  /** Why the static list could not be read, when it could not. */
  staticError?: string;
  cacheDirectory: string;
  session: Session;
  onConfigChange: (config: BmiConfig) => void;
  /** Hand the terminal to `$EDITOR` on one of the two lists. */
  onEditFile: (path: string) => void;
  onCaptureInput: (captured: boolean) => void;
  /** The files the Clear dialog offers — bmi's config and preview cache. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | { kind: 'theme'; id: string }
  | { kind: 'auto'; on: boolean }
  | { kind: 'file'; which: 'user' | 'static' }
  | { kind: 'cache' }
  | { kind: 'clear' };

/**
 * The theme and whether previews are fetched as the cursor moves, saved as they are picked — plus
 * the two lists, each a key away from `$EDITOR`.
 */
export const SettingsView = ({
  config,
  configPath,
  staticPath,
  staticError,
  cacheDirectory,
  session,
  onConfigChange,
  onEditFile,
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
    else if (setting.kind === 'auto') onConfigChange({ ...config, autoPreview: setting.on });
    else if (setting.kind === 'file')
      onEditFile(setting.which === 'user' ? configPath : staticPath);
    else setClearing(true);
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'e') onEditFile(configPath);
      else if (input === 'E') onEditFile(staticPath);
      else if (input === 'X') setClearing(true);
    },
    { isActive: !clearing },
  );

  const items: PickItem<Setting>[] = [
    { id: 'header-theme', label: 'Theme', isHeader: true },
    ...bmiTheme.palettes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      hint: theme.id === config.theme ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: theme.id === config.theme,
      value: { kind: 'theme' as const, id: theme.id },
    })),
    { id: 'header-auto', label: 'Previews', isHeader: true },
    ...[true, false].map((on) => ({
      id: `auto:${on}`,
      label: on ? 'Fetch when the cursor lands on a page' : 'Only on [f] or `bmi fetch`',
      hint: on === config.autoPreview ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: on === config.autoPreview,
      value: { kind: 'auto' as const, on },
    })),
    { id: 'header-file', label: 'Lists', isHeader: true },
    {
      id: 'file:user',
      label: 'Your list — open in $EDITOR',
      hint: 'e',
      value: { kind: 'file', which: 'user' },
    },
    {
      id: 'file:static',
      label: 'Static list — open in $EDITOR',
      hint: staticError ? 'unreadable' : 'E',
      hintColor: staticError ? colors.error : undefined,
      value: { kind: 'file', which: 'static' },
    },
    { id: 'cache', label: 'Preview cache', value: { kind: 'cache' } },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & cache…',
      hint: 'X',
      hintColor: colors.error,
      value: { kind: 'clear' },
    },
  ];

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear bmi's settings and cache"
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
    if (setting.kind === 'theme') {
      const theme = bmiTheme.palettes.find((candidate) => candidate.id === setting.id);
      return (
        <Box flexDirection="column">
          <Text bold color={theme?.colors.accent}>
            {theme?.label}
          </Text>
          <Text color={colors.muted}>{theme?.blurb}</Text>
        </Box>
      );
    }
    if (setting.kind === 'auto') {
      return (
        <Text color={colors.muted} wrap="wrap">
          {setting.on
            ? 'A page is fetched once the cursor has rested on it, when it has no preview or one older than two weeks — its <head> only, never more than 512 KB, then its favicon.'
            : 'Nothing is fetched by itself. [f] on a page fetches its preview; `bmi fetch` fetches every page at once.'}
        </Text>
      );
    }
    if (setting.kind === 'file') {
      const isUser = setting.which === 'user';
      return (
        <Box flexDirection="column">
          <Text color={colors.text}>{isUser ? configPath : staticPath}</Text>
          {!isUser && staticError && (
            <Text color={colors.error} wrap="wrap">
              {staticError}
            </Text>
          )}
          <Text color={colors.muted} wrap="wrap">
            {isUser
              ? 'Your bookmarks and groups, plus the theme. Everything you add, retitle or tag in bmi is written here — safe to keep in dotfiles.'
              : 'The shared list, kept in git with bmi ($BMI_STATIC_FILE names another). bmi only reads it; on a page both lists name, your list wins.'}
          </Text>
          <Text color={colors.muted} wrap="wrap">
            {
              '{ "bookmarks": [url | { url, title?, description?, tags? }], "groups": [{ name, description?, tags?, bookmarks }] }'
            }
          </Text>
        </Box>
      );
    }
    if (setting.kind === 'cache') {
      return (
        <Box flexDirection="column">
          <Text color={colors.text}>{cacheDirectory}</Text>
          <Text color={colors.muted} wrap="wrap">
            previews.json holds each page's Open Graph title, description and image link; icons/
            holds favicons re-encoded as small PNGs, one per icon URL. All of it is fetched again
            when missing — [X] clears it along with the rest.
          </Text>
        </Box>
      );
    }
    return (
      <Text color={colors.muted} wrap="wrap">
        Remove bmi's config (theme and your own bookmarks!) and preview cache from disk, after a
        confirmation that lists each one. The static list is never touched.
      </Text>
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
          label: 'edit your list',
          onPress: () => onEditFile(configPath),
        },
        {
          key: 'E',
          label: 'edit static',
          onPress: () => onEditFile(staticPath),
        },
        { key: 'X', label: 'clear', onPress: () => setClearing(true) },
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
