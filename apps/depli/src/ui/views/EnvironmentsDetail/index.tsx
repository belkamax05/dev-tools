import { type DOMElement, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useRef } from 'react';

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
import { detailDoc, jobFolds, type Section } from '../EnvironmentsView/lines';
import LinesPanel from '../EnvironmentsView/LinesPanel';
import useFolds from '../EnvironmentsView/useFolds';
import useLinesNav from '../EnvironmentsView/useLinesNav';

/** A section's name over the lines — a click scrolls to it. */
const SectionChip = ({
  section,
  current,
  onPress,
}: {
  section: Section;
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
        {` ${section.label} `}
      </Text>
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

/**
 * Every env in full, over the whole interface: the overview table, branches → envs as a graph,
 * then per env its job graph and every run of every job by day, then the shared builds with the
 * envs each one reached. Every build number and job is a link to its page.
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
  const width = Math.max(40, columns - app.horizontalMargin - 5);
  const configs = project.config.envs ?? [];

  const connected = connectionsKey(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the connections are the trigger
  useEffect(() => {
    if (!data.envs) data.loadEnvs();
    if (!data.history) data.loadHistory();
  }, [connected]);

  const folds = useFolds();
  const doc = useMemo(
    () =>
      detailDoc({
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
  const nav = useLinesNav(doc.lines);
  const current = [...doc.sections].reverse().find((section) => section.line <= nav.offset);
  const jump = (delta: number) => {
    const at = doc.sections.findIndex((section) => section.id === current?.id);
    const next = doc.sections[Math.max(0, Math.min(doc.sections.length - 1, at + delta))];
    if (next) nav.setOffset(next.line);
  };
  const open = (url: string | undefined) => {
    if (!url) return notify('Tab (or n) to a link first, or click one', 'info');
    openUrl(url);
    notify(`Opened ${url}`, 'ok');
  };
  //? On a fold, Enter opens or closes it; on a link, opens its page
  const activate = () =>
    nav.focusedAction ? folds.toggle(nav.focusedAction, nav.focusedOpen) : open(nav.focusedUrl);
  const { anyClosed } = jobFolds(doc.lines);
  const foldAll = () => folds.setAll(jobFolds(doc.lines).keys, anyClosed);
  const reread = () => {
    data.loadEnvs();
    data.loadHistory();
  };

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (input === 'q') exit();
    else if (key.tab) nav.stepLink(key.shift ? -1 : 1);
    else if (input === 'n') nav.stepLink(1);
    else if (input === 'p') nav.stepLink(-1);
    else if (key.return || input === 'o') activate();
    else if (input === 'x') foldAll();
    else if (input === ']') jump(1);
    else if (input === '[') jump(-1);
    else if (input === 'r') reread();
    else if (key.downArrow || input === 'j') nav.scrollBy(1);
    else if (key.upArrow || input === 'k') nav.scrollBy(-1);
    else if (key.pageDown || input === ' ' || (key.ctrl && input === 'd')) nav.page(1);
    else if (key.pageUp || (key.ctrl && input === 'u')) nav.page(-1);
    else if (input === 'g' || key.home) nav.top();
    else if (input === 'G' || key.end) nav.bottom();
  });

  const reading = data.historyLoading || !data.envs;
  return (
    <Box
      width={columns}
      height={Math.max(1, rows - app.heldBackRows)}
      backgroundColor={colors.page}
    >
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
        <Box flexShrink={0} flexDirection="row" overflow="hidden">
          {doc.sections.map((section) => (
            <SectionChip
              key={section.id}
              section={section}
              current={section.id === current?.id}
              onPress={() => nav.setOffset(section.line)}
            />
          ))}
        </Box>
        <LinesPanel
          lines={doc.lines}
          offset={nav.offset}
          onOffset={nav.setOffset}
          onRows={nav.setRows}
          focused={nav.focused}
          onOpen={open}
          onAction={folds.toggle}
        />
        {status && (
          <Box flexShrink={0}>
            <StatusNote text={status.text} tone={status.tone} />
          </Box>
        )}
        <HintBar
          width={width}
          maxRows={2}
          hints={[
            { key: 'Tab/n', label: 'next item', onPress: () => nav.stepLink(1) },
            { key: 'S-Tab/p', label: 'prev item', onPress: () => nav.stepLink(-1) },
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
            { key: '[/]', label: 'section', onPress: () => jump(1) },
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
