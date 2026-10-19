import { type DOMElement, Text } from 'ink';
import { type ReactNode, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import { bestTechnique, graphicsSupport } from '@/dev-tools/terminal-canvas';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { mix, parseColor, toHex } from '@/dev-tools/ui/theme';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { type ChainStep, STATE_ICON } from '../../../core/chain';
import { borderRow, busRow, type GraphNode, layoutGraph } from '../../../core/graph';
import type { StepState } from '../../../core/plugin';
import ProviderLogo, { hasProviderLogo } from '../ProviderLogo';
import { progressColumns, staleColumns } from './progress';
import { connectorOwner } from './connectors';
import ProgressMarker from '../ProgressMarker';

import StatusIcon, {
  badgeColor,
  StatusText,
  TRIGGER_ICON,
  TRIGGER_LABEL,
  type TriggerBadge,
} from '../StatusIcon';
import JobFrame, { supportsJobFrame } from '../JobFrame';
export { type TriggerBadge, TRIGGER_ICON } from '../StatusIcon';

const stateColor = (state: StepState, colors: ReturnType<typeof useColors>) =>
  state === 'done'
    ? colors.ok
    : state === 'running'
      ? colors.accent
      : state === 'stale' || state === 'none' || state === 'blocked'
        ? colors.warn
        : colors.error;

export const ago = (at?: number) => {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

/** Rows a graph of these levels takes with boxes `boxRows` tall: boxes plus one bus between levels. */
const heightFor = (levels: number, boxRows: number) => levels * boxRows + Math.max(0, levels - 1);

const clip = (text: string, width: number) => {
  const chars = Array.from(text);
  return chars.length > width
    ? `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
    : text + ' '.repeat(Math.max(0, width - chars.length));
};

/** A content line inside a box: its two side borders around whatever it holds. */
const Row = ({
  side,
  border,
  background,
  children,
}: {
  side: string;
  border: string;
  background?: string;
  children: ReactNode;
}) => (
  <Text wrap="truncate">
    <Text color={border} bold={side === '║'}>
      {side}
    </Text>
    <Text backgroundColor={background}> {children} </Text>
    <Text color={border} bold={side === '║'}>
      {side}
    </Text>
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
  provider: { id: string; label: string };
  triggerBadge?: TriggerBadge;
  overlayId: number;
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
  provider,
  triggerBadge,
  overlayId,
}: NodeProps) => {
  const colors = useColors();
  const [logoReady, setLogoReady] = useState(false);
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick });
  const { status } = entry;
  const border = stateColor(status.state, colors);
  const base = parseColor(colors.page) ?? parseColor(colors.surface);
  const foreground = parseColor(border);
  const pixelFrame = selected && supportsJobFrame();
  const tint =
    selected && !pixelFrame && !graphicsSupport().imagesInCells && base && foreground
      ? toHex(mix(base, foreground, 0.1))
      : undefined;
  const tee = node.center - node.x;
  const [side, line] = pixelFrame ? [' ', ' '] : selected ? ['║', '═'] : ['│', '─'];
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
  const logo = inner >= 12 && hasProviderLogo(provider.id);
  const providerWidth = inner - (logo ? 5 : 0);
  //? Up to date but its trigger is refused: it cannot run again, yet its result is fresh and
  //? usable by the steps after it — so it shows both, Complete first
  const completeButBlocked = status.state === 'done' && triggerBadge === 'blocked';
  //? Done, but behind a stale step before it: Complete stays (and the green outline), Stale joins
  const completeButStale = status.state === 'done' && Boolean(entry.behind);
  //? Armed, a step waiting on the one before it shows Auto — and still says it is blocked
  const autoBlocked = status.state === 'blocked' && triggerBadge === 'auto';
  const badge =
    status.state === 'blocked' && !autoBlocked
      ? 'blocked'
      : completeButBlocked || completeButStale
        ? 'complete'
        : (triggerBadge ??
          (status.state === 'none'
            ? 'neverrun'
            : status.state === 'done'
              ? 'complete'
              : status.state));
  const statusLabel =
    completeButBlocked || completeButStale
      ? [
          TRIGGER_LABEL.complete,
          completeButStale && `${TRIGGER_ICON.stale} ${TRIGGER_LABEL.stale}`,
          completeButBlocked && `${TRIGGER_ICON.blocked} ${TRIGGER_LABEL.blocked}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : autoBlocked
        ? `${TRIGGER_LABEL.auto} · ${TRIGGER_ICON.blocked} ${TRIGGER_LABEL.blocked}`
        : TRIGGER_LABEL[badge];
  const providerText = `${badge ? '    ' : ''}${statusLabel}${status.state === 'stale' && statusLabel !== 'Stale' ? ' · ↻ Stale' : ''}${logo && logoReady ? '' : ` · ${provider.label}`}`;

  const ref_ = status.ref;
  //? Running: the build in progress, not the last good one `ref` points at
  const live =
    status.state === 'running'
      ? (status.runs?.find((run) => run.state === 'running') ??
        status.runs?.find((run) => run.state === 'queued'))
      : undefined;
  const liveAge = live?.at ? ago(live.at).replace(' ago', '') : '';
  //? A numbered build (Jenkins) by its number; a commit whose checks run (GitHub) by its sha
  const runningWhat = live?.label.startsWith('#')
    ? live.label
    : ref_?.sha
      ? ref_.sha.slice(0, 7)
      : `${TRIGGER_ICON.running} ${TRIGGER_LABEL.running}`;
  const what =
    status.state === 'running'
      ? runningWhat
      : ref_?.buildNumber !== undefined
        ? `#${ref_.buildNumber}`
        : ref_?.sha
          ? ref_.sha.slice(0, 7)
          : status.state === 'none'
            ? '○ Never run'
            : status.state === 'blocked'
              ? '⊘ Blocked'
              : `${TRIGGER_ICON[status.state === 'done' ? 'complete' : status.state]} ${TRIGGER_LABEL[status.state === 'done' ? 'complete' : status.state]}`;
  const when = live
    ? live.state === 'queued'
      ? 'queued'
      : `running${liveAge ? ` ${liveAge}` : ''}`
    : status.state === 'running'
      ? ''
      : ago(ref_?.finishedAt);
  const marker = entry.recommended ? ' · ➜ Next' : entry.protected ? ' !' : '';
  const title = `${STATE_ICON[status.state]} ${label}`;
  //? One line: the time when there is one, else what it is (never run…), then the marker
  const full = ` ${live ? `${what} · ${when}` : when || what}${marker}`;
  //? A narrow box (parallel steps) keeps its label: the tail shrinks first
  const tail =
    providerWidth - full.length >= Math.min(label.length + 2, 14)
      ? full
      : ` ${live ? what : when ? when.replace(' ago', '') : '–'}${entry.recommended ? ' ➜ Next' : ''}`;

  return (
    <Box ref={ref} flexDirection="column" width={node.width} flexShrink={0}>
      <Text color={border} bold={selected || isHovered} wrap="truncate">
        {pixelFrame ? ' '.repeat(node.width) : top}
      </Text>
      {compact ? (
        <Row side={side} border={border} background={tint}>
          <Text color={colors.text} bold={selected || isHovered}>
            {clip(title, Math.max(1, providerWidth - tail.length))}
          </Text>
          <Text color={when ? colors.accent : colors.muted} bold={Boolean(when)}>
            <StatusText text={tail} />
          </Text>
          {logo && <Text>{' '.repeat(5)}</Text>}
        </Row>
      ) : (
        <>
          <Row side={side} border={border} background={tint}>
            <Text color={colors.text} bold={selected}>
              {clip(title, providerWidth)}
            </Text>
            {logo && <Text>{' '.repeat(5)}</Text>}
          </Row>
          <Row side={side} border={border} background={tint}>
            <Text color={when ? colors.accent : colors.muted} bold={Boolean(when)}>
              <StatusText
                text={clip(`${what}${when ? ` · ${when}` : ''}${marker}`, providerWidth)}
              />
            </Text>
            {logo && <Text>{' '.repeat(5)}</Text>}
          </Row>
        </>
      )}
      <Row side={side} border={border} background={tint}>
        <Text
          color={
            badge
              ? badgeColor(badge, colors)
              : status.state === 'stale'
                ? colors.warn
                : colors.muted
          }
        >
          <StatusText text={clip(providerText, providerWidth)} />
        </Text>
        {logo && <Text>{' '.repeat(5)}</Text>}
      </Row>
      {pixelFrame && (
        <JobFrame
          target={ref}
          color={border}
          opacity={0.1}
          overlayId={overlayId + 0x5000}
          tee={tee}
          joinTop={joinTop}
          joinBottom={joinBottom}
        />
      )}
      {badge && (
        <Box position="absolute" left={2} bottom={1} width={3} height={1} backgroundColor={tint}>
          <StatusIcon status={badge} overlayId={overlayId + 0x3000} />
        </Box>
      )}
      {logo && (
        <Box position="absolute" right={2} bottom={1} width={4} height={2} backgroundColor={tint}>
          <ProviderLogo
            provider={provider.id}
            overlayId={overlayId}
            rows={2}
            onReady={setLogoReady}
          />
        </Box>
      )}
      <Text color={border} wrap="truncate">
        {pixelFrame ? ' '.repeat(node.width) : bottom}
      </Text>
    </Box>
  );
};

/** Rows a level's connector takes: the bus, plus a stem row either side when it holds markers. */
const connectorRows = (chain: ChainStep[], above: GraphNode[], below: GraphNode[]) =>
  progressColumns(chain, above, below).length || staleColumns(chain, above, below).length ? 3 : 1;

/** The levels, whether the boxes go one line tall to fit `rows`, and the row each level starts at. */
const graphLayout = (chain: ChainStep[], width: number, rows: number) => {
  const levels = layoutGraph(
    chain.map((entry) => ({ id: entry.step.id, after: entry.step.after })),
    width,
  );
  const progressRows = levels.reduce((count, level, index) => {
    const next = levels[index + 1];
    return count + (next ? connectorRows(chain, level.nodes, next.nodes) - 1 : 0);
  }, 0);
  const compact = heightFor(levels.length, 5) + progressRows > rows;
  const tops: number[] = [];
  levels.reduce((top, level, index) => {
    tops.push(top);
    const next = levels[index + 1];
    return top + (compact ? 3 : 5) + (next ? connectorRows(chain, level.nodes, next.nodes) : 0);
  }, 0);
  return { levels, compact, tops };
};

/** The row the selected step's level starts at — where a scrolled graph keeps it in view. */
export const selectedRow = (chain: ChainStep[], width: number, rows: number, selectedId?: string) => {
  const { levels, tops } = graphLayout(chain, width, rows);
  const index = levels.findIndex((level) => level.nodes.some((node) => node.id === selectedId));
  return index < 0 ? 0 : (tops[index] ?? 0);
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
  providerOf: (entry: ChainStep) => { id: string; label: string };
  triggerBadgeOf: (entry: ChainStep) => TriggerBadge | undefined;
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
  providerOf,
  triggerBadgeOf,
}: ChainGraphProps) => {
  const colors = useColors();
  const { levels, compact } = graphLayout(chain, width, rows);
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));
  const rasterProgress = bestTechnique(graphicsSupport()).kind === 'raster';

  const nodeColor = (node: GraphNode) => {
    const entry = byId.get(node.id);
    return entry ? stateColor(entry.status.state, colors) : colors.muted;
  };
  const renderStems = (nodes: GraphNode[]) => (
    <Text wrap="truncate">
      {Array.from({ length: width }, (_, column) => {
        const node = nodes.find((item) => item.center === column);
        return (
          <Text key={column} color={node ? nodeColor(node) : colors.muted}>
            {node ? '│' : ' '}
          </Text>
        );
      })}
    </Text>
  );
  const connectorColor = (
    column: number,
    above: GraphNode[],
    below: GraphNode[],
    progress: Iterable<number>,
  ) => {
    const owner = connectorOwner(column, above, below, progress);
    return owner ? nodeColor(owner) : colors.muted;
  };

  return (
    <Box flexDirection="column" flexShrink={0}>
      {levels.map((level, index) => {
        const next = levels[index + 1];
        const progress = new Set(next ? progressColumns(chain, level.nodes, next.nodes) : []);
        //? Orange where a step that is behind meets a done one below it; green wins a shared cell
        const stale = new Set(
          next
            ? staleColumns(chain, level.nodes, next.nodes).filter((column) => !progress.has(column))
            : [],
        );
        const markers = progress.size + stale.size;
        const connector = next
          ? busRow(
              level.nodes.map((node) => node.center),
              next.nodes.map((node) => node.center),
              width,
            )
          : '';
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
                      provider={providerOf(entry)}
                      triggerBadge={triggerBadgeOf(entry)}
                      overlayId={0x6000 + chain.indexOf(entry)}
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
              <Box height={markers ? 3 : 1} flexDirection="column" flexShrink={0}>
                {markers > 0 && renderStems(level.nodes)}
                <Box height={1} flexShrink={0}>
                  <Text color={colors.muted} wrap="truncate">
                    {Array.from(connector).map((cell, column) =>
                      progress.has(column) ? (
                        <Text key={column} color={colors.ok} bold>
                          {rasterProgress ? ' ' : '●'}
                        </Text>
                      ) : stale.has(column) ? (
                        <Text key={column} color={colors.warn} bold>
                          {rasterProgress ? ' ' : '●'}
                        </Text>
                      ) : (
                        <Text
                          key={column}
                          color={connectorColor(column, level.nodes, next.nodes, progress)}
                        >
                          {cell}
                        </Text>
                      ),
                    )}
                  </Text>
                  {rasterProgress &&
                    [...progress].map((column) => (
                      <Box
                        key={column}
                        position="absolute"
                        left={column - 1}
                        top={0}
                        width={3}
                        height={1}
                      >
                        <ProgressMarker overlayId={0x7000 + index * width + column} />
                      </Box>
                    ))}
                  {rasterProgress &&
                    [...stale].map((column) => (
                      <Box
                        key={`stale:${column}`}
                        position="absolute"
                        left={column - 1}
                        top={0}
                        width={3}
                        height={1}
                      >
                        <ProgressMarker
                          overlayId={0x7000 + index * width + column}
                          color={colors.warn}
                        />
                      </Box>
                    ))}
                </Box>
                {markers > 0 && renderStems(next.nodes)}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default ChainGraph;
