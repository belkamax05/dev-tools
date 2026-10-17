import { STATE_ICON } from '../../../core/chain';
import type { EnvCell, EnvRow } from '../../../core/matrix';
import type { DepliData } from '../../useDepli';

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
const behind = (cell: EnvCell, chain: DepliData['chain']) => {
  const versions = (cell.step.versions ?? {}) as Record<string, string>;
  return Object.entries(versions).some(([param, stepId]) => {
    const deployed = Number(trailing(cell.latest.versions?.[param] ?? ''));
    const built = chain.find((entry) => entry.step.id === stepId)?.status.ref?.buildNumber;
    return Boolean(deployed && built && deployed < built);
  });
};

export interface EnvLine {
  /** What the env runs: deploy state, branch, build numbers, age, then the other steps' ages. */
  text: string;
  /** It runs the branch shown… */
  mine: boolean;
  /** …but older builds than the branch has now. */
  stale: boolean;
}

/**
 * One env as one line — "where is my branch deployed?" at a glance: the deploy's branch and
 * build numbers and how long ago, then every other env-scoped step's age. `width` pads the name.
 */
export const envLine = (
  row: EnvRow,
  data: Pick<DepliData, 'branch' | 'chain'>,
  width = row.env.length,
): EnvLine => {
  const deploy = row.cells.find((cell) => cell.latest.branch !== undefined) ?? row.cells[0];
  const mine = deploy?.latest.branch === data.branch;
  const stale = Boolean(mine && deploy && behind(deploy, data.chain));
  const versions = Object.values(deploy?.latest.versions ?? {})
    .map((value) => `#${trailing(value) ?? '?'}`)
    .join(' ');
  const others = row.cells
    .filter((cell) => cell !== deploy)
    .map((cell) => `${cell.step.id} ${age(cell.latest.at)}`)
    .join(' · ');
  return {
    text: `${STATE_ICON[deploy?.latest.state ?? 'none']} ${row.env.padEnd(width)}  ${(deploy?.latest.branch ?? deploy?.latest.summary ?? '').padEnd(24).slice(0, 24)} ${versions.padEnd(12)} ${age(deploy?.latest.at).padStart(4)}${others ? `  ${others}` : ''}`,
    mine,
    stale,
  };
};
