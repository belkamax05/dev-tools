import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ClearDataDialog, {
  ClearButton,
  type ClearResult,
  type ClearTarget,
} from '@/dev-tools/ui/components/ClearDataDialog';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type FolderSettings,
  PACKAGE_MANAGERS,
  type PackageManagerName,
  PROJECT_CONFIG_TEMPLATE,
  userConfigStore,
} from '../../../config/settings';
import { pkgiCacheDir } from '../../../config/paths';
import { toAbsolute, toRelative } from '../../../core/compare';
import pkgiTheme from '../../theme';
import type { ViewProps } from '../../types';
import { type OfferedFolder, offeredFolders } from '../CompareView';
import { TYPE_LABELS } from '../PackagesView';

export interface SettingsViewProps extends ViewProps {
  theme: string;
  onThemeChange: (theme: string) => void;
  onEdit: (path: string) => void;
  /** The files the Clear dialog offers — pkgi's config, its state, and this folder's state. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | { kind: 'unstable' }
  | { kind: 'installAs' }
  | { kind: 'type'; type: DependencyType }
  | { kind: 'manager' }
  | { kind: 'folder'; folder: OfferedFolder }
  | { kind: 'addFolder' }
  | { kind: 'theme'; id: string }
  | { kind: 'projectConfig' }
  | { kind: 'stateFile' }
  | { kind: 'userConfig' }
  | { kind: 'cache' }
  | { kind: 'clear' };

/**
 * pkgi's settings for this folder, and where each one comes from.
 *
 * A setting changed here is saved in the folder's state file and overrides `pkgi.config.ts`,
 * which overrides pkgi's default — the source is shown on every row, and `x` drops the override.
 * The compare folders are listed with the ones found nearby, so adding one is picking it from a
 * list rather than typing its path.
 */
export const SettingsView = ({
  dir,
  context,
  manager,
  session,
  notify,
  onCaptureInput,
  updateState,
  refreshKey,
  theme,
  onThemeChange,
  onEdit,
  clearTargets,
  onCleared,
}: SettingsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const { settings, project, state } = context;
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);

  const configPaths = project.config.comparePaths ?? [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined lists are the identity
  const folders = useMemo(
    () => offeredFolders(dir, configPaths, state.comparePaths),
    [dir, configPaths.join('|'), state.comparePaths.join('|'), refreshKey],
  );

  const sourceOf = (key: keyof FolderSettings) =>
    key in state.settings ? 'set here' : key in project.config ? 'pkgi.config.ts' : 'default';

  const set = <K extends keyof FolderSettings>(key: K, value: FolderSettings[K] | undefined) =>
    updateState((next) => {
      if (value === undefined) delete next.settings[key];
      else next.settings[key] = value;
      return next;
    });

  const reset = (key: keyof FolderSettings) => {
    if (!(key in state.settings)) {
      notify(`${key} is not overridden here`);
      return;
    }
    set(key, undefined);
    notify(`${key} back to ${key in project.config ? 'pkgi.config.ts' : 'the default'}`, 'ok');
  };

  const keyOf = (setting: Setting): keyof FolderSettings | undefined =>
    setting.kind === 'unstable'
      ? 'showUnstable'
      : setting.kind === 'installAs'
        ? 'installAs'
        : setting.kind === 'type'
          ? 'dependencyTypes'
          : setting.kind === 'manager'
            ? 'packageManager'
            : undefined;

  const saveFolder = (folder: OfferedFolder) =>
    updateState((next) => {
      next.comparePaths = [...new Set([...next.comparePaths, folder.path])];
      return next;
    });

  const forgetFolder = (folder: OfferedFolder) => {
    if (folder.source === 'config') {
      notify(`${folder.path} comes from pkgi.config.ts — remove it there`, 'warn');
      return;
    }
    if (folder.source !== 'saved') return;
    prompt.confirm(`Forget ${folder.path}?`, () =>
      updateState((next) => {
        next.comparePaths = next.comparePaths.filter((path) => path !== folder.path);
        next.compareSelection = next.compareSelection.filter((path) => path !== folder.path);
        return next;
      }),
    );
  };

  const addFolder = () =>
    prompt.ask('Folder to offer on the Compare tab (relative or absolute):', (value) => {
      const path = value.trim();
      if (!path) return;
      const abs = toAbsolute(dir, path);
      if (!existsSync(join(abs, 'package.json'))) {
        notify(`${abs} has no package.json`, 'error');
        return;
      }
      updateState((next) => {
        next.comparePaths = [...new Set([...next.comparePaths, toRelative(dir, abs)])];
        return next;
      });
      notify(`Added ${toRelative(dir, abs)}`, 'ok');
    });

  const editProjectConfig = async () => {
    if (project.path) {
      onEdit(project.path);
      return;
    }
    const target = join(dir, 'pkgi.config.ts');
    try {
      await writeFile(target, PROJECT_CONFIG_TEMPLATE);
      onEdit(target);
    } catch (error) {
      notify(`Could not write ${target}: ${(error as Error).message}`, 'error');
    }
  };

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    switch (setting.kind) {
      case 'unstable':
        set('showUnstable', !settings.showUnstable);
        return;
      case 'installAs':
        set('installAs', settings.installAs === 'prod' ? 'dev' : 'prod');
        return;
      case 'type': {
        const on = settings.dependencyTypes.includes(setting.type);
        const next = on
          ? settings.dependencyTypes.filter((type) => type !== setting.type)
          : DEPENDENCY_TYPES.filter(
              (type) => type === setting.type || settings.dependencyTypes.includes(type),
            );
        if (!next.length) {
          notify('At least one section has to be listed', 'warn');
          return;
        }
        set('dependencyTypes', next);
        return;
      }
      case 'manager': {
        const cycle: (PackageManagerName | undefined)[] = [undefined, ...PACKAGE_MANAGERS];
        const at = cycle.indexOf(settings.packageManager);
        const next = cycle[(at + 1) % cycle.length];
        //? "Detect" has to be stored as an override too, or one set in pkgi.config.ts could
        //? never be switched back to detection from here
        if (next === undefined && 'packageManager' in project.config) {
          notify('pkgi.config.ts sets the package manager — [x] drops the override here', 'warn');
        }
        set('packageManager', next);
        return;
      }
      case 'folder':
        if (setting.folder.source === 'found') {
          saveFolder(setting.folder);
          notify(`${setting.folder.path} will be offered on the Compare tab`, 'ok');
        } else forgetFolder(setting.folder);
        return;
      case 'addFolder':
        addFolder();
        return;
      case 'theme':
        onThemeChange(setting.id);
        return;
      case 'projectConfig':
        void editProjectConfig();
        return;
      case 'stateFile':
        if (existsSync(context.statePath)) onEdit(context.statePath);
        else notify('Not written yet — it is created on the first note or setting saved here');
        return;
      case 'userConfig':
        onEdit(userConfigStore.path);
        return;
      case 'cache':
        notify(`Registry answers are cached in ${pkgiCacheDir()} — [c] on Packages refreshes them`);
        return;
      case 'clear':
        setClearing(true);
        return;
    }
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'a') addFolder();
      else if (input === 'X') setClearing(true);
      else if (input === 'x' && current) {
        const key = keyOf(current);
        if (key) reset(key);
        else if (current.kind === 'folder') forgetFolder(current.folder);
      }
    },
    { isActive: !prompt.isOpen && !clearing },
  );

  const onOff = (value: boolean) => (value ? 'on' : 'off');
  const items: PickItem<Setting>[] = [
    { id: 'header-folder', label: 'This folder', isHeader: true },
    {
      id: 'unstable',
      label: 'Show prereleases',
      hint: `${onOff(settings.showUnstable)} · ${sourceOf('showUnstable')}`,
      value: { kind: 'unstable' },
    },
    {
      id: 'installAs',
      label: 'Add new packages as',
      hint: `${settings.installAs} · ${sourceOf('installAs')}`,
      value: { kind: 'installAs' },
    },
    ...DEPENDENCY_TYPES.map((type) => ({
      id: `type:${type}`,
      label: `List ${TYPE_LABELS[type].toLowerCase()}`,
      hint: `${onOff(settings.dependencyTypes.includes(type))} · ${sourceOf('dependencyTypes')}`,
      value: { kind: 'type' as const, type },
    })),
    {
      id: 'manager',
      label: 'Package manager',
      hint: `${settings.packageManager ?? `detect (${manager.name})`} · ${sourceOf('packageManager')}`,
      value: { kind: 'manager' },
    },
    { id: 'header-compare', label: 'Compare folders', isHeader: true },
    ...folders
      .filter((folder) => folder.source !== 'found')
      .map((folder) => ({
        id: `folder:${folder.abs}`,
        label: folder.path,
        hint: folder.source === 'config' ? 'pkgi.config.ts' : 'saved',
        hintColor: folder.hasManifest ? undefined : colors.error,
        value: { kind: 'folder' as const, folder },
      })),
    { id: 'addFolder', label: '+ Add a folder by path…', value: { kind: 'addFolder' as const } },
    ...(folders.some((folder) => folder.source === 'found')
      ? [
          { id: 'header-found', label: 'Found nearby — Enter adds', isHeader: true },
          ...folders
            .filter((folder) => folder.source === 'found')
            .map((folder) => ({
              id: `folder:${folder.abs}`,
              label: `+ ${folder.path}`,
              value: { kind: 'folder' as const, folder },
            })),
        ]
      : []),
    { id: 'header-theme', label: 'Theme', isHeader: true },
    ...pkgiTheme.palettes.map((palette) => ({
      id: `theme:${palette.id}`,
      label: palette.label,
      hint: palette.id === theme ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: palette.id === theme,
      value: { kind: 'theme' as const, id: palette.id },
    })),
    { id: 'header-files', label: 'Files', isHeader: true },
    {
      id: 'projectConfig',
      label: 'pkgi.config.ts',
      hint: project.path ? (project.error ? 'error' : 'edit') : 'create',
      hintColor: project.error ? colors.error : undefined,
      value: { kind: 'projectConfig' },
    },
    {
      id: 'stateFile',
      label: 'Notes & state',
      hint: existsSync(context.statePath) ? 'edit' : 'not written yet',
      value: { kind: 'stateFile' },
    },
    { id: 'userConfig', label: 'Theme (user config)', value: { kind: 'userConfig' } },
    { id: 'cache', label: 'Registry cache', value: { kind: 'cache' } },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & state…',
      hint: 'X',
      hintColor: colors.error,
      value: { kind: 'clear' },
    },
  ];

  const describe = (setting: Setting) => {
    switch (setting.kind) {
      case 'unstable':
        return 'Offer prereleases (the newest of next / beta / canary / rc ahead of latest) as updates, and list them in the version picker.';
      case 'installAs':
        return 'Whether the Add tab and `pkgi add` put a new package in dependencies or devDependencies. [d] on the Add tab flips it for one install.';
      case 'type':
        return `Whether ${setting.type} are listed on the Packages tab and by \`pkgi list\`.`;
      case 'manager':
        return `Commands run with ${manager.name} — ${manager.reason}. Enter cycles detect → bun → npm → yarn → pnpm.`;
      case 'folder':
        return setting.folder.source === 'found'
          ? `${setting.folder.abs} — a workspace member or sibling project. Enter saves it to this folder's compare list.`
          : setting.folder.source === 'config'
            ? `${setting.folder.abs} — listed in pkgi.config.ts, so offered to everyone who runs pkgi here.`
            : `${setting.folder.abs} — saved for this folder. [x] forgets it.`;
      case 'addFolder':
        return "A folder with a package.json, relative to this one or absolute. It is saved to this folder's state and offered on the Compare tab.";
      case 'theme': {
        const palette = pkgiTheme.palettes.find((candidate) => candidate.id === setting.id);
        return palette?.blurb ?? '';
      }
      case 'projectConfig':
        return project.path
          ? `${project.path}${project.error ? `\n\nIgnored: ${project.error}` : ''}\n\nThe folder's defaults, shared with everyone who runs pkgi here. Enter opens it in $EDITOR.`
          : `No pkgi.config.ts here. Enter writes a commented one with every setting at its default, and opens it.`;
      case 'stateFile':
        return `${context.statePath}\n\nNotes, compare folders and the settings changed here. ${
          project.config.stateFile
            ? 'Placed by stateFile in pkgi.config.ts.'
            : 'Outside the repository by default; set stateFile in pkgi.config.ts to keep it in the repo and share the notes.'
        }`;
      case 'userConfig':
        return `${userConfigStore.path}\n\nThe theme — the one setting that is yours everywhere rather than per folder.`;
      case 'cache':
        return `${pkgiCacheDir()}\n\nRegistry answers are reused for ${settings.cacheHours}h (cacheHours) and support data from endoflife.date for a week. Safe to delete.`;
      case 'clear':
        return "Remove pkgi's config (theme) and state (last tab) from disk, after a confirmation that lists them — and, if you tick it, this folder's notes, compare folders and settings too. pkgi quits afterwards and starts from its defaults next time.";
    }
  };

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear pkgi's settings and state"
        targets={clearTargets}
        onDone={onCleared}
        onCancel={() => setClearing(false)}
        onCaptureInput={onCaptureInput}
      />
    );
  }

  const key = current && keyOf(current);
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <LinkRow
            label="Saved per folder in"
            labelWidth={20}
            value={context.statePath}
            onOpen={() => apply({ kind: 'stateFile' })}
          />
        )}
      </Box>
      <ListDetail
        key={`${folders.length}|${state.comparePaths.length}`}
        title="Settings"
        items={items}
        detailTitle="Setting"
        reservedChrome={['viewHeader']}
        activateLabel="change"
        initialSelectedId={session.selected.settings}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: 'a', label: 'add folder', onPress: addFolder },
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
          return (
            <Box flexDirection="column">
              <ClearButton onPress={() => setClearing(true)} />
              {key && key in state.settings && (
                <Toolbar
                  actions={[{ hotkey: 'x', label: 'Drop the override', onPress: () => reset(key) }]}
                />
              )}
              <Text color={colors.text} wrap="wrap">
                {describe(setting)}
              </Text>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default SettingsView;
