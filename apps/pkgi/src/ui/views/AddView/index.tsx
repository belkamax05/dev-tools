import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useDebouncedCallback from '@/dev-tools/ui/hooks/useDebouncedCallback';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { addCommand, readManifest, shellQuote } from '../../../core/manifest';
import { type SearchResult, searchPackages } from '../../../core/registry';
import { isPrerelease } from '../../../core/semver';
import { addActions, RegistryPackageDetail } from '../../PackageDetail';
import type { ViewProps } from '../../types';
import VersionPicker from '../../VersionPicker';

/**
 * Find a package on the registry and add it — the web page's search box, where typing searched
 * npm and a result could be installed as a prod or dev dependency at any version.
 */
export const AddView = ({
  dir,
  context,
  manager,
  session,
  notify,
  onCaptureInput,
  runCommands,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const { settings } = context;
  const prompt = usePrompt(onCaptureInput);
  const [query, setQuery] = useState(session.search ?? '');
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.add);
  const [picker, setPicker] = useState(session.picker?.mode === 'add' ? session.picker : undefined);
  /** Versions picked per result — "Other version…" is a dropdown, not an install. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const choose = (name: string, version: string | undefined) =>
    setChosen(({ [name]: _was, ...rest }) => (version ? { ...rest, [name]: version } : rest));

  const { data: manifest } = useLoader(() => readManifest(dir), [dir, refreshKey]);
  const {
    data: results = [],
    isLoading,
    error,
  } = useLoader(
    () =>
      query ? searchPackages(query, settings.registry) : Promise.resolve([] as SearchResult[]),
    [query, settings.registry],
  );
  const visible = settings.showUnstable
    ? results
    : results.filter((result) => !isPrerelease(result.version));
  const current = visible.find((result) => result.name === currentId);
  const declared = (name: string) => manifest?.dependencies.find((dep) => dep.name === name);

  const changeQuery = (value: string) => {
    setQuery(value);
    session.search = value;
  };
  //? Longer than the local filters: every settled query is a registry request
  const liveSearch = useDebouncedCallback((value: string) => changeQuery(value.trim()), 350);
  //? Searches as you type; Esc puts back the search that was there before
  const search = () =>
    prompt.ask(
      'Search the registry:',
      (value) => {
        liveSearch.cancel();
        changeQuery(value.trim());
      },
      {
        initial: query,
        onChange: liveSearch,
        onCancel: () => {
          liveSearch.cancel();
          changeQuery(query);
        },
      },
    );

  const install = (
    name: string | undefined,
    version?: string,
    dev = settings.installAs === 'dev',
  ) => {
    if (!name) return;
    const existing = declared(name);
    const type = dev ? 'devDependencies' : 'dependencies';
    const command = addCommand(manager.name, name, version, type);
    prompt.confirm(
      `${existing ? `${name} is already in ${existing.type} (${existing.range}) — ` : ''}${shellQuote(command)}?`,
      () => runCommands([command], `added ${name}${version ? `@${version}` : ''}`),
    );
  };

  const openPicker = (result: SearchResult | undefined) => {
    if (!result) return;
    const next = { name: result.name, mode: 'add' as const };
    setPicker(next);
    session.picker = next;
  };
  const closePicker = () => {
    setPicker(undefined);
    session.picker = undefined;
  };

  useInput(
    (input) => {
      if (input === '/' || input === 's') search();
      else if (input === 'i' && current) install(current.name, chosen[current.name], false);
      else if (input === 'd' && current) install(current.name, chosen[current.name], true);
      else if (input === 'l' && current) choose(current.name, undefined);
      else if (input === 'v') openPicker(current);
      else if (input === 'w' && current) openUrl(`https://www.npmjs.com/package/${current.name}`);
    },
    { isActive: !prompt.isOpen && !picker },
  );

  if (picker) {
    return (
      <VersionPicker
        name={picker.name}
        current={declared(picker.name)?.installed}
        registry={settings.registry}
        cacheHours={settings.cacheHours}
        showUnstable={settings.showUnstable}
        initialVersion={chosen[picker.name]}
        verb="choose"
        onPick={(version) => {
          closePicker();
          choose(picker.name, version);
        }}
        onClose={closePicker}
      />
    );
  }

  const items: PickItem<SearchResult>[] = visible.map((result) => {
    const existing = declared(result.name);
    return {
      id: result.name,
      label: result.name,
      hint: existing
        ? `${result.version} · have ${existing.installed ?? existing.range}`
        : result.version,
      hintColor: existing ? colors.accent : undefined,
      value: result,
    };
  });

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            {query
              ? `${visible.length} result(s) for "${query}"`
              : 'Search the registry with [/]'}
          </Text>
        )}
      </Box>
      <ListDetail
        key={`${query}|${visible.length}`}
        title={`Registry (${visible.length})`}
        items={items}
        emptyText={
          error
            ? `Search failed: ${error}`
            : isLoading && query
              ? 'Searching…'
              : query
                ? 'Nothing found.'
                : 'Press / (or click [/] search below) to search the npm registry.'
        }
        detailTitle={current?.name ?? 'Package'}
        reservedChrome={['viewHeader']}
        activateLabel={`add as ${settings.installAs}`}
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={[{ key: '/', label: 'search', onPress: search }]}
        onActivate={(item) => item.value && install(item.value.name, chosen[item.value.name])}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.add = item?.id;
        }}
        detailFocusable
        renderDetail={(item, _index, focus) => {
          const result = item?.value;
          if (!result) return null;
          const existing = declared(result.name);
          return (
            <Box flexDirection="column">
              <Toolbar
                actions={addActions(result, chosen[result.name], {
                  add: install,
                  choose: () => openPicker(result),
                  reset: () => choose(result.name, undefined),
                })}
                isFocused={focus.isFocused}
                onExit={focus.blur}
              />
              <RegistryPackageDetail
                name={result.name}
                dir={dir}
                registry={settings.registry}
                cacheHours={settings.cacheHours}
                showUnstable={settings.showUnstable}
                declared={existing}
              />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default AddView;
