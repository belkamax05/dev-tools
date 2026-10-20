/**
 * The Environments window's detail as lines of segments — pure, so it is tested without a
 * terminal. A segment with a `url` is a link (underlined, opens a page); one with an `action` is
 * a toggle (folds a job or a day of runs). Both are clickable and reachable from the keyboard.
 * Colours are theme roles, resolved when drawn.
 */
import type { EnvConfig } from '../../../config/project';
import { STATE_ICON } from '../../../core/chain';
import { borderRow, busRow, layoutGraph } from '../../../core/graph';
import {
  branchRelations,
  deployedBuilds,
  findRun,
  type History,
  onTrack,
  runningBranch,
  runsByDay,
  type StepHistory,
  versionNumber,
  versionsOf,
} from '../../../core/history';
import type { EnvCell, EnvRow } from '../../../core/matrix';
import {
  fillTemplate,
  type HistoryRun,
  type JobHistory,
  type StepConfig,
} from '../../../core/plugin';
import { age, shortStamp } from '../../../core/time';

export type Role = 'text' | 'muted' | 'accent' | 'ok' | 'warn' | 'error' | 'heading';

export interface Segment {
  text: string;
  role?: Role;
  bold?: boolean;
  url?: string;
  /** A fold to toggle — `job:…` or `day:…` — and whether it is open now. */
  action?: string;
  open?: boolean;
}

export type Line = Segment[];

/** Every link and toggle in reading order, with where it is — what the keyboard steps through. */
export const linksOf = (lines: readonly Line[]) =>
  lines.flatMap((line, at) =>
    line.flatMap((segment, index) =>
      segment.url || segment.action
        ? [
            {
              line: at,
              segment: index,
              url: segment.url,
              action: segment.action,
              open: segment.open,
            },
          ]
        : [],
    ),
  );

export const lineText = (line: Line) => line.map((segment) => segment.text).join('');

/** Whether a fold is open: what the person chose, else `byDefault`. */
export type IsOpen = (key: string, byDefault: boolean) => boolean;

const RUN_ICON: Record<HistoryRun['state'], string> = {
  success: '✓',
  failure: '✗',
  running: '◐',
  aborted: '⊘',
  queued: '…',
  other: '·',
};

const RUN_ROLE: Record<HistoryRun['state'], Role> = {
  success: 'ok',
  failure: 'error',
  running: 'accent',
  aborted: 'muted',
  queued: 'muted',
  other: 'muted',
};

/** Runs shown inside a job's box in the graph; the rest are in the runs below it. */
export const RUNS_IN_BOX = 3;

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (at?: number) => {
  if (!at) return '--:--';
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const duration = (ms?: number) => {
  if (ms === undefined) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${pad(seconds % 60)}s`;
};
const when = (at?: number) => (at ? `${shortStamp(at)} (${age(at)} ago)` : '—');

/** A line cut (with `…`) or padded to exactly `width` cells. */
export const fitLine = (line: Line, width: number): Line => {
  const out: Line = [];
  let used = 0;
  for (const segment of line) {
    const room = width - used;
    if (room <= 0) break;
    if (segment.text.length > room) {
      out.push({ ...segment, text: `${segment.text.slice(0, Math.max(0, room - 1))}…` });
      used = width;
      break;
    }
    out.push(segment);
    used += segment.text.length;
  }
  if (used < width) out.push({ text: ' '.repeat(width - used) });
  return out;
};

const heading = (text: string, width: number, url?: string): Line => [
  { text: '━━ ', role: 'accent' },
  { text, role: 'heading', bold: true, url },
  { text: ` ${'━'.repeat(Math.max(0, width - text.length - 4))}`, role: 'accent' },
];

const subheading = (text: string, note?: string): Line => [
  { text: `  ${text}`, role: 'heading', bold: true },
  ...(note ? [{ text: `  ${note}`, role: 'muted' } as Segment] : []),
];

/** `12 runs · 10 ✓ 2 ✗` — what a job's history adds up to. */
const tally = (runs: readonly HistoryRun[]) => {
  const ok = runs.filter((run) => run.state === 'success').length;
  const failed = runs.filter((run) => run.state === 'failure').length;
  const running = runs.filter((run) => run.state === 'running').length;
  return [
    `${runs.length} run${runs.length === 1 ? '' : 's'}`,
    [ok && `${ok} ✓`, failed && `${failed} ✗`, running && `${running} ◐`].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' · ');
};

// --- the job graph ------------------------------------------------------------------------------

export interface GraphNodeContent {
  title: string;
  /** What the box holds, one line each — cut to the box's width. */
  rows: Line[];
}

/**
 * Steps as a graph of boxes, top to bottom — `layoutGraph`'s levels, connectors fanning out and
 * back in — with each box's rows inside it.
 */
export const graphLines = (
  steps: readonly StepConfig[],
  contentOf: (step: StepConfig) => GraphNodeContent,
  width: number,
): Line[] => {
  const levels = layoutGraph(steps, width, 2);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const hasChildren = (id: string) => steps.some((step) => step.after?.includes(id));
  const lines: Line[] = [];
  levels.forEach((level, index) => {
    const nodes = level.nodes.map((node) => ({
      node,
      step: byId.get(node.id) as StepConfig,
      content: contentOf(byId.get(node.id) as StepConfig),
    }));
    const height = Math.max(...nodes.map((entry) => entry.content.rows.length));
    /** One row of the level: each node's piece at its column. */
    const row = (piece: (entry: (typeof nodes)[number]) => Segment[]): Line => {
      const line: Line = [];
      let column = 0;
      for (const entry of nodes) {
        if (entry.node.x > column) line.push({ text: ' '.repeat(entry.node.x - column) });
        line.push(...piece(entry));
        column = entry.node.x + entry.node.width;
      }
      return line;
    };
    const inner = (entry: (typeof nodes)[number]) => Math.max(1, entry.node.width - 4);
    const border = (corners: [string, string], tee: boolean) => (entry: (typeof nodes)[number]) => [
      {
        text: borderRow(
          entry.node.width,
          corners,
          '─',
          tee ? (corners[0] === '╭' ? '┴' : '┬') : undefined,
          entry.node.center - entry.node.x,
        ),
        role: 'muted' as const,
      },
    ];
    lines.push(row((entry) => border(['╭', '╮'], Boolean(entry.step.after?.length))(entry)));
    lines.push(
      row((entry) => [
        { text: '│ ', role: 'muted' },
        ...fitLine([{ text: entry.content.title, role: 'heading', bold: true }], inner(entry)),
        { text: ' │', role: 'muted' },
      ]),
    );
    for (let at = 0; at < height; at++)
      lines.push(
        row((entry) => [
          { text: '│ ', role: 'muted' },
          ...fitLine(entry.content.rows[at] ?? [], inner(entry)),
          { text: ' │', role: 'muted' },
        ]),
      );
    lines.push(row((entry) => border(['╰', '╯'], hasChildren(entry.node.id))(entry)));
    const next = levels[index + 1];
    if (next) {
      const above = level.nodes.filter((node) => hasChildren(node.id)).map((node) => node.center);
      const below = next.nodes
        .filter((node) => byId.get(node.id)?.after?.length)
        .map((node) => node.center);
      lines.push([{ text: busRow(above, below, width).trimEnd(), role: 'muted' }]);
    }
  });
  return lines;
};

export interface CompactOptions {
  /** The branch the dashboard shows — highlighted. */
  branch?: string;
  /** Leave the branch out — every run listed is of the same one. */
  hideBranch?: boolean;
  /** Said after the run, e.g. `◀ on uat3`. */
  marker?: string;
}

/** A run in a box: result, number (a link), when, the branch, who, what it says, a marker. */
export const compactRun = (run: HistoryRun, options: CompactOptions = {}): Line => [
  { text: `${RUN_ICON[run.state]} `, role: RUN_ROLE[run.state] },
  { text: run.label, role: 'accent', url: run.url },
  ...(options.marker ? [{ text: ` ${options.marker}`, role: 'ok', bold: true } as Segment] : []),
  { text: `  ${run.at ? shortStamp(run.at) : '—'}`, role: 'text' },
  { text: ` ${run.at ? `${age(run.at)} ago` : ''}`, role: 'muted' },
  ...(run.branch && !options.hideBranch
    ? [
        {
          text: `  ${run.branch}`,
          role: run.branch === options.branch ? 'accent' : 'text',
          bold: run.branch === options.branch,
        } as Segment,
      ]
    : []),
  ...(run.actor
    ? [{ text: `  ${run.actor.name ?? run.actor.login}`, role: 'muted' } as Segment]
    : []),
  ...(run.detail ? [{ text: `  ${run.detail}`, role: 'text' } as Segment] : []),
];

export interface BoxContext {
  env: string;
  branch: string;
  history?: History;
  /** The env's row: what each env step last put on it. */
  row?: EnvRow;
}

/** The cell of the env's row for this step, when the step acts on the env. */
const cellOf = (row: EnvRow | undefined, step: StepConfig): EnvCell | undefined =>
  row?.cells.find((cell) => cell.step.id === step.id);

/** For a build step: the build number the env's deploy runs, read from its version params. */
const deployedHere = (row: EnvRow | undefined, stepId: string) => {
  for (const cell of row?.cells ?? [])
    for (const [param, id] of Object.entries((cell.step.versions ?? {}) as Record<string, string>))
      if (id === stepId) return versionNumber(cell.latest.versions?.[param]);
  return undefined;
};

/** The run with this page among the jobs' runs, with its job. */
const runByUrl = (jobs: readonly JobHistory[], url?: string) => {
  if (!url) return undefined;
  for (const job of jobs) {
    const run = job.runs.find((candidate) => candidate.url === url);
    if (run) return { job, run };
  }
  return undefined;
};

/**
 * The commits the env runs: for every build its deploy names, that build's checkout — builds of
 * one commit together (`1a2b3c4d ← build-nginx #1008, build-nodejs #3257`).
 */
export const deployedCommits = (row: EnvRow | undefined, history: History | undefined) => {
  const commits: Array<{ sha: string; builds: Array<{ stepId: string; run: HistoryRun }> }> = [];
  for (const cell of row?.cells ?? [])
    for (const version of versionsOf(cell.step, { params: cell.latest.versions })) {
      if (version.number === undefined) continue;
      const run = findRun(history, version.stepId, version.number);
      if (!run?.sha) continue;
      const entry = commits.find((item) => item.sha === run.sha);
      if (entry) entry.builds.push({ stepId: version.stepId, run });
      else commits.push({ sha: run.sha, builds: [{ stepId: version.stepId, run }] });
    }
  return commits;
};

/** The step's history for this env: its own, the shared one, or its branch's (commits). */
export const historyFor = (step: StepConfig, context: BoxContext): StepHistory | undefined => {
  const { history, env, row, branch } = context;
  return (
    history?.envs
      .find((entry) => entry.env === env)
      ?.steps.find((item) => item.step.id === step.id) ??
    history?.shared.find((item) => item.step.id === step.id) ??
    history?.branches[runningBranch(row) ?? branch]?.find((item) => item.step.id === step.id)
  );
};

/** A job's heading in a box: its name (a link) and what its runs add up to. */
const jobHeader = (job: JobHistory): Line => [
  { text: job.relation && !job.relation.startsWith('commits') ? '+ ' : '', role: 'muted' },
  { text: job.job, role: job.missing ? 'warn' : 'heading', bold: true, url: job.url },
  {
    text: job.missing ? '  not on the server' : `  ${tally(job.runs)}`,
    role: job.missing ? 'warn' : 'muted',
  },
];

/** What a deploy-like step put on the env: the branch, the run (and its job), the builds. */
const onEnvRows = (cell: EnvCell, jobs: readonly JobHistory[], context: BoxContext): Line[] => {
  const { latest } = cell;
  //? Nothing read (offline, missing job, error): one line saying so
  if (['offline', 'error', 'missing'].includes(latest.state))
    return [
      [
        { text: `on ${context.env}: `, role: 'muted' },
        { text: `${STATE_ICON[latest.state]} ${latest.summary}`, role: 'warn' },
      ],
    ];
  const shown = runByUrl(jobs, latest.url);
  const rows: Line[] = [
    [
      { text: `on ${context.env}: `, role: 'muted' },
      { text: `${STATE_ICON[latest.state]} `, role: latest.state === 'done' ? 'ok' : 'warn' },
      latest.branch
        ? {
            text: latest.branch,
            role: latest.branch === context.branch ? 'accent' : 'text',
            bold: true,
          }
        : { text: latest.summary, role: 'text' },
    ],
    [
      { text: '  by ', role: 'muted' },
      ...(shown && shown.job !== jobs[0]
        ? [{ text: `${shown.job.job} `, role: 'text' } as Segment]
        : []),
      { text: shown?.run.label ?? latest.summary, role: 'accent', url: latest.url },
      { text: `  ${when(latest.at)}`, role: 'muted' },
      ...(shown?.run.actor
        ? [{ text: `  ${shown.run.actor.name ?? shown.run.actor.login}`, role: 'muted' } as Segment]
        : []),
    ],
  ];
  const versions = versionsOf(cell.step, { params: latest.versions }).filter(
    (version) => version.number !== undefined,
  );
  if (versions.length)
    rows.push([
      { text: '  builds ', role: 'muted' },
      ...versions.flatMap((version, index): Segment[] => [
        { text: `${index ? ' · ' : ''}${version.stepId} `, role: 'muted' },
        {
          text: `#${version.number}`,
          role: 'accent',
          url: findRun(context.history, version.stepId, version.number as number)?.url,
        },
      ]),
    ]);
  return rows;
};

/**
 * A build's box: the build the env runs — its branch, when, who, the commit — and how it stands
 * among the builds of that branch (newer good ones?); then the job with that branch's newest runs,
 * the deployed one marked.
 */
const buildRows = (here: number, history: StepHistory | undefined, context: BoxContext): Line[] => {
  const jobs = history?.jobs ?? [];
  const deployed = jobs.flatMap((job) => job.runs).find((run) => run.id === String(here));
  const marker = `◀ on ${context.env}`;
  const rows: Line[] = [
    [
      { text: `on ${context.env}: `, role: 'muted' },
      { text: `#${here}`, role: 'accent', bold: true, url: deployed?.url },
      ...(deployed
        ? [
            { text: ` ${RUN_ICON[deployed.state]}`, role: RUN_ROLE[deployed.state] } as Segment,
            ...(deployed.branch
              ? [{ text: ` ${deployed.branch}`, role: 'text', bold: true } as Segment]
              : []),
          ]
        : []),
    ],
  ];
  if (!deployed) {
    rows.push([
      {
        text: context.history ? '  older than the builds read — no details' : '  reading…',
        role: 'muted',
      },
    ]);
  } else {
    rows.push([
      { text: `  built ${when(deployed.at)}`, role: 'muted' },
      ...(deployed.actor
        ? [{ text: `  ${deployed.actor.name ?? deployed.actor.login}`, role: 'muted' } as Segment]
        : []),
      ...(deployed.sha ? [{ text: `  ${deployed.sha.slice(0, 8)}`, role: 'text' } as Segment] : []),
    ]);
    const sameBranch = jobs
      .flatMap((job) => job.runs)
      .filter((run) => run.branch === deployed.branch);
    const newer = sameBranch.filter((run) => run.state === 'success' && Number(run.id) > here);
    rows.push(
      newer.length
        ? [
            {
              text: `  ${newer.length} newer good build${newer.length === 1 ? '' : 's'} of ${deployed.branch ?? 'it'} — newest `,
              role: 'warn',
            },
            { text: newer[0]?.label ?? '', role: 'accent', url: newer[0]?.url },
            { text: ` ${age(newer[0]?.at)} ago`, role: 'muted' },
          ]
        : [{ text: `  the newest good build of ${deployed.branch ?? 'its branch'}`, role: 'ok' }],
    );
  }
  for (const job of jobs) {
    rows.push(jobHeader(job));
    const branch = deployed?.branch;
    const runs = branch ? job.runs.filter((run) => run.branch === branch) : job.runs;
    if (branch) rows.push([{ text: `  newest of ${branch}:`, role: 'muted' }]);
    for (const run of runs.slice(0, RUNS_IN_BOX))
      rows.push([
        { text: '  ' },
        ...compactRun(run, {
          hideBranch: Boolean(branch),
          marker: run === deployed ? marker : undefined,
        }),
      ]);
    //? The deployed build is always shown, even when newer ones push it out of the newest few
    if (deployed && runs.includes(deployed) && runs.indexOf(deployed) >= RUNS_IN_BOX)
      rows.push(
        [{ text: `  … ${runs.indexOf(deployed) - RUNS_IN_BOX} more`, role: 'muted' }],
        [{ text: '  ' }, ...compactRun(deployed, { hideBranch: true, marker })],
      );
  }
  return rows;
};

/**
 * A branch step's box (the push): the branch the env runs, its head commit, the commits the env's
 * builds were made from and how far behind the head they are; then the newest commits.
 */
const branchRows = (history: StepHistory | undefined, context: BoxContext): Line[] => {
  const known = runningBranch(context.row);
  const running = known ?? context.branch;
  const commits = history?.jobs[0]?.runs ?? [];
  const head = commits[0];
  const rows: Line[] = [
    known
      ? [
          { text: `${context.env} runs `, role: 'muted' },
          { text: known, role: known === context.branch ? 'accent' : 'text', bold: true },
        ]
      : [
          { text: `what ${context.env} runs is unknown — showing `, role: 'warn' },
          { text: running || '—', role: 'accent', bold: true },
          { text: ', the branch shown', role: 'muted' },
        ],
  ];
  if (!history || history.error || !head) {
    rows.push([
      {
        text: history?.error ?? (context.history ? 'no commits read' : 'reading…'),
        role: history?.error ? 'warn' : 'muted',
      },
    ]);
    return rows;
  }
  rows.push([{ text: 'head ', role: 'muted' }, ...compactRun(head, { hideBranch: true })]);
  const deployed = deployedCommits(context.row, context.history);
  if (!deployed.length)
    rows.push([
      {
        text: context.row?.cells.some((cell) => Object.keys(cell.latest.versions ?? {}).length)
          ? 'deployed commit unknown — its builds report no checkout, or are older than read'
          : `deployed commit unknown — ${context.env}'s deploy was not read`,
        role: 'muted',
      },
    ]);
  for (const entry of deployed) {
    const at = commits.findIndex((commit) => commit.sha === entry.sha);
    const commit = commits[at];
    rows.push([
      { text: 'deployed ', role: 'muted' },
      { text: entry.sha.slice(0, 8), role: 'accent', bold: true, url: commit?.url },
      {
        text:
          at === 0
            ? '  = head'
            : at > 0
              ? `  ${at} commit${at === 1 ? '' : 's'} behind head`
              : `  older than the ${commits.length} newest commits`,
        role: at === 0 ? 'ok' : 'warn',
      },
      {
        text: `  ← ${entry.builds.map((build) => `${build.stepId} ${build.run.label}`).join(', ')}`,
        role: 'muted',
      },
    ]);
  }
  rows.push([{ text: 'newest commits:', role: 'muted' }]);
  const deployedShas = new Set(deployed.map((entry) => entry.sha));
  for (const commit of commits.slice(0, RUNS_IN_BOX))
    rows.push([
      { text: '  ' },
      ...compactRun(commit, {
        hideBranch: true,
        marker: commit.sha && deployedShas.has(commit.sha) ? `◀ on ${context.env}` : undefined,
      }),
    ]);
  return rows;
};

/**
 * A step's box for one env — the facts behind it, related to what the env runs: a deploy says
 * what it put there and its builds, a build which of its builds the env runs and how that stands
 * among its branch's builds, a branch step the commits; then each job and its newest runs, the
 * one on the env marked.
 */
export const stepContent = (
  step: StepConfig,
  history: StepHistory | undefined,
  context: BoxContext,
): GraphNodeContent => {
  const title = fillTemplate(step.label, { env: context.env, branch: context.branch });
  //? A per-branch step (its history is read by branch — a push's commits), or one with no job
  //? that does not act on the env
  const perBranch =
    Object.values(context.history?.branches ?? {}).some((steps) =>
      steps.some((item) => item.step.id === step.id),
    ) ||
    (step.job === undefined && !cellOf(context.row, step));
  if (perBranch) return { title, rows: branchRows(history, context) };
  const here = deployedHere(context.row, step.id);
  if (here !== undefined) return { title, rows: buildRows(here, history, context) };
  const rows: Line[] = [];
  const cell = cellOf(context.row, step);
  const jobs = history?.jobs ?? [];
  if (cell) rows.push(...onEnvRows(cell, jobs, context));
  if (!jobs.length) {
    rows.push([
      {
        text: history?.error ?? (context.history ? 'no runs read' : 'reading…'),
        role: history?.error ? 'warn' : 'muted',
      },
    ]);
    return { title, rows };
  }
  const onEnv = cell && runByUrl(jobs, cell.latest.url)?.run;
  for (const job of jobs) {
    rows.push(jobHeader(job));
    if (job.relation) rows.push([{ text: `  ${job.relation}`, role: 'muted' }]);
    for (const run of job.runs.slice(0, RUNS_IN_BOX))
      rows.push([
        { text: '  ' },
        ...compactRun(run, {
          branch: context.branch,
          marker: run === onEnv ? `◀ on ${context.env}` : undefined,
        }),
      ]);
  }
  return { title, rows };
};

// --- the branch relations graph -----------------------------------------------------------------

/**
 * `envs[].branches` against what runs: each branch (pattern) once, its envs fanned out after it,
 * each marked `tracks` (the config says so), `runs` (it does now) or both. An env tracking one
 * branch and running another sits under both.
 */
export const relationLines = (configs: readonly EnvConfig[], rows: readonly EnvRow[]): Line[] => {
  const relations = branchRelations(configs, rows);
  if (!relations.length)
    return [
      [
        {
          text: 'Nothing to relate yet — no env lists branches (envs[].branches in depli.config.ts) and none has run one',
          role: 'muted',
        },
      ],
    ];
  const width = Math.max(...relations.map((relation) => relation.branch.length));
  const envWidth = Math.max(...configs.map((entry) => entry.id.length));
  const running = new Map(rows.map((row) => [row.env, runningBranch(row)]));
  const lines: Line[] = [];
  for (const relation of relations) {
    const envs = configs
      .map((entry) => entry.id)
      .filter((id) => relation.tracks.includes(id) || relation.runs.includes(id));
    envs.forEach((env, index) => {
      const config = configs.find((entry) => entry.id === env);
      const tracks = relation.tracks.includes(env);
      const runs = relation.runs.includes(env);
      const connector =
        index === 0
          ? envs.length > 1
            ? ' ─┬─▶ '
            : ' ───▶ '
          : index === envs.length - 1
            ? '  └─▶ '
            : '  ├─▶ ';
      const actual = running.get(env);
      const off = onTrack(config, actual) === false;
      lines.push([
        index === 0
          ? { text: relation.branch.padEnd(width), role: 'accent', bold: true }
          : { text: ' '.repeat(width) },
        { text: connector, role: 'muted' },
        { text: env, role: 'heading', url: config?.url },
        { text: ' '.repeat(envWidth - env.length + 2) },
        {
          text: tracks && runs ? 'tracks · runs' : tracks ? 'tracks' : 'runs',
          role: tracks && runs ? 'ok' : tracks ? 'warn' : 'muted',
        },
        ...(tracks && !runs
          ? [
              {
                text: ` — runs ${actual ?? 'nothing known'}`,
                role: off ? 'warn' : 'muted',
              } as Segment,
            ]
          : []),
        ...(!tracks && runs && config?.branches?.length
          ? [
              {
                text: ` — off-track, should run ${config.branches.join(' ')}`,
                role: 'warn',
              } as Segment,
            ]
          : []),
      ]);
    });
  }
  return lines;
};

// --- runs ---------------------------------------------------------------------------------------

export interface RunContext {
  history?: History;
  /** The branch the dashboard shows — highlighted where it appears. */
  branch?: string;
  /** For a build run: the envs running it now (`deployedBuilds`). */
  deployedOn?: Map<number, string[]>;
}

/** One run as a line: number (link), result, time, duration, branch, what it deployed, who. */
export const runLine = (step: StepConfig, run: HistoryRun, context: RunContext): Line => {
  const versions = versionsOf(step, run).filter((version) => version.value);
  const on = context.deployedOn?.get(Number(run.id));
  return [
    { text: '        ' },
    { text: run.label.padStart(6), role: 'accent', url: run.url },
    { text: ` ${RUN_ICON[run.state]} `, role: RUN_ROLE[run.state] },
    { text: clock(run.at), role: 'text' },
    { text: ` ${duration(run.durationMs).padStart(7)}`, role: 'muted' },
    ...(run.branch
      ? [
          { text: '  ' },
          {
            text: run.branch,
            role: run.branch === context.branch ? 'accent' : 'text',
            bold: run.branch === context.branch,
          } as Segment,
        ]
      : []),
    ...versions.flatMap((version): Segment[] => [
      { text: `  ${version.stepId} `, role: 'muted' },
      version.number === undefined
        ? { text: version.value ?? '', role: 'text' }
        : {
            text: `#${version.number}`,
            role: 'accent',
            url: context.history && findRun(context.history, version.stepId, version.number)?.url,
          },
    ]),
    ...(on?.length ? [{ text: `  → on ${on.join(', ')}`, role: 'ok' } as Segment] : []),
    ...(run.actor
      ? [{ text: `  ${run.actor.name ?? run.actor.login}`, role: 'muted' } as Segment]
      : []),
    ...(run.detail ? [{ text: `  ${run.detail}`, role: 'text' } as Segment] : []),
  ];
};

/** The fold key of a job's runs, and of one day of them. */
export const jobKey = (scope: string, job: string) => `job:${scope}:${job}`;
export const dayKey = (scope: string, job: string, day: string) => `day:${scope}:${job}:${day}`;

/**
 * A job's runs as folds: one line for the job — closed by default, its tally and newest run on
 * it — and, open, one line per day (the newest open), each day's runs under it.
 */
export const jobLines = (
  step: StepConfig,
  job: JobHistory,
  context: RunContext,
  scope: string,
  isOpen: IsOpen,
): Line[] => {
  const key = jobKey(scope, job.job);
  const open = !job.missing && job.runs.length > 0 && isOpen(key, false);
  const newest = job.runs[0];
  const lines: Line[] = [
    [
      { text: '  ' },
      {
        text: `${job.runs.length ? (open ? '▾' : '▸') : ' '} ${job.job}`,
        role: job.missing ? 'warn' : 'heading',
        bold: true,
        action: job.runs.length ? key : undefined,
        open,
      },
      { text: ' ' },
      { text: '↗', role: 'accent', url: job.url },
      {
        text: `  ${job.missing ? 'not on the server' : tally(job.runs)}${job.relation ? ` · ${job.relation}` : ''}`,
        role: 'muted',
      },
      ...(newest && !open
        ? [
            { text: '  newest ', role: 'muted' } as Segment,
            ...compactRun(newest, { branch: context.branch }),
          ]
        : []),
    ],
  ];
  if (!open) return lines;
  runsByDay(job.runs).forEach(({ day, runs }, index) => {
    const dayOpen = isOpen(dayKey(scope, job.job, day), index === 0);
    lines.push([
      { text: '    ' },
      {
        text: `${dayOpen ? '▾' : '▸'} ${day}`,
        bold: true,
        action: dayKey(scope, job.job, day),
        open: dayOpen,
      },
      { text: `  ${tally(runs)}`, role: 'muted' },
    ]);
    if (dayOpen) lines.push(...runs.map((run) => runLine(step, run, context)));
  });
  return lines;
};

// --- the whole document -------------------------------------------------------------------------

export interface DetailInput {
  configs: readonly EnvConfig[];
  pipeline: readonly StepConfig[];
  /** The pipeline's steps for one env (`stepsFor`). */
  stepsFor: (env: string) => StepConfig[];
  rows: readonly EnvRow[];
  history?: History;
  branch?: string;
  targetEnv: string;
  width: number;
  /** The folds the person opened or closed; every job closed when unset. */
  isOpen?: IsOpen;
}

const closedByDefault: IsOpen = (_key, byDefault) => byDefault;

/** The overview table: one row per env, every value that has a page a link to it. */
export const overviewLines = (input: DetailInput): Line[] => {
  const { configs, rows, history, branch, targetEnv } = input;
  const envWidth = Math.max(3, ...configs.map((entry) => entry.id.length));
  const branchWidth = Math.max(12, ...rows.map((row) => (runningBranch(row) ?? '').length));
  const lines: Line[] = [
    [
      {
        text: `  ${'ENV'.padEnd(envWidth)}  ${'BRANCH ON IT'.padEnd(branchWidth)}  ${'TRACKS'.padEnd(16)}  DEPLOYED BY, BUILDS, THEN EVERY ENV STEP`,
        role: 'muted',
        bold: true,
      },
    ],
  ];
  for (const config of configs) {
    const row = rows.find((item) => item.env === config.id);
    const running = runningBranch(row);
    const off = onTrack(config, running) === false;
    const deploy = row?.cells.find((cell) => cell.latest.branch !== undefined) ?? row?.cells[0];
    const steps = history?.envs.find((entry) => entry.env === config.id)?.steps ?? [];
    const runOfLatest = (url?: string) => {
      for (const step of steps)
        for (const job of step.jobs) {
          const run = job.runs.find((candidate) => candidate.url === url);
          if (run) return { run, job };
        }
      return undefined;
    };
    const shown = runOfLatest(deploy?.latest.url);
    lines.push([
      {
        text: config.id === targetEnv ? '▸ ' : '  ',
        role: 'accent',
      },
      {
        text: config.id,
        role: config.protected ? 'error' : 'heading',
        bold: true,
        url: config.url,
      },
      { text: ' '.repeat(envWidth - config.id.length + 2) },
      {
        text: (running ?? deploy?.latest.summary ?? '…').padEnd(branchWidth),
        role: off ? 'warn' : running === branch ? 'accent' : 'text',
      },
      { text: `  ${(config.branches?.join(' ') ?? '—').padEnd(16)}`, role: off ? 'warn' : 'muted' },
      ...(deploy
        ? ([
            { text: '  ' },
            {
              text: shown ? `${shown.job.job} ${shown.run.label}` : deploy.latest.summary,
              role: 'accent',
              url: deploy.latest.url,
            },
            ...(shown?.run.actor
              ? [{ text: ` by ${shown.run.actor.name ?? shown.run.actor.login}`, role: 'muted' }]
              : []),
            ...versionsOf(deploy.step, { params: deploy.latest.versions }).flatMap(
              (version): Segment[] =>
                version.number === undefined
                  ? []
                  : [
                      { text: `  ${version.stepId} `, role: 'muted' },
                      {
                        text: `#${version.number}`,
                        role: 'accent',
                        url: findRun(history, version.stepId, version.number)?.url,
                      },
                    ],
            ),
          ] as Segment[])
        : []),
      ...(row?.cells ?? [])
        .filter((cell) => cell !== deploy)
        .flatMap((cell): Segment[] => [
          { text: `  ${cell.step.id} `, role: 'muted' },
          {
            text: cell.latest.at
              ? `${STATE_ICON[cell.latest.state]} ${shortStamp(cell.latest.at)} (${age(cell.latest.at)} ago)`
              : `${STATE_ICON[cell.latest.state]} ${cell.latest.summary}`,
            role: cell.latest.state === 'done' ? 'text' : 'warn',
            url: cell.latest.url,
          },
        ]),
    ]);
    if (config.url || off)
      lines.push([
        { text: `  ${' '.repeat(envWidth + 2)}` },
        ...(config.url ? [{ text: config.url, role: 'muted', url: config.url } as Segment] : []),
        ...(off
          ? [
              {
                text: `${config.url ? '  ' : ''}⚠ off-track: runs ${running}`,
                role: 'warn',
              } as Segment,
            ]
          : []),
      ]);
  }
  return lines;
};

/**
 * One env: its heading, what it is, its pipeline as a graph of boxes holding each step's facts and
 * jobs, then every job's runs as folds. `withBuilds` lists the shared builds' runs too — the
 * window shows one env alone; the detailed view lists them once, after every env.
 */
export const envLines = (input: DetailInput, env: string, withBuilds = false): Line[] => {
  const { configs, rows, history, branch = '', width, isOpen = closedByDefault } = input;
  const config = configs.find((entry) => entry.id === env);
  const row = rows.find((item) => item.env === env);
  const running = runningBranch(row);
  const steps = input.stepsFor(env);
  const envHistory = history?.envs.find((entry) => entry.env === env);
  const context: BoxContext = { env, branch, history, row };
  const historyOf = (step: StepConfig) => historyFor(step, context);
  const branchSteps = history?.branches[running ?? branch] ?? [];
  const deployed = deployedBuilds(rows.filter((item) => item.env === env));
  const off = onTrack(config, running) === false;
  const listed = steps.filter(
    (step) =>
      envHistory?.steps.some((entry) => entry.step.id === step.id) ||
      branchSteps.some((entry) => entry.step.id === step.id) ||
      (withBuilds && history?.shared.some((entry) => entry.step.id === step.id)),
  );
  return [
    heading(`${env}${config?.protected ? ' (protected)' : ''}`, width, config?.url),
    [
      { text: 'site ', role: 'muted' },
      config?.url
        ? { text: config.url, role: 'accent', url: config.url }
        : { text: '—', role: 'muted' },
      { text: '  tracks ', role: 'muted' },
      { text: config?.branches?.join(' ') ?? '— (envs[].branches)', role: 'text' },
      { text: '  runs ', role: 'muted' },
      { text: running ?? '—', role: off ? 'warn' : running === branch ? 'accent' : 'text' },
      ...(off ? [{ text: '  ⚠ off-track', role: 'warn' } as Segment] : []),
    ],
    [],
    subheading('Pipeline', `what ${env} runs, step by step — ◀ marks what is on it`),
    ...graphLines(steps, (step) => stepContent(step, historyOf(step), context), width - 2).map(
      (line) => [{ text: '  ' }, ...line],
    ),
    [],
    subheading('Runs', 'every job — ▸ opens its runs by day'),
    ...(history
      ? listed.flatMap((step) => {
          const stepHistory = historyOf(step);
          if (stepHistory?.error && !stepHistory.jobs.length)
            return [[{ text: `  ${step.id}: ${stepHistory.error}`, role: 'warn' } as Segment]];
          return (stepHistory?.jobs ?? []).flatMap((job) =>
            jobLines(
              step,
              job,
              { history, branch, deployedOn: deployed.get(step.id) },
              env,
              isOpen,
            ),
          );
        })
      : [[{ text: '  reading…', role: 'muted' } as Segment]]),
    [],
  ];
};

/** The top of the detailed view: the overview table, then branches → envs. */
export const overviewDoc = (input: DetailInput): Line[] => [
  heading('Environments', input.width),
  ...overviewLines(input),
  [],
  heading('Branches → envs (envs[].branches, and what runs)', input.width),
  ...relationLines(input.configs, input.rows),
  [],
];

/** A page of the detailed view's tabs: one env with its jobs, or one job across its envs. */
export type DetailTab =
  | { kind: 'env'; id: string; label: string }
  | { kind: 'job'; id: string; label: string; step: StepConfig };

/** The tab's id — `env:ci`, `job:deploy` — unique across both kinds. */
export const tabId = (tab: Pick<DetailTab, 'kind' | 'id'>) => `${tab.kind}:${tab.id}`;

/**
 * The detailed view's tabs: every env, then every step with jobs read — the builds, and each
 * env-scoped step once (`deploy_frontend_only_{env}` is one tab, its envs inside it).
 */
export const detailTabs = (input: Pick<DetailInput, 'configs' | 'pipeline' | 'history'>) => {
  const { configs, pipeline, history } = input;
  const read = (step: StepConfig) =>
    Boolean(
      history?.shared.some((entry) => entry.step.id === step.id) ||
        history?.envs.some((env) => env.steps.some((entry) => entry.step.id === step.id)),
    );
  return {
    envs: configs.map((config): DetailTab => ({ kind: 'env', id: config.id, label: config.id })),
    jobs: pipeline.filter(read).map(
      (step): DetailTab => ({
        kind: 'job',
        id: step.id,
        label: step.label.replaceAll('{env}', '*'),
        step,
      }),
    ),
  };
};

/** Scoped to one job its runs are what the page is for — open until closed. */
const jobsOpen =
  (isOpen: IsOpen): IsOpen =>
  (key, byDefault) =>
    isOpen(key, key.startsWith('job:') || byDefault);

/** A step's jobs as folds, or why they could not be read. */
const stepJobs = (
  stepHistory: StepHistory | undefined,
  context: RunContext,
  scope: string,
  isOpen: IsOpen,
): Line[] => {
  if (!stepHistory) return [[{ text: '  not read', role: 'muted' }]];
  if (stepHistory.error && !stepHistory.jobs.length)
    return [[{ text: `  ${stepHistory.error}`, role: 'warn' }]];
  if (!stepHistory.jobs.length) return [[{ text: '  no jobs', role: 'muted' }]];
  return stepHistory.jobs.flatMap((job) =>
    jobLines(stepHistory.step, job, context, scope, isOpen),
  );
};

/**
 * One job across the envs: a build — which envs run which of its builds now, then its runs; an
 * env-scoped step — its latest run on every env, then per env its jobs (`alsoDeployedBy` ones
 * too) and their runs.
 */
export const jobTabLines = (input: DetailInput, step: StepConfig): Line[] => {
  const { configs, rows, history, branch = '', width } = input;
  const isOpen = jobsOpen(input.isOpen ?? closedByDefault);
  const deployedOn = deployedBuilds(rows).get(step.id);
  const job = typeof step.job === 'string' ? step.job : step.id;
  const also = Array.isArray(step.alsoDeployedBy) ? (step.alsoDeployedBy as string[]) : [];
  const top: Line[] = [
    heading(step.label.replaceAll('{env}', '*'), width),
    [
      { text: 'job ', role: 'muted' },
      { text: job, role: 'text' },
      ...(also.length
        ? [
            { text: '  also deployed by ', role: 'muted' } as Segment,
            { text: also.join(' '), role: 'text' } as Segment,
          ]
        : []),
    ],
    [],
  ];
  if (!history) return [...top, [{ text: '  reading…', role: 'muted' }]];

  const shared = history.shared.find((entry) => entry.step.id === step.id);
  if (shared) {
    const builds = [...(deployedOn ?? new Map<number, string[]>())].sort(([a], [b]) => b - a);
    return [
      ...top,
      subheading('On envs now', 'the builds each env runs, from its deploy'),
      ...(builds.length
        ? builds.map(([number, envs]): Line => [
            { text: '    ' },
            {
              text: `#${number}`.padStart(6),
              role: 'accent',
              url: findRun(history, step.id, number)?.url,
            },
            { text: '  → ', role: 'muted' },
            { text: envs.join(', '), role: 'ok', bold: true },
          ])
        : [[{ text: '    none of its builds is on an env', role: 'muted' } as Segment]]),
      [],
      subheading('Runs', 'by day — ▾ closes a job or a day'),
      ...stepJobs(shared, { history, branch, deployedOn }, 'jobtab', isOpen),
      [],
    ];
  }

  const envs = configs.filter((config) =>
    input.stepsFor(config.id).some((item) => item.id === step.id),
  );
  const envWidth = Math.max(3, ...envs.map((config) => config.id.length));
  const latest = envs.map((config): Line => {
    const cell = cellOf(
      rows.find((row) => row.env === config.id),
      step,
    );
    const versions = cell
      ? versionsOf(step, { params: cell.latest.versions }).filter(
          (version) => version.number !== undefined,
        )
      : [];
    return [
      { text: '    ' },
      {
        text: config.id.padEnd(envWidth),
        role: config.protected ? 'error' : 'heading',
        bold: true,
        url: config.url,
      },
      ...(cell
        ? ([
            { text: `  ${STATE_ICON[cell.latest.state]} `, role: 'text' },
            { text: cell.latest.summary, role: 'accent', url: cell.latest.url },
            { text: `  ${when(cell.latest.at)}`, role: 'muted' },
            ...(cell.latest.branch
              ? [
                  {
                    text: `  ${cell.latest.branch}`,
                    role: cell.latest.branch === branch ? 'accent' : 'text',
                    bold: cell.latest.branch === branch,
                  },
                ]
              : []),
            ...versions.flatMap((version): Segment[] => [
              { text: `  ${version.stepId} `, role: 'muted' },
              {
                text: `#${version.number}`,
                role: 'accent',
                url: findRun(history, version.stepId, version.number as number)?.url,
              },
            ]),
          ] as Segment[])
        : [{ text: '  …', role: 'muted' } as Segment]),
    ];
  });
  return [
    ...top,
    subheading('Per env', 'its latest run on each env'),
    ...latest,
    [],
    ...envs.flatMap((config): Line[] => {
      const stepHistory = history.envs
        .find((entry) => entry.env === config.id)
        ?.steps.find((entry) => entry.step.id === step.id);
      return [
        subheading(config.id, config.url),
        ...stepJobs(stepHistory, { history, branch }, 'jobtab', isOpen),
        [],
      ];
    }),
  ];
};

/** The page of a tab. An env tab lists the builds' runs too — the view has no other place for them. */
export const tabLines = (input: DetailInput, tab: DetailTab): Line[] =>
  tab.kind === 'env' ? envLines(input, tab.id, true) : jobTabLines(input, tab.step);

/** The jobs' folds in the lines, and whether any is closed — what "open all" acts on. */
export const jobFolds = (lines: readonly Line[]) => {
  const folds = linksOf(lines).filter((item) => item.action?.startsWith('job:'));
  return {
    keys: folds.map((item) => item.action as string),
    anyClosed: folds.some((item) => !item.open),
  };
};
