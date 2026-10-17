import { Text } from 'ink';
import { useEffect } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { STATE_ICON } from '../../../core/chain';
import type { EnvCell, EnvRow } from '../../../core/matrix';
import { fillTemplate } from '../../../core/plugin';
import type { Session } from '../../types';
import type { DepliData } from '../../useDepli';

export interface EnvsViewProps {
  data: DepliData;
  session: Session;
  /** A row was picked: show that env's chain. */
  onOpenEnv: (env: string) => void;
}

const trailing = (value: string) => value.match(/\.(\d+)$/)?.[1];

const age = (at?: number) => {
  if (!at) return '';
  const hours = (Date.now() - at) / 3_600_000;
  return hours < 1
    ? `${Math.round(hours * 60)}m`
    : hours < 48
      ? `${Math.round(hours)}h`
      : `${Math.round(hours / 24)}d`;
};

/**
 * Behind the selected branch's latest builds: a cell whose version params end in older build
 * numbers than the chain's build steps have now.
 */
const behind = (cell: EnvCell, data: DepliData) => {
  const versions = (cell.step.versions ?? {}) as Record<string, string>;
  return Object.entries(versions).some(([param, stepId]) => {
    const deployed = Number(trailing(cell.latest.versions?.[param] ?? ''));
    const built = data.chain.find((entry) => entry.step.id === stepId)?.status.ref?.buildNumber;
    return Boolean(deployed && built && deployed < built);
  });
};

/**
 * Every env and what it runs now — "where is my branch deployed?" in one screen. A row running
 * the selected branch is highlighted, amber when that branch has newer builds than the env has.
 * Enter (or a click) opens the env's chain.
 */
export const EnvsView = ({ data, session, onOpenEnv }: EnvsViewProps) => {
  const colors = useColors();

  // biome-ignore lint/correctness/useExhaustiveDependencies: on arrival and when the branch moves
  useEffect(() => {
    data.loadEnvs();
  }, [data.branch, Object.keys(data.connections).length]);

  const rows = data.envs ?? [];
  const width = Math.max(4, ...rows.map((row) => row.env.length));
  const items: PickItem<EnvRow>[] = rows.map((row) => {
    const deploy = row.cells.find((cell) => cell.latest.branch !== undefined) ?? row.cells[0];
    const mine = deploy?.latest.branch === data.branch;
    const stale = Boolean(mine && deploy && behind(deploy, data));
    const versions = Object.values(deploy?.latest.versions ?? {})
      .map((value) => `#${trailing(value) ?? '?'}`)
      .join(' ');
    const others = row.cells
      .filter((cell) => cell !== deploy)
      .map((cell) => `${cell.step.id} ${age(cell.latest.at)}`)
      .join(' · ');
    return {
      id: row.env,
      label: `${STATE_ICON[deploy?.latest.state ?? 'none']} ${row.env.padEnd(width)}  ${(deploy?.latest.branch ?? deploy?.latest.summary ?? '').padEnd(24).slice(0, 24)} ${versions.padEnd(12)} ${age(deploy?.latest.at).padStart(4)}${others ? `  ${others}` : ''}`,
      hint: row.protected ? 'protected' : mine ? (stale ? 'behind' : 'yours') : undefined,
      hintColor: row.protected ? colors.error : stale ? colors.warn : colors.ok,
      value: row,
    };
  });

  return (
    <ListDetail
      title={`Environments — ${data.branch ?? '(no branch)'} highlighted`}
      items={items}
      emptyText={data.envs ? 'No envs in depli.config.ts' : 'Reading every env…'}
      detailTitle="Env"
      activateLabel="open its chain"
      initialSelectedId={session.selected.envs ?? data.targetEnv}
      onActivate={(item) => {
        if (item.value) onOpenEnv(item.value.env);
      }}
      onSelectionChange={(item) => {
        session.selected.envs = item?.id;
      }}
      renderDetail={(item) => {
        const row = item?.value;
        if (!row) return null;
        return (
          <Box flexDirection="column">
            <Text color={row.protected ? colors.error : colors.heading}>
              {row.env}
              {row.protected ? ' — protected' : ''}
            </Text>
            {row.cells.map((cell) => (
              <Box key={cell.step.id} flexDirection="column" marginTop={1}>
                <Text color={colors.text} wrap="truncate">
                  {STATE_ICON[cell.latest.state]}{' '}
                  {fillTemplate(cell.step.label, {
                    env: row.env,
                    branch: cell.latest.branch ?? '',
                  })}
                </Text>
                <Text color={colors.muted} wrap="wrap">
                  {cell.latest.summary}
                  {cell.latest.branch ? ` · ${cell.latest.branch}` : ''}
                  {cell.latest.at ? ` · ${age(cell.latest.at)} ago` : ''}
                </Text>
                {Object.entries(cell.latest.versions ?? {}).map(([param, value]) => (
                  <Text key={param} color={colors.muted} wrap="truncate-middle">
                    {'  '}
                    {param} {value}
                  </Text>
                ))}
                {cell.latest.url && (
                  <LinkRow
                    label="open"
                    value={cell.latest.url}
                    onOpen={() => openUrl(cell.latest.url as string)}
                  />
                )}
              </Box>
            ))}
          </Box>
        );
      }}
    />
  );
};

export default EnvsView;
