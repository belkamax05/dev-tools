import { type DOMElement, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import ChipRow from '@/dev-tools/ui/components/ChipRow';
import HintBar from '@/dev-tools/ui/components/HintBar';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import Panel from '@/dev-tools/ui/components/Panel';
import PickList from '@/dev-tools/ui/components/PickList';
import Popover from '@/dev-tools/ui/components/Popover';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';
import openUrl from '@/dev-tools/utils/system/openUrl';

import type { ChainStep } from '../../../core/chain';
import { planToCurl } from '../../../core/curl';
import { layoutGraph } from '../../../core/graph';
import { fillTemplate, type StepRun, type StepState } from '../../../core/plugin';
import type { PlannedTrigger } from '../../../core/trigger';
import Avatar from '../../graphics/Avatar';
import ChainGraph, { ago } from '../../graphics/ChainGraph';
import HistoryStrip from '../../graphics/HistoryStrip';
import LogPanel from '../LogPanel';
import type { Session, Tone } from '../../types';
import type { DepliData } from '../../useDepli';

/** Side by side from this width, as `ListDetail` does; stacked below it. */
const SIDE_BY_SIDE_COLUMNS = 96;
/** The graph's share of the width beside the detail pane. */
const GRAPH_SHARE = 0.5;

export interface ChainViewProps {
  data: DepliData;
  envIds: string[];
  protectedEnvs: string[];
  triggersEnabled: boolean;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  onCaptureInput: (captured: boolean) => void;
  /** `b`: go and pick a branch, with the filter open. */
  onPickBranch: () => void;
}

const RUN_ICON: Record<StepRun['state'], string> = {
  success: '✓',
  failure: '✗',
  running: '◐',
  aborted: '⊘',
  queued: '…',
  other: '·',
};

const minutes = (ms?: number) =>
  !ms || ms <= 0 ? '' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
const stamp = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The chain for the branch and env, once: the graph on the left — every step a box, steps that
 * can run in parallel side by side — and the selected step on the right. Arrows move through the
 * graph (↑/↓ between levels, ←/→ between parallel steps), Enter shows a step's trigger as a dry
 * run. The trigger itself is gated (core/trigger), and its key is not bound while triggers are off.
 */
export const ChainView = ({
  data,
  envIds,
  protectedEnvs,
  triggersEnabled,
  session,
  notify,
  onCaptureInput,
  onPickBranch,
}: ChainViewProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const rootRef = useRef<DOMElement>(null);
  const chipsRef = useRef<DOMElement>(null);
  const [plans, setPlans] = useState<Record<string, PlannedTrigger | string>>({});
  const [selectedId, setSelectedId] = useState(session.selected.chain);
  const [picking, setPicking] = useState<number | undefined>(undefined);
  const [confirming, setConfirming] = useState<PlannedTrigger>();
  //? Logs per step: what the user chose with [l], else open while the step is running
  const [logChoice, setLogChoice] = useState<Record<string, boolean>>({});
  const [runPick, setRunPick] = useState<Record<string, number>>({});

  //? A plan describes the chain as it was: drop them all whenever the chain is re-read
  // biome-ignore lint/correctness/useExhaustiveDependencies: data.chain is the trigger
  useEffect(() => setPlans({}), [data.chain]);

  const selected = data.chain.find((entry) => entry.step.id === selectedId) ?? data.chain[0];
  const runs = selected?.status.runs ?? [];
  const runIndex = Math.min(runPick[selected?.step.id ?? ''] ?? 0, Math.max(0, runs.length - 1));
  const logRun = runs[runIndex];
  //? Open while the step runs, unless [l] said otherwise for it; closed otherwise
  const logsOpen = Boolean(
    selected && (logChoice[selected.step.id] ?? selected.status.state === 'running'),
  );
  const readSelectedLog = useCallback(
    (run: StepRun, start: number) =>
      selected ? data.readLog(selected, run, start) : Promise.reject(new Error('no step')),
    [selected, data],
  );
  const fill = (text: string) =>
    fillTemplate(text, { env: data.targetEnv, branch: data.branch ?? '' });

  //? Sizes: the same frame budget ListDetail uses, split between the graph and the detail
  const appWidth = Math.max(
    viewport.columns - theme.sizes.app.horizontalMargin,
    theme.sizes.app.minWidth,
  );
  const sideBySide = viewport.columns >= SIDE_BY_SIDE_COLUMNS;
  const graphPaneWidth = sideBySide ? Math.floor(appWidth * GRAPH_SHARE) : appWidth;
  const graphWidth = graphPaneWidth - 4;
  const contentRows = viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'chipRow'], 6);
  const graphRows = sideBySide ? contentRows : Math.max(6, Math.floor(contentRows / 2));
  const levels = layoutGraph(
    data.chain.map((entry) => ({ id: entry.step.id, after: entry.step.after })),
    graphWidth,
  );

  const stateColor = (state: StepState) =>
    state === 'done'
      ? colors.ok
      : state === 'stale' || state === 'blocked' || state === 'none'
        ? colors.warn
        : state === 'running'
          ? colors.accent
          : colors.error;

  const select = (id: string | undefined) => {
    if (!id) return;
    setSelectedId(id);
    session.selected.chain = id;
  };

  /** ↑/↓ to the level above or below — to the box nearest under the current one. */
  const moveLevel = (delta: number) => {
    const at = levels.findIndex((level) =>
      level.nodes.some((node) => node.id === selected?.step.id),
    );
    const from = levels[at]?.nodes.find((node) => node.id === selected?.step.id);
    const target = levels[at + delta];
    if (!from || !target) return;
    //? Along an edge first — the leftmost step this one leads to (or comes from) — else the
    //? box nearest under it
    const after = (id: string) =>
      data.chain.find((entry) => entry.step.id === id)?.step.after ?? [];
    const linked = target.nodes.find((node) =>
      delta > 0 ? after(node.id).includes(from.id) : after(from.id).includes(node.id),
    );
    const nearest = [...target.nodes].sort(
      (a, b) => Math.abs(a.center - from.center) - Math.abs(b.center - from.center) || a.x - b.x,
    )[0];
    select((linked ?? nearest)?.id);
  };
  /** ←/→ between steps on one level — the ones that can run in parallel. */
  const moveAcross = (delta: number) => {
    const level = levels.find((item) => item.nodes.some((node) => node.id === selected?.step.id));
    if (!level) return;
    const at = level.nodes.findIndex((node) => node.id === selected?.step.id);
    select(level.nodes[Math.max(0, Math.min(level.nodes.length - 1, at + delta))]?.id);
  };

  const stepEnv = (delta: number) => {
    const at = envIds.indexOf(data.targetEnv);
    data.setEnv(envIds[(at + delta + envIds.length) % envIds.length] ?? data.targetEnv);
  };
  const openPicker = () => setPicking(Math.max(0, envIds.indexOf(data.targetEnv)));

  /** The next recommended step after the selected one, wrapping — `n` cycles through them all. */
  const jumpToNext = () => {
    const recommended = data.chain.filter((entry) => entry.recommended);
    if (!recommended.length)
      return notify('Nothing is recommended — the chain is up to date or blocked', 'info');
    const at = recommended.findIndex((entry) => entry.step.id === selected?.step.id);
    select(recommended[(at + 1) % recommended.length]?.step.id);
  };

  const showPlan = (entry: ChainStep) =>
    data
      .plan(entry.step.id)
      .then((planned) => {
        setPlans((was) => ({ ...was, [entry.step.id]: planned }));
        return planned;
      })
      .catch((error: Error) => {
        setPlans((was) => ({ ...was, [entry.step.id]: error.message }));
        return undefined;
      });

  const openStep = (entry: ChainStep | undefined) => {
    if (entry?.status.url) openUrl(entry.status.url);
    else notify('Nothing to open for this step', 'warn');
  };
  const openLatestRun = (entry: ChainStep | undefined) => {
    const url = entry?.status.runs?.find((run) => run.url)?.url;
    if (url) openUrl(url);
    else notify('No run to open', 'warn');
  };
  const copyCurl = async (entry: ChainStep | undefined) => {
    if (!entry) return;
    const planned = await showPlan(entry);
    if (!planned) return notify(`${entry.step.label} has no trigger to copy`, 'warn');
    copyToClipboard(planToCurl(planned.plan));
    notify('Copied the request as curl — variable names only, nothing was sent', 'ok');
  };

  /** The trigger: plan, show it in the popover, then confirm — by name for a protected env. */
  const startTrigger = async (entry: ChainStep | undefined) => {
    if (!entry) return;
    const planned = await showPlan(entry);
    if (!planned) return;
    if (planned.blockers.length)
      return notify(`Not sendable: ${planned.blockers.join('; ')}`, 'warn');
    setConfirming(planned);
    const send = (typed?: string) =>
      data
        .send(planned, typed)
        .then((sent) => {
          notify(`Queued ${planned.plan.target}${sent.url ? ` — ${sent.url}` : ''}`, 'ok');
          data.refresh();
        })
        .catch((error: Error) => notify(`Not sent: ${error.message}`, 'error'))
        .finally(() => setConfirming(undefined));
    if (planned.protected)
      prompt.ask(
        `${data.targetEnv} is protected — type "${data.targetEnv}" to send:`,
        (typed) => send(typed.trim()),
        { onCancel: () => setConfirming(undefined) },
      );
    else prompt.confirm(`Send ${planned.plan.target} for ${data.branch}?`, () => send());
  };

  const pickerOpen = picking !== undefined;
  useInput(
    (input, key) => {
      if (pickerOpen) {
        if (key.escape) setPicking(undefined);
        else if (key.upArrow) setPicking((at) => Math.max(0, (at ?? 0) - 1));
        else if (key.downArrow) setPicking((at) => Math.min(envIds.length - 1, (at ?? 0) + 1));
        else if (key.return) {
          const env = envIds[picking ?? 0];
          if (env) data.setEnv(env);
          setPicking(undefined);
        }
        return;
      }
      //? Shift+arrows belong to the log panel's scrolling
      if (key.shift && (key.upArrow || key.downArrow)) return;
      if (key.upArrow) moveLevel(-1);
      else if (key.downArrow) moveLevel(1);
      else if (key.leftArrow) moveAcross(-1);
      else if (key.rightArrow) moveAcross(1);
      else if (key.return && selected) showPlan(selected);
      else if (input === 'e' || input === ']') stepEnv(1);
      else if (input === '[') stepEnv(-1);
      else if (input === 'E') openPicker();
      else if (input === 'n') jumpToNext();
      else if (input === 'o') openStep(selected);
      else if (input === 'O') openLatestRun(selected);
      else if (input === 'c') copyCurl(selected);
      else if (input === 'b') onPickBranch();
      else if (input === 'l' && selected)
        setLogChoice((was) => ({ ...was, [selected.step.id]: !logsOpen }));
      //? Bound only with the gate open: while triggers are off no key can start one
      else if (input === 'T' && triggersEnabled) startTrigger(selected);
    },
    { isActive: !prompt.isOpen },
  );

  const envChips = envIds.map((env) => ({
    id: env,
    label: protectedEnvs.includes(env) ? `${env}!` : env,
    isOn: env === data.targetEnv,
    tooltip: protectedEnvs.includes(env)
      ? `${env} is protected: every trigger is confirmed by typing its name`
      : undefined,
  }));

  const renderPlan = (planned: PlannedTrigger | string | undefined) => {
    if (!planned) return <Text color={colors.muted}>[Enter] dry run · [c] copy as curl</Text>;
    if (typeof planned === 'string') return <Text color={colors.muted}>{planned}</Text>;
    return (
      <Box flexDirection="column">
        <Text color={colors.heading}>Dry run — not sent</Text>
        <Text color={colors.text} wrap="truncate-middle">
          {planned.plan.method} {planned.plan.url}
        </Text>
        {Object.entries(planned.plan.params).map(([key, value]) => (
          <Text key={key} wrap="truncate-end">
            <Text color={colors.muted}> {key}=</Text>
            <Text color={value === 'true' ? colors.ok : colors.text}>{value}</Text>
          </Text>
        ))}
        {(planned.plan.warnings ?? []).map((warning) => (
          <Text key={warning} color={colors.warn} wrap="wrap">
            ! {warning}
          </Text>
        ))}
        {planned.protected && (
          <Text color={colors.error} wrap="wrap">
            ! {data.targetEnv} is protected — sending needs its name typed
          </Text>
        )}
        {planned.blockers.map((blocker) => (
          <Text key={blocker} color={colors.error} wrap="wrap">
            ✗ {blocker}
          </Text>
        ))}
      </Box>
    );
  };

  /** The Trigger button: live only with the gate open; otherwise it explains what blocks it. */
  const triggerButton = (entry: ChainStep) => {
    const planned = plans[entry.step.id];
    const blockers =
      typeof planned === 'object'
        ? planned.blockers
        : triggersEnabled
          ? []
          : ['triggers are off (triggers.enabled in depli.config.ts)'];
    const explain = () =>
      notify(
        blockers.length ? `Trigger blocked: ${blockers.join('; ')}` : 'Press T to trigger',
        'info',
      );
    return (
      <ActionButton
        hotkey={triggersEnabled ? 'T' : undefined}
        label={blockers.length ? 'Trigger (blocked)' : 'Trigger…'}
        color={blockers.length ? colors.muted : entry.protected ? colors.error : colors.accent}
        onPress={() => (blockers.length || !triggersEnabled ? explain() : startTrigger(entry))}
        onHover={(hovered) => {
          if (hovered) explain();
        }}
      />
    );
  };

  const actions = (entry: ChainStep): ToolbarAction[] => [
    { hotkey: 'o', label: 'open', onPress: () => openStep(entry), disabled: !entry.status.url },
    {
      hotkey: 'O',
      label: 'last run',
      onPress: () => openLatestRun(entry),
      disabled: !entry.status.runs?.some((run) => run.url),
    },
    { hotkey: 'c', label: 'copy curl', onPress: () => copyCurl(entry) },
  ];

  const detailWidth = (sideBySide ? appWidth - graphPaneWidth : appWidth) - 4;

  const detail = (entry: ChainStep) => {
    const { status } = entry;
    const finished = status.ref?.finishedAt;
    const whenLabel = entry.step.kind === 'branch' ? 'pushed' : 'last good';
    return (
      <Box flexDirection="column">
        {entry.step.kind !== 'branch' && triggerButton(entry)}
        <Toolbar actions={actions(entry)} />
        <Box flexDirection="row">
          {status.actor && (
            <Box marginRight={1} flexShrink={0}>
              <Avatar
                url={status.actor.avatarUrl}
                initials={status.actor.login}
                overlayId={0x5e03}
              />
            </Box>
          )}
          <Box flexDirection="column" flexGrow={1}>
            <Text color={stateColor(status.state)} bold wrap="wrap">
              {fill(entry.step.label)} — {status.state.toUpperCase()}
              {entry.recommended ? ' · recommended next' : ''}
            </Text>
            {/*? The time is the thing to read first: when this step last did its job */}
            <Text wrap="wrap">
              <Text color={colors.muted}>{whenLabel.padEnd(10)}</Text>
              {finished ? (
                <>
                  <Text color={colors.accent} bold>
                    {ago(finished)}
                  </Text>
                  <Text color={colors.text}>
                    {'  '}
                    {stamp(finished)}
                    {status.ref?.buildNumber !== undefined ? `  #${status.ref.buildNumber}` : ''}
                  </Text>
                </>
              ) : (
                <Text color={colors.warn} bold>
                  {`never for ${data.branch}`}
                </Text>
              )}
            </Text>
            {status.actor && (
              <Text wrap="wrap">
                <Text color={colors.muted}>{'by'.padEnd(10)}</Text>
                <Text color={colors.text} bold>
                  {status.actor.login}
                </Text>
                <Text color={colors.muted}>
                  {status.actor.name && status.actor.name !== status.actor.login
                    ? ` (${status.actor.name})`
                    : ''}
                  {status.actor.action ? ` · ${status.actor.action.replaceAll('_', ' ')}` : ''}
                  {status.actor.at ? ` · ${ago(status.actor.at)}` : ''}
                </Text>
              </Text>
            )}
            <Text color={colors.text} wrap="wrap">
              {status.summary}
            </Text>
          </Box>
        </Box>
        {(status.notes ?? []).map((note) => (
          <Text key={note} color={colors.muted} wrap="wrap">
            {note}
          </Text>
        ))}
        {status.url && (
          <LinkRow label="open" value={status.url} onOpen={() => openUrl(status.url as string)} />
        )}
        {status.runs?.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color={colors.heading}>Recent </Text>
              <HistoryStrip runs={status.runs.slice(0, 20)} cols={Math.max(8, detailWidth - 8)} />
            </Text>
            {status.runs.slice(0, 6).map((run) => (
              <LinkRow
                key={run.id}
                label={RUN_ICON[run.state]}
                labelWidth={2}
                value={`${run.label} · ${ago(run.at)}${run.durationMs ? ` · ${minutes(run.durationMs)}` : ''}${run.detail ? ` · ${run.detail}` : ''}`}
                color={run.state === 'failure' ? colors.error : colors.muted}
                onOpen={run.url ? () => openUrl(run.url as string) : undefined}
              />
            ))}
          </Box>
        ) : null}
        <Text> </Text>
        {renderPlan(plans[entry.step.id])}
      </Box>
    );
  };

  return (
    <Box ref={rootRef} flexDirection="column" flexGrow={1} overflow="hidden">
      <Box ref={chipsRef} flexShrink={0} flexDirection="row">
        {prompt.line ?? (
          <>
            <ChipRow
              label="env"
              hotkey="e"
              compact
              chips={envChips}
              onToggle={(id) => data.setEnv(id)}
              onHover={(chip) => {
                if (chip?.tooltip) notify(chip.tooltip, 'info');
              }}
            />
            <Text color={colors.muted} wrap="truncate">
              {data.branch !== data.current && data.current
                ? ` checkout is on ${data.current} · [B] back to it`
                : ''}
            </Text>
          </>
        )}
      </Box>
      <Box flexDirection={sideBySide ? 'row' : 'column'} flexGrow={1} overflow="hidden">
        <Box width={graphPaneWidth} flexShrink={0} flexDirection="column">
          <Panel
            title={`${data.branch ?? '(no branch)'} → ${data.targetEnv}${data.loading ? ' …' : ''}`}
            color={colors.muted}
            width="100%"
            grow
          >
            {data.chain.length ? (
              <ChainGraph
                chain={data.chain}
                width={graphWidth}
                rows={graphRows}
                selectedId={selected?.step.id}
                labelOf={(entry) => fill(entry.step.label)}
                onSelect={select}
              />
            ) : (
              <Text color={colors.muted}>
                {data.loading
                  ? 'Reading the chain…'
                  : 'No steps — add a pipeline to depli.config.ts'}
              </Text>
            )}
          </Panel>
        </Box>
        <Panel
          title={logsOpen && selected ? `Logs — ${fill(selected.step.label)}` : 'Step'}
          color={logsOpen ? colors.accent : colors.muted}
          grow
          width={sideBySide ? undefined : appWidth}
        >
          {selected && logsOpen && logRun ? (
            <LogPanel
              run={logRun}
              runKey={`${selected.step.id}:${logRun.id}`}
              read={readSelectedLog}
              rows={sideBySide ? contentRows - 1 : Math.max(4, contentRows - graphRows - 3)}
              width={detailWidth}
              runIndex={runIndex}
              runCount={runs.length}
              onOtherRun={(delta) =>
                setRunPick((was) => ({
                  ...was,
                  [selected.step.id]: Math.max(0, Math.min(runs.length - 1, runIndex + delta)),
                }))
              }
              isActive={!prompt.isOpen && !pickerOpen}
            />
          ) : selected ? (
            detail(selected)
          ) : (
            <Text color={colors.muted}>Nothing selected.</Text>
          )}
        </Panel>
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <HintBar
          hints={[
            { key: '↑↓←→', label: 'move' },
            { key: 'Enter', label: 'dry run', onPress: () => selected && showPlan(selected) },
            { key: 'n', label: 'next', onPress: jumpToNext },
            { key: 'E', label: `env: ${data.targetEnv}`, onPress: openPicker },
            { key: 'b', label: 'branch', onPress: onPickBranch },
            {
              key: 'l',
              label: logsOpen ? 'step' : 'logs',
              onPress: () =>
                selected && setLogChoice((was) => ({ ...was, [selected.step.id]: !logsOpen })),
            },
          ]}
        />
      </Box>
      {pickerOpen && (
        <Popover anchorRef={chipsRef} containerRef={rootRef} width={28}>
          <PickList
            title="Environment"
            items={envIds.map((env) => ({
              id: env,
              label: env,
              hint: protectedEnvs.includes(env)
                ? 'protected'
                : env === data.targetEnv
                  ? 'current'
                  : undefined,
              hintColor: protectedEnvs.includes(env) ? colors.error : colors.muted,
              value: env,
            }))}
            selected={picking ?? 0}
            visibleRows={Math.min(envIds.length, 8)}
            onSelect={setPicking}
            onActivate={(index) => {
              const env = envIds[index];
              if (env) data.setEnv(env);
              setPicking(undefined);
            }}
          />
        </Popover>
      )}
      {confirming && (
        <Popover anchorRef={chipsRef} containerRef={rootRef} width="container">
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={confirming.protected ? colors.error : colors.accent}
            paddingX={1}
          >
            <Text color={colors.heading}>About to send — read it</Text>
            <Text color={colors.text} wrap="truncate-middle">
              {confirming.plan.method} {confirming.plan.url}
            </Text>
            {Object.entries(confirming.plan.params).map(([key, value]) => (
              <Text key={key} color={colors.muted} wrap="truncate-end">
                {' '}
                {key}={value}
              </Text>
            ))}
            {(confirming.plan.warnings ?? []).map((warning) => (
              <Text key={warning} color={colors.warn} wrap="wrap">
                ! {warning}
              </Text>
            ))}
          </Box>
        </Popover>
      )}
    </Box>
  );
};

export default ChainView;
