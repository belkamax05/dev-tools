import { basename } from 'node:path';
import { Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

import {
  type AgentiSettings,
  hasOwnIde,
  ideIdsFor,
  type TabId,
  toggleRepoIde,
  withRepoIde,
} from '../../config/settings';
import { getIde, type IdeDefinition } from '../../core/ides';
import type { Scope } from '../../core/scope';
import agentiTheme from '../theme';
import type { Handoff, Session, Tone } from '../types';
import AgentsView from '../views/AgentsView';
import HealthView from '../views/HealthView';
import IdeView from '../views/IdeView';
import McpView from '../views/McpView';
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
  { id: 'ide', icon: '💻', label: '💻 IDE' },
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
    (input) => {
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T') cycleTheme();
      else if (input === ']') showIde(1);
      else if (input === '[') showIde(-1);
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
      theme={agentiTheme}
      palette={settings.theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ??
        `[1-${TABS.length}] / Tab switch tab${ides.length > 1 ? ' · [ ] IDE' : ''} · [r] refresh · [t] theme · [q] quit`
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
      {tab === 'ide' && (
        <IdeView
          {...viewProps}
          settingsPath={settingsPath}
          hasOwnChoice={hasOwnIde(settings, root)}
          onSelectIde={(id) => {
            updateSettings(withRepoIde(settings, root, id));
            setActiveId(id);
            session.activeIde = id;
          }}
          onToggleIde={(id) => updateSettings(toggleRepoIde(settings, root, id))}
          logoMode={settings.logoMode}
          onLogoModeChange={(logoMode) => updateSettings({ ...settings, logoMode })}
        />
      )}
    </AppShell>
  );
};

export default App;
