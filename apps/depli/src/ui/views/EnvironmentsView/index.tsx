import { Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import HintBar from '@/dev-tools/ui/components/HintBar';
import PickList from '@/dev-tools/ui/components/PickList';
import StatusNote, { type StatusMessage } from '@/dev-tools/ui/components/StatusNote';
import useTerminalSize from '@/dev-tools/ui/hooks/useTerminalSize';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { stepsFor } from '../../../core/chain';
import type { Project } from '../../../core/registry';
import { shortStamp } from '../../../core/time';
import type { Tone } from '../../types';
import type { DepliData } from '../../useDepli';
import { envLegend, envTable } from '../EnvsPanel';
import { type DetailInput, foldsOf, type Line, type Target, targetOf } from './lines';
import LinesPanel from './LinesPanel';
import {
  crumbs,
  envRootLines,
  neighbour,
  pathTo,
  resolveTarget,
  runPageLines,
  runsFor,
  stepPageLines,
} from './pages';
import PathBar from './PathBar';
import RunPanels from './RunPanels';
import useFolds from './useFolds';
import useKeptOffsets from './useKeptOffsets';
import useLinesNav from './useLinesNav';

/** Envs listed at once; more scroll. */
const ENV_ROWS = 10;
/** The log's share of the height on a run's page, when open. */
const LOG_SHARE = 0.45;

/** Which transport each provider uses — what to read again on, once connections come up. */
export const connectionsKey = (data: Pick<DepliData, 'connections'>) =>
  Object.entries(data.connections)
    .map(([name, connection]) => `${name}=${connection.transport ?? '-'}`)
    .join(',');

type Focus = 'envs' | 'page';

export interface EnvironmentsViewProps {
  data: DepliData;
  project: Project;
  /** The app's latest status — the shell that shows it is not drawn while this is open. */
  status?: StatusMessage;
  notify: (text: string, tone?: Tone) => void;
  /** Esc at the env's page: back to the tab it was opened over. */
  onClose: () => void;
}

/**
 * The Environments view, over the whole terminal, one level inside the other: the env table on
 * top picks the env; under it the env's page — the branch on it and its pipeline as a graph of
 * what each step left there; a box's title opens that step on the env (its runs that concern the
 * env), a run number the run (what it was, where it stands, its stages and log). A path says
 * where you are; Esc goes back up it.
 *
 * Drawn in place of the dashboard rather than over it, so nothing under it can be clicked.
 */
export const EnvironmentsView = ({
  data,
  project,
  status,
  notify,
  onClose,
}: EnvironmentsViewProps) => {
  const colors = useColors();
  const { app } = useTuiTheme().sizes;
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const width = Math.max(40, columns - app.horizontalMargin - 7);
  const configs = project.config.envs ?? [];
  const envIds = configs.map((entry) => entry.id);
  const protectedEnvs = configs.filter((entry) => entry.protected).map((entry) => entry.id);
  const [cursor, setCursor] = useState(Math.max(0, envIds.indexOf(data.targetEnv)));
  const env = envIds[cursor] ?? data.targetEnv;
  const config = configs.find((entry) => entry.id === env);
  //? The pages opened inside the env, outermost first: a step, then maybe one of its runs
  const [path, setPath] = useState<Target[]>([]);
  const page = path.at(-1);
  const [focus, setFocus] = useState<Focus>('page');
  const [logOpen, setLogOpen] = useState(false);

  //? Read once the providers are connected, and again when the branch shown changes
  const connected = connectionsKey(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the connections and branch are the triggers
  useEffect(() => {
    data.loadEnvs();
    data.loadHistory();
  }, [connected, data.branch]);

  const { items, header } = envTable({ envIds, protectedEnvs, data, colors, configs });
  const folds = useFolds();
  const input = useMemo(
    (): DetailInput => ({
      configs,
      pipeline: project.config.pipeline ?? [],
      stepsFor: (id) => stepsFor(project, id),
      rows: data.envs ?? [],
      history: data.history,
      branch: data.branch,
      targetEnv: data.targetEnv,
      width,
      isOpen: folds.isOpen,
      commitUrl: data.commitUrl,
    }),
    [
      configs,
      project,
      data.envs,
      data.history,
      data.branch,
      data.targetEnv,
      width,
      folds.isOpen,
      data.commitUrl,
    ],
  );
  const lines = useMemo(
    (): Line[] =>
      !page
        ? envRootLines(input, env)
        : page.run === undefined
          ? stepPageLines(input, env, page, folds.isOpen)
          : runPageLines(input, env, page),
    [input, env, page, folds.isOpen],
  );

  const pageKey = JSON.stringify([env, path]);
  const nav = useLinesNav(lines, pageKey);
  const keep = useKeptOffsets(pageKey, nav);

  const resolved = page?.run === undefined ? undefined : resolveTarget(input, env, page);
  const run = resolved?.run;
  const reads = resolved?.step ? data.jobRunReads(resolved.step) : undefined;

  const go = (next: Target[]) => {
    keep();
    setPath(next);
  };
  const goTo = (to: string) => go(pathTo(targetOf(to)));
  const back = () => (path.length ? go(path.slice(0, -1)) : onClose());
  const otherRun = (delta: number) => {
    if (!resolved?.step || !resolved.job || !run || !page) return;
    const runs = runsFor(resolved.step, resolved.job, resolved.context);
    const next = neighbour(runs, run, delta);
    if (!next) return notify(delta > 0 ? 'The oldest run read' : 'The newest run', 'info');
    go([...path.slice(0, -1), { ...page, run: next.id }]);
  };
  //? Another env: the pages it has too stay open (a build's step, the same run), the rest close
  const selectEnv = (next: number) => {
    const id = envIds[next];
    if (!id || next === cursor) return;
    keep();
    setCursor(next);
    const kept: Target[] = [];
    for (const target of path) {
      const found = resolveTarget(input, id, target);
      if (!found.history || (target.run !== undefined && !found.run)) break;
      kept.push(target);
    }
    setPath(kept);
  };
  const switchEnv = (delta: number) =>
    selectEnv(Math.max(0, Math.min(envIds.length - 1, cursor + delta)));

  const open = (url: string | undefined, what: string) => {
    if (!url) return notify(`No page for ${what}`, 'warn');
    openUrl(url);
    notify(`Opened ${url}`, 'ok');
  };
  const deployUrl = () =>
    data.envs
      ?.find((row) => row.env === env)
      ?.cells.find((cell) => cell.latest.branch !== undefined)?.latest.url;
  const pick = (index = cursor) => {
    const id = envIds[index];
    if (!id) return;
    if (id !== data.targetEnv) data.setEnv(id);
    notify(`The chain now shows ${id}`, 'ok');
  };
  //? o: a fold toggles; a link (a step's or run's too) opens on the server; else the page's own
  const openFocused = () =>
    nav.focusedAction
      ? folds.toggle(nav.focusedAction, nav.focusedOpen)
      : nav.focusedUrl
        ? open(nav.focusedUrl, 'that link')
        : run
          ? open(run.url, `#${run.id}`)
          : page
            ? open(resolveTarget(input, env, page).history?.jobs[0]?.url, page.step)
            : open(deployUrl(), `${env}'s deploy`);
  //? Enter: a step or run goes to its page; a fold toggles; a link opens; else the next item
  const activate = () =>
    nav.focusedTo
      ? goTo(nav.focusedTo)
      : nav.focusedAction
        ? folds.toggle(nav.focusedAction, nav.focusedOpen)
        : nav.focusedUrl
          ? open(nav.focusedUrl, 'that link')
          : nav.stepLink(1);
  const openSite = () => open(config?.url, `${env} — set envs[].url in depli.config.ts`);
  const { anyClosed, keys: foldKeys } = foldsOf(lines);
  const foldAll = () => folds.setAll(foldKeys, anyClosed);
  const reread = () => {
    data.loadEnvs();
    data.loadHistory();
  };

  const logShown = Boolean(run && logOpen && reads?.logs);
  useInput((typed, key) => {
    if (key.escape || key.backspace) back();
    else if (typed === 'q') exit();
    else if (key.tab) setFocus((was) => (was === 'page' ? 'envs' : 'page'));
    else if (typed === '[') switchEnv(-1);
    else if (typed === ']') switchEnv(1);
    else if (focus === 'envs') {
      if (key.upArrow || typed === 'k') switchEnv(-1);
      else if (key.downArrow || typed === 'j') switchEnv(1);
      else if (key.return) pick();
      else if (typed === 'w') openSite();
    } else if (key.return) activate();
    else if (typed === 'n') nav.stepLink(1);
    else if (typed === 'p') nav.stepLink(-1);
    else if (typed === 'o') openFocused();
    else if (typed === 'w') openSite();
    else if (typed === 'x' && foldKeys.length) foldAll();
    else if (typed === 'r') reread();
    else if (run && typed === 'l' && reads?.logs) setLogOpen((was) => !was);
    else if (run && !logShown && typed === ',') otherRun(1);
    else if (run && !logShown && typed === '.') otherRun(-1);
    //? With the log open, the log takes the scrolling keys
    else if (logShown) return;
    else if (key.downArrow || typed === 'j') nav.scrollBy(1);
    else if (key.upArrow || typed === 'k') nav.scrollBy(-1);
    else if (key.pageDown || typed === ' ' || (key.ctrl && typed === 'd')) nav.page(1);
    else if (key.pageUp || (key.ctrl && typed === 'u')) nav.page(-1);
    else if (typed === 'g' || key.home) nav.top();
    else if (typed === 'G' || key.end) nav.bottom();
  });

  const height = Math.max(1, rows - app.heldBackRows);
  const listRows = Math.max(1, Math.min(envIds.length, ENV_ROWS));
  const frame = (panel: Focus) => (focus === panel ? colors.accent : colors.muted);
  const reading = data.historyLoading || !data.envs;
  const names = crumbs(input, env, path);
  const enterLabel = nav.focusedTo
    ? 'open'
    : nav.focusedAction
      ? nav.focusedOpen
        ? 'close day'
        : 'open day'
      : nav.focusedUrl
        ? 'open link'
        : 'next item';
  return (
    <Box width={columns} height={height} backgroundColor={colors.page}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="double"
        borderColor={colors.accent}
        paddingX={1}
        overflow="hidden"
      >
        <Box flexShrink={0} justifyContent="space-between">
          <Text bold color={colors.accent} wrap="truncate">
            {`Environments · ${data.branch ?? '(no branch)'} highlighted · chain on ${data.targetEnv}`}
          </Text>
          <Text color={reading ? colors.warn : colors.muted}>
            {reading ? ' reading…' : data.history ? ` read ${shortStamp(data.history.readAt)}` : ''}
          </Text>
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          <PickList
            title={header}
            items={items}
            selected={cursor}
            isFocused={focus === 'envs'}
            borderColor={frame('envs')}
            visibleRows={listRows}
            onSelect={selectEnv}
            onActivate={(index) => {
              selectEnv(index);
              go([]);
              setFocus('page');
            }}
          />
          <Text color={colors.muted} wrap="truncate-end">
            {`${envLegend()} · off-track = on a branch it is not meant for`}
          </Text>
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={frame('page')}
          paddingX={1}
          overflow="hidden"
        >
          <PathBar
            hint={path.length ? 'Esc back' : 'a step’s title opens it'}
            crumbs={[
              {
                label: `◂ ${env}${config?.protected ? ' (protected)' : ''}`,
                onPress: () => go([]),
              },
              ...names.map((label, index) => ({
                label,
                onPress: () => go(path.slice(0, index + 1)),
              })),
            ]}
          />
          <LinesPanel
            lines={lines}
            offset={nav.offset}
            onOffset={nav.setOffset}
            onRows={nav.setRows}
            focused={focus === 'page' ? nav.focused : undefined}
            onOpen={(url) => open(url, 'that link')}
            onAction={folds.toggle}
            onGo={goTo}
          />
        </Box>
        {run && resolved?.step && resolved.job && (
          <RunPanels
            data={data}
            step={resolved.step}
            job={resolved.job}
            run={run}
            logOpen={logOpen}
            logRows={Math.max(6, Math.floor(height * LOG_SHARE))}
            width={width}
            onOtherRun={otherRun}
          />
        )}
        {status && (
          <Box flexShrink={0}>
            <StatusNote text={status.text} tone={status.tone} />
          </Box>
        )}
        <HintBar
          width={width}
          maxRows={2}
          hints={[
            {
              key: 'Tab',
              label: focus === 'page' ? 'to envs' : 'to page',
              onPress: () => setFocus(focus === 'page' ? 'envs' : 'page'),
            },
            { key: '[/]', label: 'env' },
            ...(focus === 'envs'
              ? [{ key: 'Enter', label: 'show in chain', onPress: () => pick() }]
              : [
                  { key: 'n/p', label: 'next / prev item', onPress: () => nav.stepLink(1) },
                  { key: 'Enter', label: enterLabel, onPress: activate },
                  {
                    key: 'o',
                    label: nav.focusedUrl
                      ? 'open on server'
                      : run
                        ? 'open run on server'
                        : page
                          ? 'open job on server'
                          : 'open deploy',
                    onPress: openFocused,
                  },
                ]),
            ...(foldKeys.length
              ? [{ key: 'x', label: anyClosed ? 'open all days' : 'close all days', onPress: foldAll }]
              : []),
            ...(run
              ? [
                  { key: ',/.', label: 'older / newer run', onPress: () => otherRun(1) },
                  ...(reads?.logs
                    ? [
                        {
                          key: 'l',
                          label: logOpen ? 'hide log' : 'log',
                          onPress: () => setLogOpen((was) => !was),
                        },
                      ]
                    : []),
                ]
              : []),
            { key: 'w', label: 'open site', onPress: openSite },
            { key: 'r', label: 'read again', onPress: reread },
            { key: 'Esc', label: path.length ? 'back' : 'close', onPress: back },
          ]}
        />
      </Box>
    </Box>
  );
};

export default EnvironmentsView;
