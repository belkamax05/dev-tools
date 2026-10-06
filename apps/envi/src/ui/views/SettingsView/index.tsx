import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ClearDataDialog, {
  ClearButton,
  type ClearResult,
  type ClearTarget,
} from '@/dev-tools/ui/components/ClearDataDialog';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useThemeSettings, { type ThemeSetting } from '@/dev-tools/ui/hooks/useThemeSettings';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import { DEFAULT_MASK_PATTERNS } from '../../../config/settings';
import { launchEnv, STAMP_VAR } from '../../../core/shell';
import type { ViewProps } from '../../App';

export interface SettingsViewProps extends ViewProps {
  configPath: string;
  /** The files the Clear dialog offers — envi's config and state stores. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | { kind: 'override' }
  | { kind: 'expand' }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'addPattern' }
  | { kind: 'hook'; shell: 'zsh' | 'bash' | 'fish' }
  | ThemeSetting
  | { kind: 'file' }
  | { kind: 'clear' };

const HOOK_FILES = {
  zsh: '~/.zshrc',
  bash: '~/.bashrc',
  fish: '~/.config/fish/config.fish',
};

const hookLine = (shell: 'zsh' | 'bash' | 'fish') =>
  shell === 'fish' ? 'envi hook fish | source' : `eval "$(envi hook ${shell})"`;

/**
 * How envi merges and shows things — override, expansion, which names count as secrets — the
 * line that hooks it into a shell, the theme, and the config file itself. Saved as it changes.
 */
export const SettingsView = ({
  config,
  configPath,
  session,
  notify,
  onConfigChange,
  onCaptureInput,
  onEdit,
  clearTargets,
  onCleared,
}: SettingsViewProps) => {
  const colors = useColors();
  const themes = useThemeSettings();
  const prompt = usePrompt(onCaptureInput);
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);
  const hooked = launchEnv()[STAMP_VAR] !== undefined;

  const addPattern = () =>
    prompt.ask('Mask names containing:', (value) => {
      const pattern = value.trim().toUpperCase();
      if (!pattern || config.maskPatterns.includes(pattern)) return;
      onConfigChange({
        ...config,
        maskPatterns: [...config.maskPatterns, pattern],
      });
    });

  const removePattern = (pattern: string) =>
    onConfigChange({
      ...config,
      maskPatterns: config.maskPatterns.filter((entry) => entry !== pattern),
    });

  const copyHook = (shell: 'zsh' | 'bash' | 'fish') => {
    copyToClipboard(hookLine(shell));
    notify(`Copied — paste it at the end of ${HOOK_FILES[shell]}`, 'ok');
  };

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (themes.owns(setting)) return themes.activate(setting);
    if (setting.kind === 'override') onConfigChange({ ...config, override: !config.override });
    else if (setting.kind === 'expand') onConfigChange({ ...config, expand: !config.expand });
    else if (setting.kind === 'pattern') removePattern(setting.pattern);
    else if (setting.kind === 'addPattern') addPattern();
    else if (setting.kind === 'hook') copyHook(setting.shell);
    else if (setting.kind === 'clear') setClearing(true);
    else onEdit(configPath);
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'e') onEdit(configPath);
      else if (input === 'X') setClearing(true);
      else if (current?.kind === 'pattern' && (input === 'x' || input === 'd'))
        removePattern(current.pattern);
      else if (current?.kind === 'hook' && input === 'c') copyHook(current.shell);
    },
    { isActive: !prompt.isOpen && !clearing },
  );

  const onOff = (value: boolean) => (value ? 'on' : 'off');

  const items: PickItem<Setting>[] = [
    { id: 'header-merge', label: 'Merging', isHeader: true },
    {
      id: 'override',
      label: `Override the shell: ${onOff(config.override)}`,
      hint: config.override ? 'envi wins' : 'shell wins',
      isCurrent: config.override,
      value: { kind: 'override' },
    },
    {
      id: 'expand',
      label: `Expand $VARS: ${onOff(config.expand)}`,
      isCurrent: config.expand,
      value: { kind: 'expand' },
    },
    {
      id: 'header-mask',
      label: `Secrets — names containing (${config.maskPatterns.length})`,
      isHeader: true,
    },
    ...config.maskPatterns.map((pattern) => ({
      id: `pattern:${pattern}`,
      label: pattern,
      value: { kind: 'pattern' as const, pattern },
    })),
    {
      id: 'addPattern',
      label: '+ Add a pattern…',
      value: { kind: 'addPattern' },
    },
    {
      id: 'header-hook',
      label: `Shell hook${hooked ? ' — active in this shell' : ''}`,
      isHeader: true,
    },
    ...(['zsh', 'bash', 'fish'] as const).map((shell) => ({
      id: `hook:${shell}`,
      label: shell,
      hint: HOOK_FILES[shell],
      value: { kind: 'hook' as const, shell },
    })),
    ...themes.items,
    { id: 'header-file', label: 'Config file', isHeader: true },
    { id: 'file', label: 'Open in $EDITOR', value: { kind: 'file' } },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & state…',
      hintColor: colors.error,
      hint: 'X',
      value: { kind: 'clear' },
    },
  ];

  const detail = (setting: Setting) => {
    if (themes.owns(setting)) return themes.renderDetail(setting);
    switch (setting.kind) {
      case 'override':
        return (
          <Text color={colors.muted} wrap="wrap">
            {config.override
              ? 'On: envi replaces a value the shell already exports. A variable you set by hand for one command (FOO=1 envi run …) is replaced too.'
              : 'Off, as in dotenv: a variable the shell already exports keeps its value, and envi only adds what is missing. The Resolved tab marks those "shell wins". An env.config.ts can set override for its folder.'}
          </Text>
        );
      case 'expand':
        return (
          <Text color={colors.muted} wrap="wrap">
            $NAME, ${'{NAME}'}, ${'{NAME:-fallback}'} and ${'{NAME-fallback}'} in unquoted and
            "double-quoted" values are replaced by what is set at that point. 'Single quotes' never
            expand. Off keeps every $ as written.
          </Text>
        );
      case 'pattern':
        return (
          <Box flexDirection="column">
            <Toolbar
              actions={[
                {
                  hotkey: 'x',
                  label: 'Remove',
                  onPress: () => removePattern(setting.pattern),
                  tone: 'danger',
                },
              ]}
            />
            <Text color={colors.muted} wrap="wrap">
              {`A variable whose name contains ${setting.pattern} (any case) has its value masked until [v] reveals secrets.${(DEFAULT_MASK_PATTERNS as readonly string[]).includes(setting.pattern) ? ' One of the defaults.' : ''}`}
            </Text>
          </Box>
        );
      case 'addPattern':
        return (
          <Text color={colors.muted} wrap="wrap">
            A fragment of a name — "STRIPE", "_DSN" — that marks a variable as a secret.
          </Text>
        );
      case 'hook':
        return (
          <Box flexDirection="column">
            <Toolbar
              actions={[
                {
                  hotkey: 'c',
                  label: 'Copy line',
                  onPress: () => copyHook(setting.shell),
                  tone: 'primary',
                },
              ]}
            />
            <Text color={colors.accent}>{hookLine(setting.shell)}</Text>
            <Text color={colors.muted} wrap="wrap">
              {`At the end of ${HOOK_FILES[setting.shell]}. envi then applies its layers whenever you cd, and again after it changes a file or setting itself — and takes them back when you leave the folder, restoring what the shell had. \`envi reload\` re-applies after an edit made elsewhere.`}
            </Text>
          </Box>
        );
      case 'file':
        return (
          <Box flexDirection="column">
            <Text color={colors.text}>{configPath}</Text>
            <Text color={colors.muted} wrap="wrap">
              Plain JSON: files, disabled, vars, override, expand, maskPatterns, theme. It holds
              your vars, so keep it out of a public dotfiles repository if any of them is a token.
            </Text>
          </Box>
        );
      case 'clear':
        return (
          <Text color={colors.muted} wrap="wrap">
            Remove envi's config (your file list, your vars, settings) and state (last tab) from
            disk, after a confirmation that lists both. envi quits afterwards.
          </Text>
        );
    }
  };

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear envi's settings and state"
        targets={clearTargets}
        onDone={onCleared}
        onCancel={() => setClearing(false)}
        onCaptureInput={onCaptureInput}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            Changes are saved as they are made
          </Text>
        )}
      </Box>
      <ListDetail
        key={config.maskPatterns.join(',')}
        title="Settings"
        items={items}
        detailTitle="Setting"
        reservedChrome={['viewHeader']}
        activateLabel="apply"
        initialSelectedId={session.selected.settings}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: 'e', label: 'edit file', onPress: () => onEdit(configPath) },
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
            {item?.value ? detail(item.value) : null}
          </Box>
        )}
      />
    </Box>
  );
};

export default SettingsView;
