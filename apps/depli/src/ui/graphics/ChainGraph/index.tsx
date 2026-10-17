import { type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { type ChainStep, STATE_ICON } from '../../../core/chain';
import { borderRow, busRow, type GraphNode, layoutGraph } from '../../../core/graph';
import type { StepState } from '../../../core/plugin';

export const ago = (at?: number) => {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

/** Rows a graph of these levels takes with boxes `boxRows` tall: boxes plus one bus between levels. */
const heightFor = (levels: number, boxRows: number) => levels * boxRows + Math.max(0, levels - 1);

const clip = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);

/** A content line inside a box: its two side borders around whatever it holds. */
const Row = ({ side, border, children }: { side: string; border: string; children: ReactNode }) => (
  <Text wrap="truncate">
    <Text color={border}>{side} </Text>
    {children}
    <Text color={border}> {side}</Text>
  </Text>
);

interface NodeProps {
  entry: ChainStep;
  node: GraphNode;
  label: string;
  selected: boolean;
  /** A connector arrives from above / leaves below — a tee in that border. */
  joinTop: boolean;
  joinBottom: boolean;
  compact: boolean;
  onClick: () => void;
}

/** One step as a box: what it is, and when it last did its job — the time stands out. */
const Node = ({
  entry,
  node,
  label,
  selected,
  joinTop,
  joinBottom,
  compact,
  onClick,
}: NodeProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick });
  const { status } = entry;
  const tone = (state: StepState) =>
    state === 'done'
      ? colors.ok
      : state === 'running'
        ? colors.accent
        : state === 'stale' || state === 'none' || state === 'blocked'
          ? colors.warn
          : colors.error;
  const border = selected ? colors.accent : isHovered ? colors.highlight : tone(status.state);
  const tee = node.center - node.x;
  const [side, line] = selected ? ['║', '═'] : ['│', '─'];
  const top = borderRow(
    node.width,
    selected ? ['╔', '╗'] : ['╭', '╮'],
    line,
    joinTop ? (selected ? '╧' : '┴') : undefined,
    tee,
  );
  const bottom = borderRow(
    node.width,
    selected ? ['╚', '╝'] : ['╰', '╯'],
    line,
    joinBottom ? (selected ? '╤' : '┬') : undefined,
    tee,
  );
  const inner = node.width - 4;

  const ref_ = status.ref;
  const what =
    ref_?.buildNumber !== undefined
      ? `#${ref_.buildNumber}`
      : ref_?.sha
        ? ref_.sha.slice(0, 7)
        : status.state === 'none'
          ? 'never run'
          : status.state;
  const when = ago(ref_?.finishedAt);
  const marker = entry.recommended ? ' ← next' : entry.protected ? ' !' : '';
  const title = `${STATE_ICON[status.state]} ${label}`;
  //? One line: the time when there is one, else what it is (never run…), then the marker
  const full = ` ${when || what}${marker}`;
  //? A narrow box (parallel steps) keeps its label: the tail shrinks first
  const tail =
    inner - full.length >= Math.min(label.length + 2, 14)
      ? full
      : ` ${when ? when.replace(' ago', '') : '–'}${entry.recommended ? ' ←' : ''}`;

  return (
    <Box ref={ref} flexDirection="column" width={node.width} flexShrink={0}>
      <Text color={border} wrap="truncate">
        {top}
      </Text>
      {compact ? (
        <Row side={side} border={border}>
          <Text color={colors.text} bold={selected}>
            {clip(title, Math.max(1, inner - tail.length))}
          </Text>
          <Text color={when ? colors.accent : colors.muted} bold={Boolean(when)}>
            {tail}
          </Text>
        </Row>
      ) : (
        <>
          <Row side={side} border={border}>
            <Text color={colors.text} bold={selected}>
              {clip(title, inner)}
            </Text>
          </Row>
          <Row side={side} border={border}>
            <Text color={colors.muted}>{what}</Text>
            <Text color={when ? colors.accent : colors.muted} bold>
              {when ? ` · ${when}` : ''}
            </Text>
            <Text color={entry.recommended ? colors.accent : colors.error}>{marker}</Text>
            <Text>
              {' '.repeat(
                Math.max(0, inner - what.length - (when ? when.length + 3 : 0) - marker.length),
              )}
            </Text>
          </Row>
        </>
      )}
      <Text color={border} wrap="truncate">
        {bottom}
      </Text>
    </Box>
  );
};

export interface ChainGraphProps {
  chain: ChainStep[];
  /** Cells across and rows down the graph may take. */
  width: number;
  rows: number;
  selectedId?: string;
  /** The label shown in each box — the step's label with `{env}` filled in. */
  labelOf: (entry: ChainStep) => string;
  onSelect: (id: string) => void;
}

/**
 * The chain as the graph it is, top to bottom: one row of boxes per level, steps that wait on
 * the same steps side by side — they can run in parallel — and connectors that fan out and back
 * in between levels. Drawn in characters and theme colours, so it sits on the app's own
 * background in every terminal. Boxes are clickable; the view moves the selection with arrows.
 */
export const ChainGraph = ({
  chain,
  width,
  rows,
  selectedId,
  labelOf,
  onSelect,
}: ChainGraphProps) => {
  const colors = useColors();
  const levels = layoutGraph(
    chain.map((entry) => ({ id: entry.step.id, after: entry.step.after })),
    width,
  );
  const compact = heightFor(levels.length, 4) > rows;
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));

  return (
    <Box flexDirection="column" flexShrink={0}>
      {levels.map((level, index) => {
        const next = levels[index + 1];
        return (
          <Box key={level.nodes.map((node) => node.id).join('+')} flexDirection="column">
            <Box flexDirection="row">
              {level.nodes.map((node, at) => {
                const entry = byId.get(node.id);
                if (!entry) return null;
                return (
                  <Box key={node.id} marginLeft={at === 0 ? node.x : 1} flexShrink={0}>
                    <Node
                      entry={entry}
                      node={node}
                      label={labelOf(entry)}
                      selected={node.id === selectedId}
                      joinTop={index > 0}
                      joinBottom={Boolean(next)}
                      compact={compact}
                      onClick={() => onSelect(node.id)}
                    />
                  </Box>
                );
              })}
            </Box>
            {next && (
              <Text color={colors.muted} wrap="truncate">
                {busRow(
                  level.nodes.map((node) => node.center),
                  next.nodes.map((node) => node.center),
                  width,
                )}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default ChainGraph;
