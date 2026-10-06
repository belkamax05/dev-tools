import { useApp, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import useResizeFlash from '../../hooks/useResizeFlash';
import useTerminalSize from '../../hooks/useTerminalSize';
import TuiThemeProvider, { useResolvedTheme } from '../../providers/TuiThemeProvider';
import setTerminalBackground from '../../terminal/background';
import { TRANSPARENT, type TuiTheme } from '../../theme';
import AppHeader from '../AppHeader';
import Box from '../Box';
import Footer, { type FooterAction } from '../Footer';
import ResizeOverlay from '../ResizeOverlay';
import StatusNote, { type StatusMessage } from '../StatusNote';
import TabStrip, { type TabDefinition } from '../TabStrip';
import TerminalTooSmall from '../TerminalTooSmall';

export interface AppShellProps<Id extends string = string> {
  /** What the app is, in the header bar. */
  title: string;
  /** What it is pointed at, on the right of the header bar. */
  detail?: string;
  /** A second header line for context the title cannot carry. */
  note?: ReactNode;
  /** The latest status message (see `useStatus`). Shown in place of `note` while there is one. */
  status?: StatusMessage;

  tabs: readonly TabDefinition<Id>[];
  activeTab: Id;
  onTabChange: (id: Id) => void;
  /** Draw every tab with its name rather than shrinking the closed ones. */
  fullWidthTabs?: boolean;
  /**
   * A strip under the tabs, on every tab — controls that apply whichever one
   * is open. Its rows are the app's to add to the `appShell` chrome price.
   */
  underTabs?: ReactNode;

  /** Sizes, breakpoints and display rules. Defaults to the stock tables. */
  theme?: TuiTheme;
  /** Palette id from the app's config. Anything unrecognised falls back. */
  palette?: string;
  /** Paint the app's background rather than letting the terminal's show through. */
  opaqueBackground?: boolean;
  /**
   * Apply and persist a palette change. Given this, the shell is the theme switcher: `t` steps
   * to the next palette, a Theme button joins the footer (before Quit), and a Settings tab's
   * `useThemeSettings` rows work — none of which an app writes itself.
   */
  onPaletteChange?: (id: string) => void;

  /**
   * The app's own keys, as `[r] refresh · [P] pause`. The shell's are added around them —
   * switching tabs, the theme, quitting — so no app repeats them, or forgets one.
   */
  footerHints?: string;
  /**
   * Replaces the whole hint line while set — an explanation of what the pointer is over
   * elsewhere in the app. The footer's own buttons are explained without it.
   */
  footerTooltip?: string | null;
  /** The app's own buttons. Theme and Quit are the shell's and are added after them. */
  footerActions?: FooterAction[];
  onHoverFooterAction?: (action: FooterAction | null) => void;

  /**
   * True while a view is taking dictation and needs every key it is given,
   * including the ones that switch tabs here.
   */
  isInputCaptured?: boolean;

  children: ReactNode;
}

/**
 * Header, tabs, a view, and a footer — the frame every tabbed TUI in this
 * repository draws itself in.
 *
 * It is both the theme provider and a component that draws, which is why it
 * resolves the colours itself as well as handing them down: a component cannot
 * read a context it is providing, and the page background is its own to paint.
 * Same function, same arguments, so the shell and everything under it can never
 * end up on different themes.
 *
 * Tab switching lives here rather than in each app: `Tab`/`Shift+Tab` step
 * through the strip and the digits jump straight to one, bounded by the tab list
 * so adding a tab does not leave its digit silently doing nothing. So do the
 * other things every app had a copy of: `q` and the Quit button, `t` and the
 * Theme button, the status line, and the hint strip naming those keys.
 */
export const AppShell = <Id extends string = string>({
  title,
  detail,
  note,
  status,
  tabs,
  activeTab,
  onTabChange,
  fullWidthTabs = false,
  underTabs,
  theme,
  palette,
  opaqueBackground = false,
  onPaletteChange,
  footerHints,
  footerTooltip,
  footerActions,
  onHoverFooterAction,
  isInputCaptured = false,
  children,
}: AppShellProps<Id>) => {
  const themeProps = { theme, palette, opaqueBackground, onPaletteChange };
  const {
    theme: resolvedTheme,
    colors,
    control: themeControl,
  } = useResolvedTheme(themeProps);

  const { exit } = useApp();

  //? The shell's own buttons go last, in the order every app had them: theme, then quit
  const actions = useMemo((): FooterAction[] => {
    const name = title.split(' — ')[0];
    return [
      ...(footerActions ?? []),
      ...(onPaletteChange
        ? [
            {
              id: 'theme',
              label: 'Theme',
              hotkey: 't',
              onPress: () => themeControl.cycle(),
              tooltip: 'Step to the next colour theme',
            },
          ]
        : []),
      { id: 'quit', label: 'Quit', hotkey: 'q', onPress: exit, tooltip: `Close ${name}` },
    ];
  }, [footerActions, onPaletteChange, themeControl, exit, title]);

  //? Held here rather than in every app: a footer button explains itself in the hint line
  const [hovered, setHovered] = useState<FooterAction | null>(null);
  //? Only while the button is still there: one that removes itself when pressed (giti's Undo)
  //? never reports the pointer leaving, and its hint would outlive it
  const hoveredTip = actions.some((action) => action.id === hovered?.id)
    ? hovered?.tooltip
    : undefined;
  const hints =
    hoveredTip ??
    footerTooltip ??
    [
      tabs.length > 1 ? `[1-${Math.min(tabs.length, 9)}] / Tab switch tab` : '',
      footerHints ?? '',
      onPaletteChange ? '[t] theme' : '',
      '[q] quit',
    ]
      .filter(Boolean)
      .join(' · ');

  //? Measured rather than taken from `useViewport`, which needs the provider
  //? this component is about to render — the too-small branch below has to
  //? decide before there is a context to read.
  const { columns, rows } = useTerminalSize();
  const resizing = useResizeFlash(resolvedTheme.timings.resizeFlash);
  const { app } = resolvedTheme.sizes;

  /**
   * Tell the terminal what its background is, for the parts Ink cannot paint:
   * the row the shell holds back, and the pixels of padding every terminal
   * leaves around the character grid. Both fall back to the terminal's default,
   * so an app painted to its own edges still sits in a frame of another colour
   * until the default itself is changed.
   */
  //? From the resolved page rather than the prop: an opaque theme (Paper) paints even when the
  //? app asked for transparency
  const painted = colors.page !== TRANSPARENT;
  useEffect(() => {
    setTerminalBackground(painted ? colors.surface : null);
  }, [painted, colors.surface]);

  //? Separately, and only on the way out: the effect above runs again whenever
  //? the theme changes, and a reset in its cleanup would hand the terminal back
  //? and take it again on every keypress in a theme switcher.
  useEffect(() => () => setTerminalBackground(null), []);

  useInput(
    (input, key) => {
      if (key.tab) {
        const at = tabs.findIndex((tab) => tab.id === activeTab);
        const step = key.shift ? -1 : 1;
        const next = tabs[(at + step + tabs.length) % tabs.length];
        if (next) onTabChange(next.id);
        return;
      }
      if (input >= '1' && input <= '9') {
        const tab = tabs[Number(input) - 1];
        if (tab) onTabChange(tab.id);
        return;
      }
      if (key.ctrl || key.meta) return;
      //? Every footer button answers to its key, so no app binds the same key a second time.
      //? A lower-case key takes its capital too, unless another button owns that — except
      //? Theme: bmi's bookmarks and giti's conflicts already give `T` a meaning
      const action =
        actions.find((candidate) => candidate.hotkey === input) ??
        actions.find(
          (candidate) =>
            candidate.id !== 'theme' &&
            candidate.hotkey !== undefined &&
            /^[a-z]$/.test(candidate.hotkey) &&
            candidate.hotkey.toUpperCase() === input,
        );
      if (action && !action.disabled) action.onPress();
    },
    { isActive: !isInputCaptured },
  );

  const appWidth = Math.max(columns - app.horizontalMargin, app.minWidth);
  const appHeight = Math.max(1, rows - app.heldBackRows);

  //? Below the floor there is no smaller layout left: every sheddable element is
  //? already gone and the bare grid still overflows, which Yoga resolves by
  //? compressing boxes onto their own borders rather than clipping them.
  //?
  //? Themed all the same — the size complaint is the one screen a user in a
  //? too-small terminal actually reads, and it has no business being the one
  //? screen in the app that ignores their theme.
  if (rows < app.minHeight || columns < app.minWidth) {
    return (
      <TuiThemeProvider {...themeProps}>
        <Box width={columns} height={appHeight} backgroundColor={colors.page}>
          <TerminalTooSmall columns={columns} rows={rows} />
        </Box>
      </TuiThemeProvider>
    );
  }

  return (
    <TuiThemeProvider {...themeProps}>
      {/*
       * The page, and the only place the background is painted.
       *
       * Full width rather than `appWidth`: the app keeps a margin so a border
       * never sits on the terminal's edge, and an unpainted strip down the side
       * of an opaque app reads as a bug rather than as padding. The app box
       * inside keeps its own width, so every measurement priced against it is
       * unchanged.
       *
       * Painting here rather than on the app box is also what fills the app:
       * Ink hands a box's background to every `Text` below it through a context,
       * so text and the spaces between it come out on the page colour without a
       * single component being told about it. Borders are the exception — see
       * `components/Box`.
       */}
      <Box width={columns} height={appHeight} backgroundColor={colors.page}>
        <Box
          flexDirection="column"
          width={appWidth}
          height={appHeight}
          justifyContent="space-between"
        >
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            <Box marginBottom={1} flexShrink={0}>
              <AppHeader
                title={title}
                detail={detail}
                note={status ? <StatusNote text={status.text} tone={status.tone} /> : note}
              />
            </Box>

            <Box marginBottom={1} flexShrink={0}>
              <TabStrip
                tabs={tabs}
                active={activeTab}
                fullWidth={fullWidthTabs}
                onSelect={onTabChange}
              />
            </Box>

            {underTabs && (
              <Box marginBottom={1} flexShrink={0}>
                {underTabs}
              </Box>
            )}

            {/* The view, growing into whatever the chrome did not take. */}
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
              {children}
            </Box>
          </Box>

          {resizing && <ResizeOverlay width={appWidth} height={appHeight} />}

          <Footer
            hints={hints}
            actions={actions}
            onHoverAction={(action) => {
              setHovered(action);
              onHoverFooterAction?.(action);
            }}
          />
        </Box>
      </Box>
    </TuiThemeProvider>
  );
};

export default AppShell;
