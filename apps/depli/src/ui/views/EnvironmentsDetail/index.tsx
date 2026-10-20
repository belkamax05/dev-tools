import { type DOMElement, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import HintBar from '@/dev-tools/ui/components/HintBar';
import StatusNote, { type StatusMessage } from '@/dev-tools/ui/components/StatusNote';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useTerminalSize from '@/dev-tools/ui/hooks/useTerminalSize';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { stepsFor } from '../../../core/chain';
import type { Project } from '../../../core/registry';
import { shortStamp } from '../../../core/time';
import type { Tone } from '../../types';
import type { DepliData } from '../../useDepli';
import { connectionsKey } from '../EnvironmentsView';
import {
  type DetailInput,
  type DetailTab,
  detailTabs,
  jobFolds,
  overviewDoc,
  tabId,
  tabLines,
} from '../EnvironmentsView/lines';
import LinesPanel from '../EnvironmentsView/LinesPanel';
import useFolds from '../EnvironmentsView/useFolds';
import useLinesNav from '../EnvironmentsView/useLinesNav';

/** The overview panel takes at most this share of the height; the tabs get the rest. */
const OVERVIEW_SHARE = 0.4;

/** A tab's name — lit when current; a click picks it. */
const Chip = ({
  label,
  current,
  onPress,
}: {
  label: string;
  current: boolean;
  onPress: () => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onPress });
  return (
    <Box ref={ref} flexShrink={0} marginRight={1}>
      <Text
        color={current ? colors.accentText : colors.accent}
        backgroundColor={current || isHovered ? colors.accent : undefined}
      >
        {` ${label} `}
      </Text>
    </Box>
  );
};

/** One kind of tab as a row: its name, then every tab of it — wrapping when they do not fit. */
const TabRow = ({
  label,
  tabs,
  active,
  empty,
  onSelect,
}: {
  label: string;
  tabs: readonly DetailTab[];
  active: string;
  empty: string;
  onSelect: (tab: DetailTab) => void;
}) => {
  const colors = useColors();
  return (
    <Box flexShrink={0} flexDirection="row">
      <Box flexShrink={0} width={6}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1}>
        {tabs.length ? (
          tabs.map((tab) => (
            <Chip
              key={tabId(tab)}
              label={tab.label}
              current={tabId(tab) === active}
              onPress={() => onSelect(tab)}
            />
          ))
        ) : (
          <Text color={colors.muted}>{empty}</Text>
        )}
      </Box>
    </Box>
  );
};

export interface EnvironmentsDetailProps {
  data: DepliData;
  project: Project;
  /** The app's latest status — the shell that shows it is not drawn while this is open. */
  status?: StatusMessage;
  notify: (text: string, tone?: Tone) => void;
  /** Esc: back to the Environments window. */
  onClose: () => void;
}

type Focus = 'overview' | 'tabs';

/**
 * Every env in full, over the whole interface, in two panels: on top the overview table and
 * branches → envs as a graph; under it tabs, one page at a time — an env (its job graph and every
 * run of every job by day) or a job (its runs, and across the envs where it acts on one). Every
 * build number and job is a link to its page.
 *
 * Drawn in place of the dashboard rather than over it, so nothing under it can be clicked.
 */
export const EnvironmentsDetail = ({
  data,
  project,
  status,
  notify,
  onClose,
}: EnvironmentsDetailProps) => {
  const colors = useColors();
  const { app } = useTuiTheme().sizes;
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const width = Math.max(40, columns - app.horizontalMargin - 7);
  const configs = project.config.envs ?? [];

  const connected = connectionsKey(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the connections are the trigger
  useEffect(() => {
    if (!data.envs) data.loadEnvs();
    if (!data.history) data.loadHistory();
  }, [connected]);

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
    }),
    [configs, project, data.envs, data.history, data.branch, data.targetEnv, width, folds.isOpen],
  );

  const overview = useMemo(() => overviewDoc(input), [input]);
  const tabs = useMemo(() => detailTabs(input), [input]);
  const allTabs = [...tabs.envs, ...tabs.jobs];
  const [chosen, setChosen] = useState(tabId({ kind: 'env', id: data.targetEnv }));
  //? A job tab is only there once history is read; until then (or if it goes) the first env
  const tab = allTabs.find((item) => tabId(item) === chosen) ?? tabs.envs[0];
  const active = tab ? tabId(tab) : chosen;
  const lines = useMemo(() => (tab ? tabLines(input, tab) : []), [input, tab]);

  const [focus, setFocus] = useState<Focus>('tabs');
  const top = useLinesNav(overview);
  const page = useLinesNav(lines, active);
  const nav = focus === 'overview' ? top : page;

  const select = (next: DetailTab) => {
    setChosen(tabId(next));
    setFocus('tabs');
  };
  const stepTab = (delta: number) => {
    if (!allTabs.length) return;
    const at = allTabs.findIndex((item) => tabId(item) === active);
    const next = allTabs[(at + delta + allTabs.length) % allTabs.length];
    if (next) select(next);
  };
  const open = (url: string | undefined) => {
    if (!url) return notify('n to a link first, or click one', 'info');
    openUrl(url);
    notify(`Opened ${url}`, 'ok');
  };
  //? On a fold, Enter opens or closes it; on a link, opens its page
  const activate = () =>
    nav.focusedAction ? folds.toggle(nav.focusedAction, nav.focusedOpen) : open(nav.focusedUrl);
  const { anyClosed } = jobFolds(lines);
  const foldAll = () => folds.setAll(jobFolds(lines).keys, anyClosed);
  const reread = () => {
    data.loadEnvs();
    data.loadHistory();
  };

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (input === 'q') exit();
    else if (key.tab) setFocus((was) => (was === 'tabs' ? 'overview' : 'tabs'));
    else if (key.rightArrow || input === 'l') stepTab(1);
    else if (key.leftArrow || input === 'h') stepTab(-1);
    else if (input === 'n') nav.stepLink(1);
    else if (input === 'p') nav.stepLink(-1);
    else if (key.return || input === 'o') activate();
    else if (input === 'x') foldAll();
    else if (input === 'r') reread();
    else if (key.downArrow || input === 'j') nav.scrollBy(1);
    else if (key.upArrow || input === 'k') nav.scrollBy(-1);
    else if (key.pageDown || input === ' ' || (key.ctrl && input === 'd')) nav.page(1);
    else if (key.pageUp || (key.ctrl && input === 'u')) nav.page(-1);
    else if (input === 'g' || key.home) nav.top();
    else if (input === 'G' || key.end) nav.bottom();
  });

  const height = Math.max(1, rows - app.heldBackRows);
  //? Frame, title, hints (and the status) aside: the overview as tall as it is, within its share
  const inner = height - 2 - 1 - 2 - (status ? 1 : 0);
  const overviewHeight = Math.max(
    5,
    Math.min(overview.length + 2, Math.floor(inner * OVERVIEW_SHARE)),
  );
  const frame = (panel: Focus) => (focus === panel ? colors.accent : colors.muted);
  const reading = data.historyLoading || !data.envs;
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
            {`Environments — detailed · ${data.branch ?? '(no branch)'} highlighted · chain on ${data.targetEnv}`}
          </Text>
          <Text color={reading ? colors.warn : colors.muted}>
            {reading ? ' reading…' : data.history ? ` read ${shortStamp(data.history.readAt)}` : ''}
          </Text>
        </Box>
        <Box
          flexDirection="column"
          flexShrink={0}
          height={overviewHeight}
          borderStyle="round"
          borderColor={frame('overview')}
          paddingX={1}
          overflow="hidden"
        >
          <LinesPanel
            lines={overview}
            offset={top.offset}
            onOffset={top.setOffset}
            onRows={top.setRows}
            focused={focus === 'overview' ? top.focused : undefined}
            onOpen={open}
            onAction={folds.toggle}
          />
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={frame('tabs')}
          paddingX={1}
          overflow="hidden"
        >
          <TabRow label="envs" tabs={tabs.envs} active={active} empty="—" onSelect={select} />
          <TabRow
            label="jobs"
            tabs={tabs.jobs}
            active={active}
            empty={data.history ? 'no jobs read' : 'reading…'}
            onSelect={select}
          />
          <LinesPanel
            lines={lines}
            offset={page.offset}
            onOffset={page.setOffset}
            onRows={page.setRows}
            focused={focus === 'tabs' ? page.focused : undefined}
            onOpen={open}
            onAction={folds.toggle}
          />
        </Box>
        {status && (
          <Box flexShrink={0}>
            <StatusNote text={status.text} tone={status.tone} />
          </Box>
        )}
        <HintBar
          width={width}
          maxRows={2}
          hints={[
            { key: '←/→', label: 'tab', onPress: () => stepTab(1) },
            {
              key: 'Tab',
              label: focus === 'tabs' ? 'to overview' : 'to tabs',
              onPress: () => setFocus(focus === 'tabs' ? 'overview' : 'tabs'),
            },
            { key: 'n/p', label: 'next / prev item', onPress: () => nav.stepLink(1) },
            {
              key: 'Enter/o',
              label: nav.focusedAction
                ? nav.focusedOpen
                  ? 'close runs'
                  : 'open runs'
                : 'open link',
              onPress: activate,
            },
            { key: 'x', label: anyClosed ? 'open all runs' : 'close all runs', onPress: foldAll },
            { key: 'j/k · wheel', label: 'scroll' },
            { key: 'PgUp/PgDn', label: 'page', onPress: () => nav.page(1) },
            { key: 'r', label: 'read again', onPress: reread },
            { key: 'Esc', label: 'close', onPress: onClose },
          ]}
        />
      </Box>
    </Box>
  );
};

export default EnvironmentsDetail;
