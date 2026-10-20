import { Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import HintBar from '@/dev-tools/ui/components/HintBar';
import Panel from '@/dev-tools/ui/components/Panel';
import PickList from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { stepsFor } from '../../../core/chain';
import type { Project } from '../../../core/registry';
import type { Tone } from '../../types';
import type { DepliData } from '../../useDepli';
import { envLegend, envTable } from '../EnvsPanel';
import { envLines, jobFolds } from './lines';
import LinesPanel from './LinesPanel';
import useFolds from './useFolds';
import useLinesNav from './useLinesNav';

/** Envs listed at once; more scroll. */
const ENV_ROWS = 10;

/** Which transport each provider uses — what to read again on, once connections come up. */
export const connectionsKey = (data: Pick<DepliData, 'connections'>) =>
  Object.entries(data.connections)
    .map(([name, connection]) => `${name}=${connection.transport ?? '-'}`)
    .join(',');

export interface EnvironmentsViewProps {
  data: DepliData;
  project: Project;
  notify: (text: string, tone?: Tone) => void;
  /** Esc: back to the tab it was opened over. */
  onClose: () => void;
}

/**
 * The Environments window: the Chain tab's env picker table on a page of its own, extended with
 * what each env is meant to run (`envs[].branches` — `off-track` when it runs anything else),
 * and under it the env at the cursor in full — its site, its jobs as a graph, every run of every
 * job by day. Footer `E` opens the detailed view of every env at once.
 */
export const EnvironmentsView = ({ data, project, notify, onClose }: EnvironmentsViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const configs = project.config.envs ?? [];
  const envIds = configs.map((entry) => entry.id);
  const protectedEnvs = configs.filter((entry) => entry.protected).map((entry) => entry.id);
  const [cursor, setCursor] = useState(Math.max(0, envIds.indexOf(data.targetEnv)));
  const env = envIds[cursor] ?? data.targetEnv;
  const config = configs.find((entry) => entry.id === env);

  //? Read once the providers are connected, and again when the branch shown changes
  const connected = connectionsKey(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the connections and branch are the triggers
  useEffect(() => {
    data.loadEnvs();
    data.loadHistory();
  }, [connected, data.branch]);

  const { items, header } = envTable({ envIds, protectedEnvs, data, colors, configs });
  const width = Math.max(40, viewport.columns - 8);
  const folds = useFolds();
  const lines = useMemo(
    () =>
      envLines(
        {
          configs,
          pipeline: project.config.pipeline ?? [],
          stepsFor: (id) => stepsFor(project, id),
          rows: data.envs ?? [],
          history: data.history,
          branch: data.branch,
          targetEnv: data.targetEnv,
          width,
          isOpen: folds.isOpen,
        },
        env,
        true,
      ),
    [
      configs,
      project,
      data.envs,
      data.history,
      data.branch,
      data.targetEnv,
      width,
      env,
      folds.isOpen,
    ],
  );
  const nav = useLinesNav(lines, env);

  const deployUrl = () =>
    data.envs
      ?.find((row) => row.env === env)
      ?.cells.find((cell) => cell.latest.branch !== undefined)?.latest.url;
  const open = (url: string | undefined, what: string) => {
    if (!url) return notify(`No page for ${what}`, 'warn');
    openUrl(url);
    notify(`Opened ${url}`, 'ok');
  };
  //? On a fold, o opens or closes it; on a link, opens its page; on nothing, the env's deploy
  const openFocused = () =>
    nav.focusedAction
      ? folds.toggle(nav.focusedAction, nav.focusedOpen)
      : open(nav.focusedUrl ?? deployUrl(), `${env}'s deploy`);
  const { anyClosed } = jobFolds(lines);
  const foldAll = () => folds.setAll(jobFolds(lines).keys, anyClosed);
  const openSite = () => open(config?.url, `${env} — set envs[].url in depli.config.ts`);
  const pick = (index = cursor) => {
    const id = envIds[index];
    if (!id) return;
    if (id !== data.targetEnv) data.setEnv(id);
    notify(`The chain now shows ${id}`, 'ok');
  };
  const move = (delta: number) =>
    setCursor((at) => Math.max(0, Math.min(envIds.length - 1, at + delta)));

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.upArrow && !key.shift) move(-1);
    else if (key.downArrow && !key.shift) move(1);
    else if (key.return) pick();
    else if (input === 'n') nav.stepLink(1);
    else if (input === 'p') nav.stepLink(-1);
    else if (input === 'o') openFocused();
    else if (input === 'w') openSite();
    else if (input === 'x') foldAll();
    else if (input === 'j' || (key.shift && key.downArrow)) nav.scrollBy(1);
    else if (input === 'k' || (key.shift && key.upArrow)) nav.scrollBy(-1);
    else if (key.pageDown || input === ' ') nav.page(1);
    else if (key.pageUp) nav.page(-1);
    else if (input === 'g') nav.top();
    else if (input === 'G') nav.bottom();
  });

  const listRows = Math.max(1, Math.min(envIds.length, ENV_ROWS));
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0} flexDirection="column">
        <Panel
          title={`Environments — ${data.branch ?? '(no branch)'} highlighted`}
          badge={data.envs ? undefined : 'reading…'}
          color={colors.accent}
          width="100%"
        >
          <PickList
            title={header}
            items={items}
            selected={cursor}
            visibleRows={listRows}
            onSelect={setCursor}
            onActivate={pick}
          />
          <Text color={colors.muted} wrap="truncate-end">
            {`${envLegend()} · off-track = runs a branch outside its envs[].branches`}
          </Text>
        </Panel>
      </Box>
      <Panel
        title={`${env}${config?.protected ? ' (protected)' : ''} — pipeline and runs`}
        badge={data.historyLoading ? 'reading…' : undefined}
        color={colors.muted}
        width="100%"
        grow
      >
        <LinesPanel
          lines={lines}
          offset={nav.offset}
          onOffset={nav.setOffset}
          onRows={nav.setRows}
          focused={nav.focused}
          onOpen={(url) => open(url, 'that link')}
          onAction={folds.toggle}
        />
      </Panel>
      <HintBar
        maxRows={2}
        hints={[
          { key: '↑/↓', label: 'env' },
          { key: 'Enter', label: 'show in chain', onPress: () => pick() },
          { key: 'n/p', label: 'next / prev item', onPress: () => nav.stepLink(1) },
          {
            key: 'o',
            label: nav.focusedAction
              ? nav.focusedOpen
                ? 'close runs'
                : 'open runs'
              : nav.focusedUrl
                ? 'open link'
                : 'open deploy',
            onPress: openFocused,
          },
          { key: 'x', label: anyClosed ? 'open all runs' : 'close all runs', onPress: foldAll },
          { key: 'w', label: 'open site', onPress: openSite },
          { key: 'j/k · wheel', label: 'scroll' },
          { key: 'Esc', label: 'back', onPress: onClose },
        ]}
      />
    </Box>
  );
};

export default EnvironmentsView;
