import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ChipRow from '@/dev-tools/ui/components/ChipRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { addCommand, readManifest, shellQuote } from '../../../core/manifest';
import { type SearchResult, searchPackages } from '../../../core/registry';
import { isPrerelease } from '../../../core/semver';
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
  const [dev, setDev] = useState(session.installDev ?? settings.installAs === 'dev');
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.add);
  const [picker, setPicker] = useState(session.picker?.mode === 'add' ? session.picker : undefined);

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

  const search = () =>
    prompt.ask(
      'Search the registry:',
      (value) => {
        setQuery(value.trim());
        session.search = value.trim();
      },
      { initial: query },
    );

  const toggleDev = () =>
    setDev((was) => {
      session.installDev = !was;
      return !was;
    });

  const install = (result: SearchResult | undefined, version?: string) => {
    if (!result) return;
    const existing = declared(result.name);
    const type = dev ? 'devDependencies' : 'dependencies';
    const command = addCommand(manager.name, result.name, version, type);
    prompt.confirm(
      `${existing ? `${result.name} is already in ${existing.type} (${existing.range}) — ` : ''}${shellQuote(command)}?`,
      () => runCommands([command], `added ${result.name}${version ? `@${version}` : ''}`),
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
      else if (input === 'i') install(current);
      else if (input === 'd') toggleDev();
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
        verb="add"
        onPick={(version) => {
          closePicker();
          install({ name: picker.name, version }, version);
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
      <Box flexShrink={0} flexDirection="row">
        {prompt.line ?? (
          <>
            <Text color={colors.muted} wrap="truncate">
              {query
                ? `${visible.length} result(s) for "${query}" · adds as `
                : 'Search the registry with [/] · adds as '}
            </Text>
            <ChipRow
              compact
              chips={[
                { id: 'prod', label: 'prod', isOn: !dev },
                { id: 'dev', label: 'dev', isOn: dev },
              ]}
              onToggle={(id) => {
                if ((id === 'dev') !== dev) toggleDev();
              }}
            />
          </>
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
        activateLabel={`add as ${dev ? 'dev' : 'prod'}`}
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: '/', label: 'search', onPress: search },
          { key: 'd', label: dev ? 'as dev' : 'as prod', onPress: toggleDev },
        ]}
        onActivate={(item) => install(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.add = item?.id;
        }}
        renderDetail={(item) => {
          const result = item?.value;
          if (!result) return null;
          const existing = declared(result.name);
          return (
            <Box flexDirection="column">
              <Toolbar
                actions={[
                  {
                    hotkey: 'i',
                    label: `Add ${result.version} as ${dev ? 'dev' : 'prod'}`,
                    onPress: () => install(result),
                    tone: 'primary',
                  },
                  { hotkey: 'v', label: 'Other version…', onPress: () => openPicker(result) },
                  { hotkey: 'd', label: dev ? 'Make it prod' : 'Make it dev', onPress: toggleDev },
                  {
                    hotkey: 'w',
                    label: 'npm page',
                    onPress: () => openUrl(`https://www.npmjs.com/package/${result.name}`),
                  },
                ]}
              />
              <Text bold color={colors.heading}>
                {`${result.name}@${result.version}`}
              </Text>
              {result.date && (
                <Text color={colors.muted}>{`published ${result.date.slice(0, 10)}`}</Text>
              )}
              {existing && (
                <Text color={colors.accent}>
                  {`already in ${existing.type}: ${existing.range}${existing.installed ? ` (${existing.installed} installed)` : ''}`}
                </Text>
              )}
              {result.description && (
                <Box marginTop={1}>
                  <Text color={colors.text} wrap="wrap">
                    {result.description}
                  </Text>
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default AddView;
