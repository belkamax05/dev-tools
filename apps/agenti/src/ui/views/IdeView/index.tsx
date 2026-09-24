import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { useState } from 'react';
import { Text, useInput } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { findIdeBinary, IDES, type IdeDefinition } from '../../../core/ides';
import { LOGO_MODES, type LogoMode, resolveLogoTechnique } from '../../logo';
import IdeLogo from '../../logo/IdeLogo';
import type { ViewProps } from '../../types';
import { graphicsSupport } from '@/dev-tools/terminal-canvas';

export interface IdeViewProps extends ViewProps {
  onSelectIde: (id: string) => void;
  /** The settings file the choice is saved to — shown so it is never a mystery. */
  settingsPath: string;
  /** False while this repo is still on an inherited default rather than its own pick. */
  hasOwnChoice: boolean;
}

/** Repo-relative for anything in the repo, `~/…` for anything else under home. */
const shorten = (path: string, root: string) => {
  if (path.startsWith(`${root}/`)) return relative(root, path);
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
};

/**
 * Which IDE this repository's `.agents` is linked into — the web version's IDE
 * selector, as a tab of its own because every other tab reads its answer.
 *
 * An IDE that is not installed can still be picked, unlike on the web: the
 * links live in the repository, and setting them up for an IDE a teammate uses
 * is a reasonable thing to do from a machine that does not have it.
 */
export const IdeView = ({
  root,
  ide,
  session,
  notify,
  onSelectIde,
  settingsPath,
  hasOwnChoice,
}: IdeViewProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [logoMode, setLogoMode] = useState<LogoMode>('auto');
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.ide ?? ide.id);

  const choose = (candidate: IdeDefinition | undefined) => {
    if (!candidate) return;
    onSelectIde(candidate.id);
    notify(`${candidate.name} is now this repository's IDE`, 'ok');
  };

  //? Space as well as Enter: this is a radio list, and Space is the key that
  //? picks an option in one everywhere else
  const cycleLogoMode = () =>
    setLogoMode((mode) => LOGO_MODES[(LOGO_MODES.indexOf(mode) + 1) % LOGO_MODES.length] ?? 'auto');

  useInput((input) => {
    if (input === ' ') choose(IDES.find((candidate) => candidate.id === currentId));
    else if (input === 'g') cycleLogoMode();
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
    const hasFolder = existsSync(join(root, candidate.folder));
    return {
      id: candidate.id,
      label: `${candidate.id === ide.id ? '●' : '○'} ${candidate.name}`,
      hint: [binary ? 'installed' : 'not installed', hasFolder && candidate.folder]
        .filter(Boolean)
        .join(' · '),
      value: candidate,
      isCurrent: candidate.id === ide.id,
    };
  });

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={colors.muted} wrap="truncate">
          {hasOwnChoice
            ? 'Chosen for this repo'
            : 'Not chosen for this repo yet — using the last pick'}{' '}
          · saved in {shorten(settingsPath, root)}
        </Text>
      </Box>
      <ListDetail
        title="IDE"
        items={items}
        detailTitle="IDE"
        reservedChrome={['viewHeader']}
        initialSelectedId={session.selected.ide ?? ide.id}
        activateLabel="use for this repo"
        hints={[
          {
            key: 'Space',
            label: 'use for this repo',
            onPress: () => choose(IDES.find((c) => c.id === currentId)),
          },
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
          const binary = findIdeBinary(candidate);
          const folder = join(root, candidate.folder);
          const folderState = !existsSync(folder)
            ? 'not created yet'
            : lstatSync(folder).isSymbolicLink()
              ? 'one link to .agents'
              : 'a folder';
          const facts: [string, string, string][] = [
            [
              'binary',
              binary ? shorten(binary, root) : `not found (${candidate.commands.join(', ')})`,
              binary ? colors.ok : colors.warn,
            ],
            ['folder', `${candidate.folder} — ${folderState}`, colors.muted],
            [
              'mcp',
              candidate.mcp
                ? `${shorten(candidate.mcp.path(root), root)} (${candidate.mcp.scope === 'user' ? 'every repo' : 'this repo'})`
                : 'not supported',
              candidate.mcp ? colors.muted : colors.warn,
            ],
          ];
          return (
            <Box flexDirection="column">
              <Text bold color={candidate.id === ide.id ? colors.accent : colors.text}>
                {candidate.name}
                {candidate.id === ide.id ? ' — selected' : ''}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {facts.map(([label, value, color]) => (
                  <Text key={label} wrap="truncate">
                    <Text color={colors.muted}>{label.padEnd(8)}</Text>
                    <Text color={color}>{value}</Text>
                  </Text>
                ))}
              </Box>
              {candidate.id !== ide.id && (
                <Box marginTop={1}>
                  <Text color={colors.accent}>
                    [Space/Enter] makes it this repository's IDE — the Agents and MCP tabs then work
                    on {candidate.folder}
                  </Text>
                </Box>
              )}
              <Box marginTop={1}>
                <IdeLogo
                  ide={candidate}
                  mode={logoMode}
                  maxCols={logoCols}
                  //? What the text above leaves: title, facts and their margins
                  //? (7 rows), plus the two-line call to action on an unselected IDE
                  maxRows={Math.min(16, paneRows - (candidate.id === ide.id ? 7 : 10))}
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
