import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { Text, useInput } from 'ink';
import { type ReactNode, useState } from 'react';

import { graphicsSupport } from '@/dev-tools/terminal-canvas';
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
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import useThemeSettings, { type ThemeSetting } from '@/dev-tools/ui/hooks/useThemeSettings';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';
import revealPath from '@/dev-tools/utils/system/revealPath';

import { findIdeBinary, IDES, type IdeDefinition } from '../../../core/ides';
import { launchDetached, launchPlan } from '../../../core/launch';
import { LOGO_MODES, type LogoMode, resolveLogoTechnique } from '../../logo';
import IdeLogo from '../../logo/IdeLogo';
import type { ViewProps } from '../../types';

export interface SettingsViewProps extends ViewProps {
  /** Make an IDE the primary one — adding it if it was not in the set; the app's switch, which reports it. */
  onSelectIde: (id: string) => void;
  /** Add an IDE to the set kept in step, or take it out (never the last one) — the app's switch, which reports what it did. */
  onToggleIde: (id: string) => void;
  /** agenti's config file — shown, and openable, so where a choice goes is never a mystery. */
  settingsPath: string;
  /** Its state file, where the IDE choices per repository are kept. */
  statePath: string;
  /** False while this repo is still on an inherited default rather than its own pick. */
  hasOwnChoice: boolean;
  /** How logos are drawn — kept in the settings, so `g` is remembered. */
  logoMode: LogoMode;
  onLogoModeChange: (mode: LogoMode) => void;
  /** The files the Clear dialog offers — agenti's config and state. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | { kind: 'ide'; ide: IdeDefinition }
  | ThemeSetting
  | { kind: 'logo'; mode: LogoMode }
  | { kind: 'file'; which: 'config' | 'state' }
  | { kind: 'clear' };

const LOGO_BLURB: Record<LogoMode, string> = {
  auto: 'The best the terminal can do: kitty graphics where supported, braille otherwise.',
  kitty: 'Real pixels through the kitty graphics protocol — kitty, WezTerm, Ghostty.',
  braille: 'Braille dots: eight to a cell, in colour, in any terminal with a Unicode font.',
  ascii: 'Plain characters, for terminals and fonts where nothing else draws.',
};

/** Repo-relative for anything in the repo, `~/…` for anything else under home. */
const shorten = (path: string, root: string) => {
  if (path.startsWith(`${root}/`)) return relative(root, path);
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
};

/** One line of the IDE detail pane; `open` makes it a link. */
interface DetailLine {
  label: string;
  value: string;
  color: string;
  open?: () => void;
}

/**
 * agenti's settings, like every dev-tools app's Settings tab — with the IDE picker as its first
 * section, since the IDEs a repository is kept in step with are the setting every other tab
 * reads.
 *
 * Sections: IDE (which IDEs, which is primary, launch, the IDE's files), Theme, Logo drawing,
 * Files (agenti's config and state), Reset (the shared Clear dialog).
 *
 * On an IDE row the keyboard can move into the detail pane — `→` — to walk its links (binary,
 * folder, MCP file) with `↑`/`↓` and open them with Enter; `←` comes back. Space ticks an IDE
 * in or out; Enter makes it primary. On every other row Space and Enter both apply.
 */
export const SettingsView = ({
  root,
  ides,
  session,
  notify,
  handoff,
  isActive,
  onCaptureInput,
  onSelectIde,
  onToggleIde,
  settingsPath,
  statePath,
  hasOwnChoice,
  logoMode,
  onLogoModeChange,
  clearTargets,
  onCleared,
}: SettingsViewProps) => {
  const colors = useColors();
  const themes = useThemeSettings();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [clearing, setClearing] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>(
    session.selected.settings ?? (ides[0] ? `ide:${ides[0].id}` : undefined),
  );
  //? Kept in the session as well, so opening a link in the editor comes back
  //? with that same link highlighted rather than the keyboard back on the list
  const [focus, setFocusState] = useState(session.ideFocus.pane);
  const [linkIndex, setLinkIndexState] = useState(session.ideFocus.link);
  const setFocus = (pane: 'list' | 'detail') => {
    session.ideFocus.pane = pane;
    setFocusState(pane);
  };
  const setLinkIndex = (next: number | ((at: number) => number)) =>
    setLinkIndexState((at) => {
      const value = typeof next === 'function' ? next(at) : next;
      session.ideFocus.link = value;
      return value;
    });

  const primary = ides[0];
  const included = (candidate: IdeDefinition) => ides.some((one) => one.id === candidate.id);

  const choose = (candidate: IdeDefinition | undefined) => {
    if (!candidate || candidate.id === primary?.id) return;
    onSelectIde(candidate.id);
  };

  const toggle = (candidate: IdeDefinition | undefined) => {
    if (candidate) onToggleIde(candidate.id);
  };

  const launch = (candidate: IdeDefinition | undefined) => {
    if (!candidate) return;
    const plan = launchPlan(candidate, root);
    if (!plan) return notify(`${candidate.name} is not installed`, 'warn');
    if (plan.terminal)
      handoff({ type: 'run', command: plan.command, cwd: plan.cwd, label: candidate.name });
    else {
      const result = launchDetached(plan);
      notify(result.message, result.ok ? 'ok' : 'error');
    }
  };

  const cycleLogoMode = () =>
    onLogoModeChange(LOGO_MODES[(LOGO_MODES.indexOf(logoMode) + 1) % LOGO_MODES.length] ?? 'auto');

  const openFile = (which: 'config' | 'state') => {
    const path = which === 'config' ? settingsPath : statePath;
    if (existsSync(path)) handoff({ type: 'edit', path });
    else notify(`${shorten(path, root)} is not written yet — it is created on the first change`);
  };

  const linesFor = (candidate: IdeDefinition): DetailLine[] => {
    const binary = findIdeBinary(candidate);
    const folder = join(root, candidate.folder);
    const folderState = !existsSync(folder)
      ? 'not created yet'
      : lstatSync(folder).isSymbolicLink()
        ? 'one link to .agents'
        : 'a folder';
    const mcpFile = candidate.mcp.find((target) => target.kind === 'file');
    const mcpPath = mcpFile?.kind === 'file' ? mcpFile.path(root) : undefined;
    return [
      {
        label: 'binary',
        value: binary ? shorten(binary, root) : `not found (${candidate.commands.join(', ')})`,
        color: binary ? colors.ok : colors.warn,
        //? A binary is not something to edit — its folder is what there is to see
        open: binary ? () => revealPath(binary) : undefined,
      },
      {
        label: 'folder',
        value: `${candidate.folder} — ${folderState}`,
        color: colors.muted,
        open: existsSync(folder) ? () => revealPath(folder) : undefined,
      },
      {
        label: 'mcp',
        value: mcpPath
          ? `${shorten(mcpPath, root)} (${mcpFile?.scope === 'user' ? 'every repo' : 'this repo'})`
          : 'not supported',
        color: mcpPath ? colors.text : colors.warn,
        open: mcpPath ? () => handoff({ type: 'edit', path: mcpPath }) : undefined,
      },
    ];
  };

  const items: PickItem<Setting>[] = [
    { id: 'header-ide', label: 'IDE', isHeader: true },
    ...IDES.map((candidate) => {
      const isPrimary = candidate.id === primary?.id;
      return {
        id: `ide:${candidate.id}`,
        label: candidate.name,
        hint: [
          isPrimary ? 'primary' : undefined,
          findIdeBinary(candidate) ? undefined : 'not installed',
        ]
          .filter(Boolean)
          .join(' · '),
        hintColor: isPrimary ? colors.accent : undefined,
        isCurrent: isPrimary,
        controls: [
          {
            id: 'include',
            glyph: included(candidate) ? '[x]' : '[ ]',
            color: included(candidate) ? colors.ok : colors.muted,
            onPress: () => toggle(candidate),
          },
        ],
        value: { kind: 'ide' as const, ide: candidate },
      };
    }),
    ...themes.items,
    { id: 'header-logo', label: 'Logo drawing', isHeader: true },
    ...LOGO_MODES.map((mode) => ({
      id: `logo:${mode}`,
      label: mode,
      hint: mode === logoMode ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: mode === logoMode,
      value: { kind: 'logo' as const, mode },
    })),
    { id: 'header-files', label: 'Files', isHeader: true },
    {
      id: 'file:config',
      label: 'Config',
      hint: 'theme, logo drawing',
      value: { kind: 'file', which: 'config' },
    },
    {
      id: 'file:state',
      label: 'State',
      hint: 'IDEs per repository, last tab',
      value: { kind: 'file', which: 'state' },
    },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & state…',
      hint: 'X',
      hintColor: colors.error,
      value: { kind: 'clear' },
    },
  ];

  const current = items.find((item) => item.id === currentId)?.value;
  const currentIde = current?.kind === 'ide' ? current.ide : undefined;

  //? Only the lines that open something are stops for the keyboard
  const links = currentIde ? linesFor(currentIde).filter((line) => line.open) : [];
  const focusedLink = focus === 'detail' ? links[Math.min(linkIndex, links.length - 1)] : undefined;

  /** Enter, a click on an already-selected row, and Space outside the IDE section. */
  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (themes.owns(setting)) return themes.activate(setting);
    if (setting.kind === 'ide') choose(setting.ide);
    else if (setting.kind === 'logo') onLogoModeChange(setting.mode);
    else if (setting.kind === 'file') openFile(setting.which);
    else setClearing(true);
  };

  useInput(
    (input, key) => {
      if (input === 'g') return cycleLogoMode();
      if (input === 'X') return setClearing(true);
      if (input === 'l' && currentIde) return launch(currentIde);

      if (focus === 'detail') {
        if (key.leftArrow || key.escape) setFocus('list');
        else if (key.upArrow) setLinkIndex((at) => Math.max(0, at - 1));
        else if (key.downArrow) setLinkIndex((at) => Math.min(links.length - 1, at + 1));
        else if (key.return || input === ' ') focusedLink?.open?.();
        return;
      }

      if (key.rightArrow && links.length > 0) {
        setFocus('detail');
        setLinkIndex((at) => Math.min(at, links.length - 1));
      } else if (input === ' ') {
        //? Space ticks, as in any checklist; Enter (ListDetail's) makes primary
        if (currentIde) toggle(currentIde);
        else apply(current);
      }
    },
    { isActive: isActive && !clearing },
  );

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear agenti's settings and state"
        targets={clearTargets}
        onDone={onCleared}
        onCancel={() => setClearing(false)}
        onCaptureInput={onCaptureInput}
      />
    );
  }

  //? The detail pane's inner size, by the same arithmetic ListDetail lays it
  //? out with: the list takes 42% side by side (from 96 columns), and the
  //? pane's border and padding take four columns. Its rows are the list's —
  //? ListDetail prices the list with two "N more" rows and a spare one the
  //? detail pane does not draw, so the pane holds two more than the list.
  const appWidth = Math.max(
    viewport.columns - theme.sizes.app.horizontalMargin,
    theme.sizes.app.minWidth,
  );
  const detailWidth = viewport.columns >= 96 ? appWidth - Math.floor(appWidth * 0.42) : appWidth;
  const logoCols = detailWidth - 4;
  const paneRows =
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 0) + 2;
  const technique = resolveLogoTechnique(logoMode, graphicsSupport());

  const ideDetail = (candidate: IdeDefinition): ReactNode => {
    const chosen = candidate.id === primary?.id;
    const isIncluded = included(candidate);
    const installed = Boolean(findIdeBinary(candidate));
    return (
      <Box flexDirection="column">
        <Toolbar
          actions={[
            {
              hotkey: 'Space',
              label: isIncluded ? 'Stop keeping in step' : 'Keep in step',
              onPress: () => toggle(candidate),
              tone: isIncluded ? 'normal' : 'primary',
              disabled: isIncluded && ides.length === 1,
            },
            {
              hotkey: 'Enter',
              label: chosen ? 'Is the primary IDE' : 'Make primary',
              onPress: () => choose(candidate),
              disabled: chosen,
            },
            {
              hotkey: 'l',
              label: 'Launch here',
              onPress: () => launch(candidate),
              tone: installed && isIncluded ? 'primary' : 'normal',
              disabled: !installed,
            },
            { hotkey: 'g', label: `Logo: ${logoMode}`, onPress: cycleLogoMode },
          ]}
        />
        <Text bold color={chosen ? colors.accent : colors.text}>
          {candidate.name}
          {chosen ? ' — primary' : ''}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {linesFor(candidate).map((line) => (
            <LinkRow
              key={line.label}
              label={line.label}
              value={line.value}
              color={line.color}
              isFocused={focusedLink?.label === line.label}
              onOpen={
                line.open &&
                (() => {
                  setFocus('detail');
                  setLinkIndex(links.findIndex((link) => link.label === line.label));
                  line.open?.();
                })
              }
            />
          ))}
        </Box>
        <Box marginTop={1}>
          <IdeLogo
            ide={candidate}
            mode={logoMode}
            maxCols={logoCols}
            //? What the text above leaves: toolbar and rule (2), name (1),
            //? three lines and the margins around them (5)
            maxRows={Math.min(16, paneRows - 8)}
          />
        </Box>
      </Box>
    );
  };

  const detailFor = (setting: Setting): ReactNode => {
    if (themes.owns(setting)) {
      return (
        <Box flexDirection="column">
          <ClearButton onPress={() => setClearing(true)} />
          {themes.renderDetail(setting)}
        </Box>
      );
    }
    switch (setting.kind) {
      case 'ide':
        return ideDetail(setting.ide);
      case 'logo':
        return (
          <Box flexDirection="column">
            <ClearButton onPress={() => setClearing(true)} />
            <Text bold color={colors.accent}>
              {setting.mode}
            </Text>
            <Text color={colors.muted} wrap="wrap">
              {LOGO_BLURB[setting.mode]}
              {setting.mode === 'auto' ? ` Here that is ${technique.id}.` : ''}
            </Text>
          </Box>
        );
      case 'file': {
        const path = setting.which === 'config' ? settingsPath : statePath;
        return (
          <Box flexDirection="column">
            <ClearButton onPress={() => setClearing(true)} />
            <LinkRow
              label="file"
              value={shorten(path, root)}
              onOpen={() => openFile(setting.which)}
            />
            <Box marginTop={1}>
              <Text color={colors.muted} wrap="wrap">
                {setting.which === 'config'
                  ? 'What you chose — the theme and the logo drawing. Plain JSON, safe to keep in dotfiles.'
                  : 'What agenti remembers by itself — the IDEs each repository is kept in step with, the last one picked anywhere, and the last tab. Keyed by path, so it is per machine.'}
              </Text>
            </Box>
          </Box>
        );
      }
      case 'clear':
        return (
          <Box flexDirection="column">
            <ClearButton onPress={() => setClearing(true)} />
            <Text color={colors.muted} wrap="wrap">
              Remove agenti's config (theme, logo drawing) and state (IDEs per repository, last tab)
              from disk, after a confirmation that lists both. Nothing in any repository is touched.
              agenti quits afterwards and starts from its defaults next time.
            </Text>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={colors.muted} wrap="truncate">
          {hasOwnChoice
            ? `Kept in step here: ${ides.map((one) => one.name).join(', ')}`
            : `No IDE chosen here yet — using ${primary?.name ?? 'none'}, the last pick`}
          {currentIde
            ? focus === 'detail'
              ? ' · ←/Esc back to the list'
              : ' · → into the details'
            : ''}
        </Text>
      </Box>
      <ListDetail
        title="Settings"
        items={items}
        detailTitle={currentIde ? (focus === 'detail' ? 'IDE — ↑/↓ Enter' : 'IDE') : 'Setting'}
        reservedChrome={['viewHeader']}
        initialSelectedId={currentId}
        //? A click applies — a theme, a logo mode, a file, Reset — as in every other app's
        //? Settings. Except on an IDE: there a click only selects, and the checkbox and the
        //? toolbar are the actions, so a stray click never changes the primary IDE
        activateOnClick={(item) => item.value?.kind !== 'ide'}
        activateLabel={currentIde ? 'make primary' : 'apply'}
        isInputActive={isActive && focus === 'list'}
        hints={[
          ...(currentIde ? [{ key: 'Space', label: 'include' }] : []),
          {
            key: 'g',
            label: `logo: ${logoMode}${logoMode === 'auto' ? ` (${technique.id})` : ''}`,
            onPress: cycleLogoMode,
          },
          { key: 'X', label: 'clear all', onPress: () => setClearing(true) },
        ]}
        onActivate={(item) => apply(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.settings = item?.id;
          //? Leaving the IDE section takes the keyboard back to the list
          if (item?.value?.kind !== 'ide' && focus === 'detail') setFocus('list');
        }}
        renderDetail={(item) => (item?.value ? detailFor(item.value) : null)}
      />
    </Box>
  );
};

export default SettingsView;
