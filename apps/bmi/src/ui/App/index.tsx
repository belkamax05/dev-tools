import { join } from 'node:path';
import { useApp } from 'ink';
import { useMemo, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { setPreferredTechnique } from '@/dev-tools/terminal-canvas';
import { inspectFile } from '@/dev-tools/utils/config/createConfigStore';

import {
  type BmiConfig,
  buildLibrary,
  configStore,
  preferredTechniqueOf,
  TAB_IDS,
  type TabId,
  userList,
  type WorkspaceListResult,
} from '../../config/settings';
import { categoriesOf, workspaceOnly } from '../../core/bookmarks';
import type { PreviewCache } from '../../core/preview';
import bmiTheme from '../theme';
import type { Handoff, Session } from '../types';
import BookmarksView from '../views/BookmarksView';
import TagsView from '../views/TagsView';
import SettingsView from '../views/SettingsView';

/**
 * The tabs. Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`:
 * a glyph Ink and the terminal measure differently shifts every border after it by a column.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'bookmarks', icon: '🔖', label: '🔖 Bookmarks' },
  { id: 'tags', icon: '📂', label: '📂 Tags' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  config: BmiConfig;
  workspaceList: WorkspaceListResult;
  cache: PreviewCache;
  session: Session;
  notice?: string;
  onConfigChange: (config: BmiConfig) => void;
  onHandoff: (intent: Handoff) => void;
  /** Re-read both lists from disk — after editing one by hand outside bmi. */
  onReload: () => Promise<{ config: BmiConfig; workspaceList: WorkspaceListResult }>;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}



/**
 * bmi's dashboard: every bookmark in the project's list and the user's own, merged, searchable and
 * filed by category; the categories and tags; and the settings, which are a key away from either list in `$EDITOR`.
 */
export const App = ({
  config: initialConfig,
  workspaceList: initialWorkspace,
  cache,
  session,
  notice,
  onConfigChange,
  onHandoff,
  onReload,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [workspaceList, setWorkspaceList] = useState(initialWorkspace);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'bookmarks',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify } = useStatus(
    notice ?? (initialWorkspace.error ? { text: `Workspace list ignored: ${initialWorkspace.error}`, tone: 'error' } : undefined),
  );

  //? Set during render, before the cards below it ask which technique to draw with: an effect
  //? would run after them, and the first frame after a change would still use the old one
  setPreferredTechnique(preferredTechniqueOf(config));

  const library = useMemo(() => {
    const merged = buildLibrary(workspaceList.list, userList(config));
    return config.showUserBookmarks ? merged : workspaceOnly(merged);
  }, [workspaceList.list, config]);


  const updateConfig = (next: BmiConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
  };

  const stepTab = (step: 1 | -1) => {
    const at = TABS.findIndex((each) => each.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length];
    if (next) changeTab(next.id);
  };

  const reload = () => {
    void onReload().then((next) => {
      setConfig(next.config);
      setWorkspaceList(next.workspaceList);
      if (next.workspaceList.error) {
        notify(`Workspace list ignored: ${next.workspaceList.error}`, 'error');
      }
      else notify('Re-read both lists', 'ok');
    });
  };

  const editFile = (path: string) => {
    onHandoff({ type: 'edit', path });
    exit();
  };

  const footerActions: FooterAction[] = [
    {
      id: 'reload',
      label: 'Reload',
      hotkey: 'r',
      onPress: reload,
      tooltip: 'Re-read the workspace list and your own from disk',
    },
  ];

  const viewProps = {
    library,
    config,
    session,
    notify,
    onConfigChange: updateConfig,
    onCaptureInput: setIsInputCaptured,
  };

  return (
    <AppShell
      title="bmi"
      detail={`${library.entries.length} bookmarks · ${categoriesOf(library).length} categories${config.showUserBookmarks ? '' : ' · workspace only'}`}
      status={status}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={bmiTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[r] reload"
      footerActions={footerActions}
    >
      {tab === 'bookmarks' && (
        <BookmarksView key="bookmarks" cache={cache} onTabStep={stepTab} {...viewProps} />
      )}
      {tab === 'tags' && (
        <TagsView
          key="tags"
          {...viewProps}
          onShowTag={(key) => {
            session.tag = key;
            session.query = '';
            session.selected.bookmarks = undefined;
            changeTab('bookmarks');
          }}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          config={config}
          configPath={configStore.path}
          workspacePath={workspaceList.path}
          workspaceExists={workspaceList.exists}
          workspaceError={workspaceList.error}
          cacheDirectory={cache.directory}
          session={session}
          onConfigChange={updateConfig}
          onEditFile={editFile}
          onCaptureInput={setIsInputCaptured}
          clearTargets={[
            {
              id: 'config',
              label: 'Settings & your list',
              store: configStore,
              //? Unticked: unlike the theme, the bookmarks in it are not something to lose by
              //? accepting a dialog's defaults
              checked: false,
              detail: 'theme, and every bookmark and group you added',
            },
            {
              id: 'cache',
              label: 'Preview cache',
              store: {
                inspect: () => inspectFile(join(cache.directory, 'previews.json')),
                clear: async () => {
                  const info = await inspectFile(join(cache.directory, 'previews.json'));
                  await cache.clear();
                  return info.exists ? 'removed' : 'missing';
                },
              },
              detail: 'page previews and favicons — fetched again as needed',
            },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch or edit would write the files
            //? straight back from what is still in memory
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;
