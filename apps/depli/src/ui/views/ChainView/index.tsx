import { type DOMElement, Text, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

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
import { fillTemplate, type PlanFix, type StepRun, type StepState } from '../../../core/plugin';
import type { PlannedTrigger } from '../../../core/trigger';
import Avatar from '../../graphics/Avatar';
import ChainGraph, { ago } from '../../graphics/ChainGraph';
import HistoryStrip from '../../graphics/HistoryStrip';
import LogPanel from '../LogPanel';
import StepPanel from '../StepPanel';
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

/**
 * A label and its value side by side, the value wrapping in its own column. Not one Text with
 * both in it: Ink re-wraps such a line badly on resize when the value is a long unbreakable
 * word (a branch name), leaving cells of the line above behind.
 */
const Field = ({ label, children }: { label: string; children: ReactNode }) => {
  const colors = useColors();
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={10} flexShrink={0}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Box flexShrink={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
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
  //? Plans are made for the selected step on their own, to know up front whether it can be
  //? triggered; the request itself is shown only once asked for (Enter, c, T)
  const [shownPlans, setShownPlans] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState(session.selected.chain);
  const [picking, setPicking] = useState<number | undefined>(undefined);
  const [confirming, setConfirming] = useState<PlannedTrigger>();
  //? A fix being confirmed: the red popover describing exactly what it changes
  const [fixing, setFixing] = useState<{ entry: ChainStep; fix: PlanFix }>();
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

  /** Plan a step (a dry run: reads only). `reveal` also shows the request in the detail. */
  const showPlan = (entry: ChainStep, reveal = true) => {
    if (reveal) setShownPlans((was) => ({ ...was, [entry.step.id]: true }));
    return data
      .plan(entry.step.id)
      .then((planned) => {
        setPlans((was) => ({ ...was, [entry.step.id]: planned }));
        return planned;
      })
      .catch((error: Error) => {
        setPlans((was) => ({ ...was, [entry.step.id]: error.message }));
        return undefined;
      });
  };

  // Plan every job for its graph badge; discard responses from an older branch/env/chain.
  // biome-ignore lint/correctness/useExhaustiveDependencies: data.chain identifies these inputs
  useEffect(() => {
    let live = true;
    for (const entry of data.chain) {
      if (!data.triggerable(entry)) continue;
      data
        .plan(entry.step.id)
        .then((planned) => {
          if (live) setPlans((was) => ({ ...was, [entry.step.id]: planned }));
        })
        .catch((error: Error) => {
          if (live) setPlans((was) => ({ ...was, [entry.step.id]: error.message }));
        });
    }
    return () => {
      live = false;
    };
  }, [data.chain]);

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

  /** The fixes the selected step's plan offers for what the target refuses. */
  const fixesOf = (entry: ChainStep): PlanFix[] => {
    const planned = plans[entry.step.id];
    return typeof planned === 'object' ? (planned.plan.fixes ?? []) : [];
  };

  /**
   * A fix (an edit on the target, shared by everyone): the red popover says exactly what changes,
   * and nothing is written until Apply (or Enter) is pressed. The step is planned
   * again afterwards, so the Trigger button shows whether it can now be sent.
   */
  const startFix = (entry: ChainStep, fix: PlanFix) => {
    if (typeof plans[entry.step.id] !== 'object') return;
    setFixing({ entry, fix });
  };

  /** The popover's Apply (or Enter): the change is made, the step planned again. */
  const applyFixing = () => {
    if (!fixing) return;
    const { entry, fix } = fixing;
    const planned = plans[entry.step.id];
    setFixing(undefined);
    if (typeof planned !== 'object') return;
    notify(`${fix.label}…`, 'info');
    data
      .applyFix(planned, fix.id)
      .then((done) => {
        notify(`${done} — check the plan, then trigger`, 'ok');
        showPlan(entry, false);
      })
      .catch((error: Error) => notify(`Not changed: ${error.message}`, 'error'));
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
      //? The fix popover owns the keyboard while open: Enter applies, Esc cancels, nothing else
      if (fixing) {
        if (key.return) applyFixing();
        else if (key.escape) setFixing(undefined);
        return;
      }
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
      //? The first fix of a refused step — still behind its own Apply confirmation
      else if (input === 'A' && triggersEnabled && selected) {
        const fix = fixesOf(selected)[0];
        if (fix) startFix(selected, fix);
      }
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

  const renderPlan = (planned: PlannedTrigger | string | undefined, shown: boolean) => {
    if (!planned || !shown)
      return <Text color={colors.muted}>[Enter] dry run · [c] copy as curl</Text>;
    if (typeof planned === 'string') return <Text color={colors.muted}>{planned}</Text>;
    return (
      <Box flexDirection="column">
        <Text color={colors.heading}>Dry run — not sent</Text>
        <Text color={colors.text} wrap="truncate-middle">
          {planned.plan.method} {planned.plan.url}
        </Text>
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

  /**
   * Whether the step can be triggered, known before T is pressed (its plan is made on selection):
   * still checking, blocked — with every reason — or ready.
   */
  const triggerState = (entry: ChainStep) => {
    const planned = plans[entry.step.id];
    if (!triggersEnabled)
      return { ready: false, reasons: ['triggers are off (triggers.enabled in depli.config.ts)'] };
    if (planned === undefined) return { ready: false, reasons: [], checking: true };
    if (typeof planned === 'string') return { ready: false, reasons: [planned] };
    return {
      ready: !planned.blockers.length,
      reasons: planned.blockers,
      //? The target itself would refuse it (not the gate) — what `blockedHelp` explains
      refused: Boolean(planned.plan.blockers?.length),
    };
  };

  /**
   * The Trigger button and, when it cannot be sent, why — in the warning colour, under it, so
   * what will happen is visible before any key is pressed. The step's `blockedHelp` (project
   * config: where the thing that blocks it is defined) follows the reasons.
   */
  const triggerButton = (entry: ChainStep) => {
    const { ready, reasons, checking, refused } = triggerState(entry);
    const planned = plans[entry.step.id];
    const help =
      typeof entry.step.blockedHelp === 'string' ? fill(entry.step.blockedHelp) : undefined;
    return (
      <Box flexDirection="column">
        <Box
          flexDirection="column"
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderRight={false}
          borderColor={ready ? colors.accent : colors.warn}
          paddingLeft={1}
          flexShrink={0}
        >
          {ready ? (
            <ActionButton
              hotkey="T"
              label="Trigger…"
              color={entry.protected ? colors.error : colors.accent}
              onPress={() => startTrigger(entry)}
            />
          ) : (
            <Text color={checking ? colors.muted : colors.warn} bold wrap="wrap">
              {checking ? 'Checking trigger…' : '⊘ Trigger blocked'}
            </Text>
          )}
          {!ready &&
            reasons.map((reason) => (
              <Text key={reason} color={colors.warn} wrap="wrap">
                ✗ {reason}
              </Text>
            ))}
          {refused && fixesOf(entry).length > 0 && (
            <Box marginTop={1}>
              <Text color={colors.heading}>Resolve before triggering:</Text>
            </Box>
          )}
          {refused &&
            fixesOf(entry).map((fix, index) => (
              <ActionButton
                key={fix.id}
                hotkey={index === 0 && triggersEnabled ? 'A' : undefined}
                label={`${fix.label}…`}
                color={colors.accent}
                disabled={!triggersEnabled}
                onPress={() => startFix(entry, fix)}
                onHover={(hovered) => {
                  if (hovered) notify(fix.detail, 'warn');
                }}
              />
            ))}
          {refused && fixesOf(entry).length > 0 && (
            <Text color={colors.muted} wrap="wrap">
              Updates shared job configuration. Review and apply, then trigger separately.
            </Text>
          )}
          {refused && help && (
            <Text color={colors.muted} wrap="wrap">
              {help}
            </Text>
          )}
        </Box>
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          {typeof planned === 'object' && Object.keys(planned.plan.params).length > 0 && (
            <Text color={colors.heading}>Parameters</Text>
          )}
          {typeof planned === 'object' &&
            Object.entries(planned.plan.params).map(([name, value]) => {
              const source = planned.plan.sources?.[name];
              const fromStep = source !== undefined && source !== 'branch';
              return (
                <Text key={name} wrap="wrap">
                  <Text color={colors.muted}>{name}=</Text>
                  <Text color={fromStep ? colors.accent : colors.text} bold={fromStep}>
                    {value}
                  </Text>
                  <Text color={colors.muted}> ← {source ?? 'config'}</Text>
                </Text>
              );
            })}
        </Box>
      </Box>
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
    //? A step that counts builds has a last good one; any other (a push) has a latest
    const whenLabel = status.ref?.buildNumber !== undefined ? 'last good' : 'latest';
    return (
      //? Never shrunk: the scroll viewport moves the complete detail vertically instead of
      //? Yoga squeezing its one-row boxes (the Trigger button) to nothing
      <Box flexDirection="column" flexShrink={0}>
        {data.triggerable(entry) && triggerButton(entry)}
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
            <Field label={whenLabel}>
              {finished ? (
                <Text wrap="wrap">
                  <Text color={colors.accent} bold>
                    {ago(finished)}
                  </Text>
                  <Text color={colors.text}>
                    {'  '}
                    {stamp(finished)}
                    {status.ref?.buildNumber !== undefined ? `  #${status.ref.buildNumber}` : ''}
                  </Text>
                </Text>
              ) : (
                <Text color={colors.warn} bold wrap="wrap">
                  never on this branch
                </Text>
              )}
            </Field>
            {status.actor && (
              <Field label="by">
                <Text wrap="wrap">
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
              </Field>
            )}
            <Text color={colors.text} wrap="wrap">
              {status.summary}
            </Text>
          </Box>
        </Box>
        {(status.outputs ?? []).map((output) => (
          <Field key={output.label} label="produces">
            <Text wrap="wrap">
              <Text color={colors.muted}>{output.label}: </Text>
              <Text color={colors.accent} bold>
                {output.value}
              </Text>
              {output.note && <Text color={colors.muted}> ({output.note})</Text>}
            </Text>
          </Field>
        ))}
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
        {renderPlan(plans[entry.step.id], Boolean(shownPlans[entry.step.id]))}
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
                providerOf={data.providerOf}
                triggerBadgeOf={(entry) => {
                  if (!data.triggerable(entry)) return 'readonly';
                  const state = triggerState(entry);
                  if (state.checking) return 'checking';
                  if (!state.ready) return 'blocked';
                  return entry.recommended ? 'next' : undefined;
                }}
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
            <StepPanel
              key={`${selected.step.id}:${data.branch}:${data.targetEnv}`}
              isActive={!prompt.isOpen && !pickerOpen && !fixing}
            >
              {detail(selected)}
            </StepPanel>
          ) : (
            <Text color={colors.muted}>Nothing selected.</Text>
          )}
        </Panel>
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <HintBar
          hints={[
            { key: '↑↓←→', label: 'move' },
            ...(logsOpen
              ? [
                  { key: 'j/k · wheel', label: 'scroll' },
                  { key: 'Space/PgUp', label: 'page' },
                  { key: 'g/G', label: 'top / follow' },
                ]
              : [
                  { key: 'j/k · wheel', label: 'scroll step' },
                  { key: 'PgUp/PgDn', label: 'page' },
                  { key: 'g/G', label: 'top / bottom' },
                ]),
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
      {fixing && (
        <Popover anchorRef={chipsRef} containerRef={rootRef} width="container">
          <Box flexDirection="column" borderStyle="round" borderColor={colors.error} paddingX={1}>
            <Text color={colors.error} bold>
              {fixing.fix.label} — edits shared config, for everyone
            </Text>
            <Text color={colors.text} wrap="wrap">
              {fixing.fix.detail}
            </Text>
            <Box flexDirection="row" marginTop={1}>
              <ActionButton
                hotkey="Enter"
                label="Apply"
                color={colors.error}
                onPress={applyFixing}
              />
              <ActionButton hotkey="Esc" label="Cancel" onPress={() => setFixing(undefined)} />
            </Box>
          </Box>
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
