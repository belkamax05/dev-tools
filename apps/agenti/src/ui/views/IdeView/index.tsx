import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import { graphicsSupport } from '@/dev-tools/terminal-canvas';
import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { findIdeBinary, IDES, type IdeDefinition } from '../../../core/ides';
import { launchDetached, launchPlan } from '../../../core/launch';
import revealPath from '@/dev-tools/utils/system/revealPath';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import { LOGO_MODES, type LogoMode, resolveLogoTechnique } from '../../logo';
import IdeLogo from '../../logo/IdeLogo';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import type { ViewProps } from '../../types';

export interface IdeViewProps extends ViewProps {
  /** Make an IDE the primary one — adding it if it was not in the set. */
  onSelectIde: (id: string) => void;
  /** Add an IDE to the set kept in step, or take it out (never the last one). */
  onToggleIde: (id: string) => void;
  /** The settings file the choice is saved to — shown, and openable, so it is never a mystery. */
  settingsPath: string;
  /** False while this repo is still on an inherited default rather than its own pick. */
  hasOwnChoice: boolean;
  /** How logos are drawn — kept in the settings, so `g` is remembered. */
  logoMode: LogoMode;
  onLogoModeChange: (mode: LogoMode) => void;
}

/** Repo-relative for anything in the repo, `~/…` for anything else under home. */
const shorten = (path: string, root: string) => {
  if (path.startsWith(`${root}/`)) return relative(root, path);
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
};

/** One line of the detail pane; `open` makes it a link. */
interface DetailLine {
  label: string;
  value: string;
  color: string;
  open?: () => void;
}

/**
 * Which IDE this repository's `.agents` is linked into — the web version's IDE
 * selector, as a tab of its own because every other tab reads its answer.
 *
 * Two panes the keyboard moves between: the list of IDEs, and — `→` — the
 * detail pane's links (the IDE's binary, its MCP file, agenti's own config),
 * walked with `↑`/`↓` and opened with Enter; `←` goes back. A click on an IDE
 * only selects it; making it the repo's IDE is the toolbar's button, which is
 * disabled for the IDE that already is.
 *
 * An IDE that is not installed can still be picked, unlike on the web: the
 * links live in the repository, and setting them up for an IDE a teammate uses
 * is a reasonable thing to do from a machine that does not have it.
 */
export const IdeView = ({
  root,
  ides,
  session,
  notify,
  handoff,
  onSelectIde,
  onToggleIde,
  settingsPath,
  hasOwnChoice,
  logoMode,
  onLogoModeChange,
}: IdeViewProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [currentId, setCurrentId] = useState<string | undefined>(
    session.selected.ide ?? ides[0]?.id,
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

  const current = IDES.find((candidate) => candidate.id === currentId);

  const primary = ides[0];
  const included = (candidate: IdeDefinition) => ides.some((one) => one.id === candidate.id);

  const choose = (candidate: IdeDefinition | undefined) => {
    if (!candidate || candidate.id === primary?.id) return;
    onSelectIde(candidate.id);
    notify(`${candidate.name} is now the primary IDE`, 'ok');
  };

  const toggle = (candidate: IdeDefinition | undefined) => {
    if (!candidate) return;
    if (included(candidate) && ides.length === 1) {
      notify('Keep at least one IDE — add another before removing this one', 'warn');
      return;
    }
    onToggleIde(candidate.id);
    notify(
      included(candidate)
        ? `${candidate.name} is no longer kept in step`
        : `${candidate.name} is now kept in step too`,
      'ok',
    );
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
      {
        label: 'config',
        value: shorten(settingsPath, root),
        color: colors.text,
        open: () => handoff({ type: 'edit', path: settingsPath }),
      },
    ];
  };

  //? Only the lines that open something are stops for the keyboard
  const links = current ? linesFor(current).filter((line) => line.open) : [];
  const focusedLink = focus === 'detail' ? links[Math.min(linkIndex, links.length - 1)] : undefined;

  useInput((input, key) => {
    if (input === 'g') return cycleLogoMode();
    if (input === 'l') return launch(current);

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
      toggle(current);
    }
  });

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

  const items: PickItem<IdeDefinition>[] = IDES.map((candidate) => {
    const binary = findIdeBinary(candidate);
    const isPrimary = candidate.id === primary?.id;
    return {
      id: candidate.id,
      label: candidate.name,
      hint: [isPrimary ? 'primary' : undefined, binary ? undefined : 'not installed']
        .filter(Boolean)
        .join(' · '),
      hintColor: isPrimary ? colors.accent : undefined,
      value: candidate,
      isCurrent: isPrimary,
      controls: [
        {
          id: 'include',
          glyph: included(candidate) ? '[x]' : '[ ]',
          color: included(candidate) ? colors.ok : colors.muted,
          onPress: () => toggle(candidate),
        },
      ],
    };
  });

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={colors.muted} wrap="truncate">
          {hasOwnChoice
            ? `Kept in step: ${ides.map((one) => one.name).join(', ')}`
            : `No IDE chosen here yet — using ${primary?.name ?? 'none'}, the last pick`}
          {focus === 'detail' ? ' · ←/Esc back to the list' : ' · → into the details'}
        </Text>
      </Box>
      <ListDetail
        title="IDE"
        items={items}
        detailTitle={focus === 'detail' ? 'IDE — ↑/↓ Enter' : 'IDE'}
        reservedChrome={['viewHeader']}
        initialSelectedId={session.selected.ide ?? ides[0]?.id}
        //? A click selects; choosing is the toolbar's button, so the two can
        //? differ — which is what lets that button be disabled for the chosen one
        activateOnClick={false}
        activateLabel="make primary"
        isInputActive={focus === 'list'}
        hints={[
          { key: 'Space', label: 'include' },
          {
            key: 'g',
            label: `logo: ${logoMode}${logoMode === 'auto' ? ` (${technique.id})` : ''}`,
            onPress: cycleLogoMode,
          },
        ]}
        onActivate={(item) => choose(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.ide = item?.id;
        }}
        renderDetail={(item) => {
          const candidate = item?.value;
          if (!candidate) return null;
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
                    label: `Launch here`,
                    onPress: () => launch(candidate),
                    tone: installed && isIncluded ? 'primary' : 'normal',
                    disabled: !installed,
                  },
                  { hotkey: 'g', label: `Logo: ${logoMode}`, onPress: cycleLogoMode },
                ]}
              />
              <Text bold color={chosen ? colors.accent : colors.text}>
                {candidate.name}
                {chosen ? ' — selected' : ''}
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
                  //? four lines and the margins around them (6)
                  maxRows={Math.min(16, paneRows - 9)}
                />
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default IdeView;
