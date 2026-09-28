import { basename } from 'node:path';
import { type Key, Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

import {
  type AgentiSettings,
  configStore,
  hasOwnIde,
  ideIdsFor,
  stateStore,
  type TabId,
  toggleRepoIde,
  withRepoIde,
} from '../../config/settings';
import { getIde, IDES, type IdeDefinition } from '../../core/ides';
import type { Scope } from '../../core/scope';
import IdeStrip, { IDE_STRIP_KEYS } from '../IdeStrip';
import agentiTheme from '../theme';
import type { Handoff, Session, Tone } from '../types';
import AgentsView from '../views/AgentsView';
import HealthView from '../views/HealthView';
import McpView from '../views/McpView';
import SettingsView from '../views/SettingsView';
import SkillsView from '../views/SkillsView';

/**
 * The tabs. Every icon's base codepoint is East Asian Width *Wide* and none
 * carries a U+FE0F variation selector — see `TabDefinition` for why that is a
 * requirement: a glyph Ink and the terminal measure differently shifts every
 * border after it by a column.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'agents', icon: '🤖', label: '🤖 Agents' },
  { id: 'mcp', icon: '🔌', label: '🔌 MCP' },
  { id: 'skills', icon: '🧩', label: '🧩 Skills' },
  { id: 'health', icon: '🩺', label: '🩺 Health' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export const isTabId = (value: string | undefined): value is TabId =>
  TABS.some((tab) => tab.id === value);

export interface AppProps {
  scope: Scope;
  settings: AgentiSettings;
  settingsPath: string;
  session: Session;
  /** Shown in the header on open — the result of whatever the last handoff did. */
  notice?: string;
  onSettingsChange: (settings: AgentiSettings) => void;
  /** Hand the terminal back to the CLI for something that needs it, then reopen. */
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}

const StatusNote = ({ text, tone }: { text: string; tone: Tone }) => {
  const colors = useColors();
  const color =
    tone === 'ok'
      ? colors.ok
      : tone === 'warn'
        ? colors.warn
        : tone === 'error'
          ? colors.error
          : colors.muted;
  return (
    <Text color={color} wrap="truncate">
      {text}
    </Text>
  );
};

/**
 * agenti's dashboard: one scope's `.agents`, instructions, MCP servers and
 * skills, against every IDE it is kept in step with.
 *
 * The shell is `dev-tools`'s `AppShell`, as in giti; what lives here is the set
 * of IDEs and which one the tabs are showing (`[` / `]`), the status line every
 * action reports into, and the handoff that lets a tab borrow the terminal.
 */
export const App = ({
  scope,
  settings: initialSettings,
  settingsPath,
  session,
  notice,
  onSettingsChange,
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<TabId>(isTabId(session.tab) ? session.tab : 'agents');
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(
    notice ? { text: notice, tone: 'info' } : undefined,
  );
  const [footerHint, setFooterHint] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Which IDE the keyboard is on while the strip under the tabs has it (`I`), else undefined. */
  const [stripFocus, setStripFocus] = useState<string | undefined>();

  const { root } = scope;
  const ides = ideIdsFor(settings, root)
    .map((id) => getIde(id))
    .filter((known): known is IdeDefinition => Boolean(known));
  const [activeId, setActiveId] = useState(session.activeIde);
  const ide = ides.find((candidate) => candidate.id === activeId) ?? ides[0];
  const showIde = (step: number) => {
    if (ides.length < 2 || !ide) return;
    const next = ides[(ides.indexOf(ide) + step + ides.length) % ides.length];
    setActiveId(next?.id);
    session.activeIde = next?.id;
  };

  /**
   * Keep this scope in step with an IDE, or stop — the one switch behind the
   * strip under the tabs, its Shift+digit keys, and Settings' checkboxes.
   * The last IDE stays: with none, no tab has anything to show.
   */
  const toggleIde = (id: string) => {
    const candidate = getIde(id);
    if (!candidate) return;
    const isOn = ides.some((one) => one.id === id);
    if (isOn && ides.length === 1) {
      notify('Keep at least one IDE — add another before removing this one', 'warn');
      return;
    }
    updateSettings(toggleRepoIde(settings, root, id));
    notify(
      isOn
        ? `${candidate.name} is no longer kept in step`
        : `${candidate.name} is now kept in step too`,
      'ok',
    );
  };

  /** Make an IDE the primary one — and the one the tabs show — keeping it in step if it was not. */
  const makePrimary = (id: string) => {
    const candidate = getIde(id);
    if (!candidate) return;
    if (ides[0]?.id === id) {
      notify(`${candidate.name} is already the primary IDE`, 'info');
      return;
    }
    updateSettings(withRepoIde(settings, root, id));
    setActiveId(id);
    session.activeIde = id;
    notify(`${candidate.name} is now the primary IDE`, 'ok');
  };

  /** The strip's own keys, while it has the keyboard; the views' stand down meanwhile. */
  const stripInput = (input: string, key: Key) => {
    const at = Math.max(
      0,
      IDES.findIndex((one) => one.id === stripFocus),
    );
    const step = (by: number) => setStripFocus(IDES[(at + by + IDES.length) % IDES.length]?.id);
    if (key.leftArrow) step(-1);
    else if (key.rightArrow) step(1);
    else if (input === ' ' && stripFocus) toggleIde(stripFocus);
    else if (key.return && stripFocus) makePrimary(stripFocus);
    else if (key.escape || key.downArrow || input === 'I') setStripFocus(undefined);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    updateSettings({ ...settings, lastTab: next });
  };

  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);

  const handoff = useCallback(
    (intent: Handoff) => {
      onHandoff(intent);
      //? Unmount first: the editor needs the real terminal, not the alternate
      //? screen the dashboard is drawing in
      exit();
    },
    [onHandoff, exit],
  );

  const updateSettings = (next: AgentiSettings) => {
    setSettings(next);
    onSettingsChange(next);
  };

  const cycleTheme = () =>
    updateSettings({
      ...settings,
      theme: nextThemeId(settings.theme, 1, agentiTheme.palettes),
    });
  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setStatus(undefined);
  };

  useInput(
    (input, key) => {
      if (stripFocus) {
        //? Everything but the app's own letters and the Shift+digit toggles
        //? belongs to the strip — arrows especially, which a view would take
        const isAppKey =
          'qQrRtT[]'.includes(input) || (IDE_STRIP_KEYS as readonly string[]).includes(input);
        if (!input || !isAppKey) return stripInput(input, key);
      } else if (input === 'I') {
        return setStripFocus(ide?.id ?? IDES[0]?.id);
      }
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T') cycleTheme();
      else if (input === ']') showIde(1);
      else if (input === '[') showIde(-1);
      else {
        const at = IDE_STRIP_KEYS.indexOf(input as (typeof IDE_STRIP_KEYS)[number]);
        const target = IDES[at];
        if (target) toggleIde(target.id);
      }
    },
    { isActive: !isInputCaptured },
  );

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: refresh,
      tooltip: 'Re-read everything from disk',
    },
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: cycleTheme,
      tooltip: 'Step to the next colour theme',
    },
    {
      id: 'quit',
      label: 'Quit',
      hotkey: 'q',
      onPress: exit,
      tooltip: 'Close agenti',
    },
  ];

  if (!ide) return null;

  const viewProps = {
    scope,
    root,
    ide,
    ides,
    session,
    notify,
    onCaptureInput: setIsInputCaptured,
    handoff,
    refreshKey,
    isActive: !stripFocus,
  };

  return (
    <AppShell
      title={scope.kind === 'user' ? 'agenti — user scope' : `agenti — ${basename(root)}`}
      detail={
        ides.length > 1
          ? `${ides.map((candidate) => (candidate.id === ide.id ? `[${candidate.name}]` : candidate.name)).join(' · ')}  [ ] switch`
          : ide.name
      }
      note={status ? <StatusNote text={status.text} tone={status.tone} /> : root}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      underTabs={
        <IdeStrip
          ides={ides}
          shownId={ide.id}
          logoMode={settings.logoMode}
          focusedId={stripFocus}
          onToggle={toggleIde}
          onMakePrimary={makePrimary}
          onHint={setFooterHint}
        />
      }
      theme={agentiTheme}
      palette={settings.theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ??
        (stripFocus
          ? '[←/→] IDE · [Space] keep in step · [Enter] make primary · [Esc] back to the tab'
          : `[I] IDEs · [1-${TABS.length}] / Tab switch tab${ides.length > 1 ? ' · [ ] IDE' : ''} · [!-${IDE_STRIP_KEYS[IDES.length - 1]}] IDE on/off · [r] refresh · [t] theme · [q] quit`)
      }
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
    >
      {/* Keyed on the IDE so a new pick starts each view clean, rather than
          showing one IDE's rows under another's name until the reload lands */}
      {tab === 'agents' && <AgentsView key={ide.id} {...viewProps} />}
      {tab === 'mcp' && <McpView key={ide.id} {...viewProps} />}
      {tab === 'skills' && <SkillsView {...viewProps} />}
      {tab === 'health' && <HealthView {...viewProps} />}
      {tab === 'settings' && (
        <SettingsView
          {...viewProps}
          settingsPath={settingsPath}
          statePath={stateStore.path}
          themeId={settings.theme}
          onThemeChange={(theme) => updateSettings({ ...settings, theme })}
          clearTargets={[
            { id: 'config', label: 'Settings', store: configStore, detail: 'theme, logo drawing' },
            {
              id: 'state',
              label: 'State',
              store: stateStore,
              detail: 'IDEs per repository, last tab',
            },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch or IDE pick would write the files
            //? straight back from what is still in memory
            exit();
          }}
          hasOwnChoice={hasOwnIde(settings, root)}
          onSelectIde={makePrimary}
          onToggleIde={toggleIde}
          logoMode={settings.logoMode}
          onLogoModeChange={(logoMode) => updateSettings({ ...settings, logoMode })}
        />
      )}
    </AppShell>
  );
};

export default App;
