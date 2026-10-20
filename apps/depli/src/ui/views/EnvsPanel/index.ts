import type { EnvConfig } from '../../../config/project';
import { STATE_ICON } from '../../../core/chain';
import { onTrack, runningBranch } from '../../../core/history';
import type { EnvCell, EnvRow } from '../../../core/matrix';
import { age, shortStamp } from '../../../core/time';
import type { DepliData } from '../../useDepli';

const trailing = (value: string) => value.match(/\.(\d+)$/)?.[1];

const BRANCH_WIDTH = 24;
/** `17 Oct 06:51 44h25m ago` — the exact local time, then how long ago. */
const WHEN_WIDTH = 23;

const when = (at?: number) =>
  at ? `${shortStamp(at)} ${`${age(at, true)} ago`.padStart(10)}` : '—';

/** The cell that says what the env runs: the step that records a branch, else the first. */
const deployOf = (row: EnvRow) =>
  row.cells.find((cell) => cell.latest.branch !== undefined) ?? row.cells[0];

/** For each version param, the build number the chain's build step has now — when it has one. */
const builtFor = (cell: EnvCell, chain: DepliData['chain']) =>
  Object.fromEntries(
    Object.entries((cell.step.versions ?? {}) as Record<string, string>).map(([param, stepId]) => [
      param,
      chain.find((entry) => entry.step.id === stepId)?.status.ref?.buildNumber,
    ]),
  );

/** The version params' build steps, in config order — one BUILDS column each. */
const versionSteps = (cell?: EnvCell) =>
  Object.entries((cell?.step.versions ?? {}) as Record<string, string>);

export interface EnvLine {
  /** The row, laid out in the columns `envHeader` names. */
  text: string;
  /** The same without the state icon, env and padding — for one line beside the Env selector. */
  summary: string;
  /** It runs the branch shown… */
  mine: boolean;
  /**
   * …but older builds than the branch has now: its version params end in older build numbers
   * than the chain's build steps have.
   */
  stale: boolean;
}

/**
 * One env as one row — "where is my branch deployed?" at a glance: the deploy's branch, the build
 * numbers it runs (`#1020→1023` when the branch has a newer one), when it was deployed, then
 * when every other env-scoped step last ran. `width` pads the env name.
 */
export const envLine = (
  row: EnvRow,
  data: Pick<DepliData, 'branch' | 'chain'>,
  width = row.env.length,
): EnvLine => {
  const deploy = deployOf(row);
  const mine = deploy?.latest.branch === data.branch;
  const built = deploy ? builtFor(deploy, data.chain) : {};
  let stale = false;
  const builds = versionSteps(deploy).map(([param, stepId]) => {
    const deployed = trailing(deploy?.latest.versions?.[param] ?? '');
    const now = built[param];
    //? Only "behind" for the branch shown — another branch's numbers are not comparable
    const behind = mine && Boolean(deployed && now && Number(deployed) < now);
    if (behind) stale = true;
    return `#${deployed ?? '?'}${behind ? `→${now}` : ''}`.padEnd(Math.max(stepId.length, 11));
  });
  const branch = (deploy?.latest.branch ?? deploy?.latest.summary ?? '')
    .slice(0, BRANCH_WIDTH)
    .padEnd(BRANCH_WIDTH);
  const others = row.cells
    .filter((cell) => cell !== deploy)
    .map((cell) => when(cell.latest.at).padEnd(Math.max(cell.step.id.length, WHEN_WIDTH)));
  const columns = [branch, ...builds, when(deploy?.latest.at).padEnd(WHEN_WIDTH), ...others];
  return {
    text: `${STATE_ICON[deploy?.latest.state ?? 'none']} ${row.env.padEnd(width)}  ${columns.join('  ')}`.trimEnd(),
    summary: `${branch.trimEnd()} · ${builds.map((build) => build.trimEnd()).join(' ')} · deployed ${deploy?.latest.at ? `${shortStamp(deploy.latest.at)}, ${age(deploy.latest.at, true)} ago` : '—'}`,
    mine,
    stale,
  };
};

/** The column names over `envLine`'s rows, aligned with them (`row` gives the step columns). */
export const envHeader = (row: EnvRow | undefined, width: number, tagsWidth: number) => {
  const deploy = row && deployOf(row);
  const builds = versionSteps(deploy).map(([, stepId]) =>
    stepId.padEnd(Math.max(stepId.length, 11)),
  );
  const others = (row?.cells ?? [])
    .filter((cell) => cell !== deploy)
    .map((cell) => cell.step.id.padEnd(Math.max(cell.step.id.length, WHEN_WIDTH)));
  const columns = [
    'BRANCH ON IT'.padEnd(BRANCH_WIDTH),
    ...builds,
    `${deploy?.step.id ?? 'deploy'} (local time)`.padEnd(WHEN_WIDTH),
    ...others,
  ];
  //? Two cells for the list's cursor marker, then the STATUS prefix and the row's icon
  return `  ${'STATUS'.padEnd(tagsWidth)} ${'  ENV'.padEnd(width + 2)}  ${columns.join('  ')}`.trimEnd();
};

/** What the timezone is, e.g. `UTC+1` — said once, so a time is never read as GitHub's or UTC. */
const zone = () => {
  const offset = -new Date().getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return `UTC${offset < 0 ? '-' : '+'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
};

/** The line under the table: what the tags and the build columns mean. */
export const envLegend = () =>
  `behind = runs your branch, but older builds than it has now (#deployed→#latest) · yours = runs your branch at its latest builds · current = the env the chain shows · times in ${zone()}`;

/** The tags a row carries, in the order they are shown. */
export const envTags = (
  line: Pick<EnvLine, 'mine' | 'stale'>,
  flags: { protected: boolean; current: boolean },
) =>
  [
    flags.protected && 'protected',
    flags.current && 'current',
    line.mine && (line.stale ? 'behind' : 'yours'),
  ].filter((tag): tag is string => Boolean(tag));

const TRACKS_WIDTH = 18;

export interface EnvTableOptions {
  envIds: string[];
  protectedEnvs: string[];
  data: Pick<DepliData, 'branch' | 'chain' | 'envs' | 'targetEnv'>;
  colors: Record<'error' | 'warn' | 'accent' | 'ok', string>;
  /**
   * The envs' config — given, the table is the Environments window's extended one: a TRACKS
   * column (`envs[].branches`) and an `off-track` tag for an env running anything else.
   */
  configs?: readonly EnvConfig[];
}

/**
 * The environments table as `PickList` rows, with its column names: the Chain tab's env picker,
 * and — with `configs` — the Environments window's wider copy of it.
 */
export const envTable = ({ envIds, protectedEnvs, data, colors, configs }: EnvTableOptions) => {
  const envRows = new Map((data.envs ?? []).map((row) => [row.env, row]));
  const width = Math.max(4, ...envIds.map((env) => env.length));
  //? Every env as a row of the table: its tags (current, behind… — all that apply, so the
  //? current env still says it is behind) as a coloured first column, then what it runs
  const rows = envIds.map((env) => {
    const row = envRows.get(env);
    const line = row
      ? envLine(row, data, width)
      : { text: `… ${env.padEnd(width)}`, summary: '', mine: false, stale: false };
    const isProtected = protectedEnvs.includes(env);
    const config = configs?.find((entry) => entry.id === env);
    const offTrack = onTrack(config, runningBranch(row)) === false;
    const tags = [
      ...envTags(line, { protected: isProtected, current: env === data.targetEnv }),
      ...(offTrack ? ['off-track'] : []),
    ];
    const tracks = configs
      ? `  ${(config?.branches?.join(' ') ?? '—').slice(0, TRACKS_WIDTH).padEnd(TRACKS_WIDTH)}`
      : '';
    //? The extended table puts TRACKS right after the branch, where it is compared with it
    const label = configs ? withTracks(line.text, width, tracks) : line.text;
    return { env, line, label, isProtected, offTrack, tags: tags.join(' · ') };
  });
  const tagsWidth = Math.max(6, ...rows.map((entry) => entry.tags.length));
  const items = rows.map(({ env, line, label, isProtected, offTrack, tags }) => ({
    id: env,
    label,
    prefix: {
      text: tags.padEnd(tagsWidth),
      color: isProtected
        ? colors.error
        : line.stale || offTrack
          ? colors.warn
          : env === data.targetEnv
            ? colors.accent
            : colors.ok,
    },
    isCurrent: env === data.targetEnv,
    value: env,
  }));
  const plainHeader = envHeader(data.envs?.[0], width, tagsWidth);
  const header = configs
    ? withTracks(plainHeader, width + tagsWidth + 3, `  ${'TRACKS'.padEnd(TRACKS_WIDTH)}`)
    : plainHeader;
  return { items, header, width, tagsWidth, rows: envRows };
};

/** `text` with `column` inserted after the env name (`skip` cells) and the branch column. */
const withTracks = (text: string, skip: number, column: string) => {
  //? The icon and a space, the env, two spaces, then the branch column
  const at = Math.min(text.length, skip + 4 + BRANCH_WIDTH);
  return `${text.slice(0, at).padEnd(at)}${column}${text.slice(at)}`.trimEnd();
};
