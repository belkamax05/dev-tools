/**
 * The Environments view's pages as lines of segments — pure, so they are tested without a
 * terminal. Everything is about one env: what each step of its pipeline left on it. A segment with
 * a `url` is a link (underlined, opens the server's page); one with a `to` opens a page of the
 * view (a step, a run); one with an `action` is a fold (a day of runs). All are clickable and
 * reachable from the keyboard. Colours are theme roles, resolved when drawn.
 */
import type { EnvConfig } from '../../../config/project';
import { STATE_ICON } from '../../../core/chain';
import { borderRow, busRow, layoutGraph } from '../../../core/graph';
import {
  findRun,
  type History,
  runningBranch,
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
  /** A page of the view to go to — a step's or a run's (`toStep`, `toRun`); before `url`. */
  to?: string;
}

/** A page under the env open: a step of its pipeline, or one run of a job of it. */
export interface Target {
  step: string;
  /** For a run: the job it is a run of — the step's own, or one deploying alongside it. */
  job?: string;
  run?: string;
}

export const toStep = (step: string) => JSON.stringify({ step } satisfies Target);
export const toRun = (step: string, job: string, run: string) =>
  JSON.stringify({ step, job, run } satisfies Target);
export const targetOf = (to: string) => JSON.parse(to) as Target;

export type Line = Segment[];

/** Every link and toggle in reading order, with where it is — what the keyboard steps through. */
export const linksOf = (lines: readonly Line[]) =>
  lines.flatMap((line, at) =>
    line.flatMap((segment, index) =>
      segment.url || segment.action || segment.to
        ? [
            {
              line: at,
              segment: index,
              url: segment.url,
              action: segment.action,
              open: segment.open,
              to: segment.to,
            },
          ]
        : [],
    ),
  );

export const lineText = (line: Line) => line.map((segment) => segment.text).join('');

/** Whether a fold is open: what the person chose, else `byDefault`. */
export type IsOpen = (key: string, byDefault: boolean) => boolean;

export const RUN_ICON: Record<HistoryRun['state'], string> = {
  success: '✓',
  failure: '✗',
  running: '◐',
  aborted: '⊘',
  queued: '…',
  other: '·',
};

export const RUN_ROLE: Record<HistoryRun['state'], Role> = {
  success: 'ok',
  failure: 'error',
  running: 'accent',
  aborted: 'muted',
  queued: 'muted',
  other: 'muted',
};

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (at?: number) => {
  if (!at) return '--:--';
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const duration = (ms?: number) => {
  if (ms === undefined) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${pad(seconds % 60)}s`;
};
export const when = (at?: number) => (at ? `${shortStamp(at)} (${age(at)} ago)` : '—');

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

export const heading = (text: string, width: number, url?: string): Line => [
  { text: '━━ ', role: 'accent' },
  { text, role: 'heading', bold: true, url },
  { text: ` ${'━'.repeat(Math.max(0, width - text.length - 4))}`, role: 'accent' },
];

export const subheading = (text: string, note?: string): Line => [
  { text: `  ${text}`, role: 'heading', bold: true },
  ...(note ? [{ text: `  ${note}`, role: 'muted' } as Segment] : []),
];

/** `12 runs · 10 ✓ 2 ✗` — what a job's history adds up to. */
export const tally = (runs: readonly HistoryRun[]) => {
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
  /** The title's page — a click on it opens the step. */
  to?: string;
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
        ...fitLine(
          [{ text: entry.content.title, role: 'heading', bold: true, to: entry.content.to }],
          inner(entry),
        ),
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
  /** The run's page in the view. */
  to?: string;
}

/** A run on one line: result, number (its page), when, the branch, who, what it says, a marker. */
export const compactRun = (run: HistoryRun, options: CompactOptions = {}): Line => [
  { text: `${RUN_ICON[run.state]} `, role: RUN_ROLE[run.state] },
  { text: run.label, role: 'accent', url: run.url, to: options.to },
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
  /** The branch the dashboard shows. */
  branch: string;
  history?: History;
  /** The env's row: what each env step last put on it. */
  row?: EnvRow;
  /** A commit's page in the repository, when its provider can say. */
  commitUrl?: (sha: string) => string | undefined;
}

/** A commit's short hash — a link to its page in the repository (or `url`, when known). */
export const commitLink = (
  sha: string,
  context: Pick<BoxContext, 'commitUrl'>,
  url?: string,
  bold = false,
): Segment => ({
  text: sha.slice(0, 8),
  role: 'accent',
  bold,
  url: url ?? context.commitUrl?.(sha),
});

/** `✓ label` when good, `⚠ label` when not — a status at a glance. */
const status = (good: boolean, label: string): Segment => ({
  text: `${good ? '✓' : '⚠'} ${label}`,
  role: good ? 'ok' : 'warn',
});

/** The branch the env is on — else the one the dashboard shows. */
export const envBranch = (context: Pick<BoxContext, 'row' | 'branch'>) =>
  runningBranch(context.row) ?? context.branch;

/** A shared build's run by its number, with its job — what a build number on a deploy names. */
export const findBuild = (history: History | undefined, stepId: string, number: number) => {
  const step = history?.shared.find((entry) => entry.step.id === stepId);
  for (const job of step?.jobs ?? []) {
    const run = job.runs.find((candidate) => candidate.id === String(number));
    if (run) return { job, run };
  }
  return undefined;
};

/** The page of a build by its number, when the history still has it. */
export const buildTo = (history: History | undefined, stepId: string, number: number) => {
  const found = findBuild(history, stepId, number);
  return found && toRun(stepId, found.job.job, found.run.id);
};

/** The cell of the env's row for this step, when the step acts on the env. */
export const cellOf = (row: EnvRow | undefined, step: StepConfig): EnvCell | undefined =>
  row?.cells.find((cell) => cell.step.id === step.id);

/** For a build step: the build number the env's deploy runs, read from its version params. */
export const deployedHere = (row: EnvRow | undefined, stepId: string) => {
  for (const cell of row?.cells ?? [])
    for (const [param, id] of Object.entries((cell.step.versions ?? {}) as Record<string, string>))
      if (id === stepId) return versionNumber(cell.latest.versions?.[param]);
  return undefined;
};

/** The run with this page among the jobs' runs, with its job. */
export const runByUrl = (jobs: readonly JobHistory[], url?: string) => {
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
  const { history, env } = context;
  return (
    history?.envs
      .find((entry) => entry.env === env)
      ?.steps.find((item) => item.step.id === step.id) ??
    history?.shared.find((item) => item.step.id === step.id) ??
    history?.branches[envBranch(context)]?.find((item) => item.step.id === step.id)
  );
};

/** Whether the step's history is read per branch — a push's commits — rather than per job. */
export const isBranchStep = (step: StepConfig, context: BoxContext) =>
  Object.values(context.history?.branches ?? {}).some((steps) =>
    steps.some((item) => item.step.id === step.id),
  ) ||
  (step.job === undefined && !cellOf(context.row, step));

/**
 * How a step's run relates to the env: the run that is on it — a deploy's last run, the build a
 * deploy names — or, for a step that does not act on the env, its newest run of the env's branch.
 */
export const runOnEnv = (step: StepConfig, jobs: readonly JobHistory[], context: BoxContext) => {
  const cell = cellOf(context.row, step);
  if (cell) return runByUrl(jobs, cell.latest.url);
  const here = deployedHere(context.row, step.id);
  if (here !== undefined)
    for (const job of jobs) {
      const run = job.runs.find((candidate) => candidate.id === String(here));
      if (run) return { job, run };
    }
  return undefined;
};

/** What a deploy-like step put on the env: the branch, by which run (and job), the builds. */
const onEnvRows = (cell: EnvCell, jobs: readonly JobHistory[], context: BoxContext): Line[] => {
  const { latest } = cell;
  //? Nothing read (offline, missing job, error): one line saying so
  if (['offline', 'error', 'missing'].includes(latest.state))
    return [[{ text: `${STATE_ICON[latest.state]} ${latest.summary}`, role: 'warn' }]];
  const shown = runByUrl(jobs, latest.url);
  const rows: Line[] = [
    [
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
      { text: 'by ', role: 'muted' },
      ...(shown && shown.job !== jobs[0]
        ? [{ text: `${shown.job.job} `, role: 'text' } as Segment]
        : []),
      {
        text: shown?.run.label ?? latest.summary,
        role: 'accent',
        url: latest.url,
        to: shown ? toRun(cell.step.id, shown.job.job, shown.run.id) : undefined,
      },
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
      { text: 'with ', role: 'muted' },
      ...versions.flatMap((version, index): Segment[] => [
        { text: `${index ? ' · ' : ''}${version.stepId} `, role: 'muted' },
        {
          text: `#${version.number}`,
          role: 'accent',
          url: findRun(context.history, version.stepId, version.number as number)?.url,
          to: buildTo(context.history, version.stepId, version.number as number),
        },
      ]),
    ]);
  return rows;
};

/**
 * A build's box: the build the env runs — its branch, when, who, the commit — and whether the
 * branch has newer good builds since.
 */
const buildRows = (
  step: StepConfig,
  here: number,
  history: StepHistory | undefined,
  context: BoxContext,
): Line[] => {
  const jobs = history?.jobs ?? [];
  const runTo = (run: HistoryRun) => {
    const job = jobs.find((item) => item.runs.includes(run));
    return job && toRun(step.id, job.job, run.id);
  };
  const deployed = jobs.flatMap((job) => job.runs).find((run) => run.id === String(here));
  const rows: Line[] = [
    [
      {
        text: `#${here}`,
        role: 'accent',
        bold: true,
        url: deployed?.url,
        to: deployed && runTo(deployed),
      },
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
        text: context.history ? 'older than the builds read — no details' : 'reading…',
        role: 'muted',
      },
    ]);
    return rows;
  }
  rows.push([
    { text: `built ${when(deployed.at)}`, role: 'muted' },
    ...(deployed.actor
      ? [{ text: `  ${deployed.actor.name ?? deployed.actor.login}`, role: 'muted' } as Segment]
      : []),
    ...(deployed.sha ? [{ text: '  ' } as Segment, commitLink(deployed.sha, context)] : []),
  ]);
  const newer = jobs
    .flatMap((job) => job.runs)
    .filter(
      (run) => run.branch === deployed.branch && run.state === 'success' && Number(run.id) > here,
    );
  //? Evidence, not a sentence: latest, or how many good builds came since and the newest one
  rows.push(
    newer.length
      ? [
          status(false, `${newer.length} newer · `),
          {
            text: newer[0]?.label ?? '',
            role: 'accent',
            url: newer[0]?.url,
            to: newer[0] && runTo(newer[0]),
          },
          { text: ` ${age(newer[0]?.at)} ago`, role: 'muted' },
        ]
      : [status(true, 'latest')],
  );
  return rows;
};

/** How far a commit is behind the branch's latest, as a status. */
const behind = (at: number, read: number): Segment =>
  at === 0
    ? status(true, 'latest')
    : at > 0
      ? status(false, `${at} commit${at === 1 ? '' : 's'} behind`)
      : status(false, `older than the ${read} read`);

/**
 * A branch step's box (the push): the branch, its latest commit, and the commit on the env — how
 * far behind the latest it is. An env whose builds come from different commits (one build not
 * redone since a change) gets a line per build, each saying which build it is.
 */
const branchRows = (history: StepHistory | undefined, context: BoxContext): Line[] => {
  const known = runningBranch(context.row);
  const commits = history?.jobs[0]?.runs ?? [];
  const latest = commits[0];
  const rows: Line[] = [
    known
      ? [{ text: known, role: known === context.branch ? 'accent' : 'text', bold: true }]
      : [
          { text: 'branch unknown — showing ', role: 'warn' },
          { text: context.branch || '—', role: 'accent', bold: true },
        ],
  ];
  if (!history || history.error || !latest) {
    rows.push([
      {
        text: history?.error ?? (context.history ? 'no commits read' : 'reading…'),
        role: history?.error ? 'warn' : 'muted',
      },
    ]);
    return rows;
  }
  const on = `on ${context.env}`;
  //? `latest` and `on ci3` in one column, the hashes lined up after it
  const label = (text: string) =>
    ({ text: text.padEnd(Math.max('latest'.length, on.length) + 2), role: 'muted' }) as Segment;
  rows.push([
    label('latest'),
    commitLink(latest.sha ?? latest.id, context, latest.url),
    ...(latest.detail ? [{ text: `  ${latest.detail}`, role: 'text' } as Segment] : []),
    { text: `  ${age(latest.at)} ago`, role: 'muted' },
  ]);
  const deployed = deployedCommits(context.row, context.history);
  if (!deployed.length) {
    rows.push([
      label(on),
      {
        text: context.row?.cells.some((cell) => Object.keys(cell.latest.versions ?? {}).length)
          ? 'commit unknown — its builds report none, or are older than read'
          : `commit unknown — ${context.env}'s deploy was not read`,
        role: 'muted',
      },
    ]);
    return rows;
  }
  const commitOf = (sha: string) => {
    const at = commits.findIndex((commit) => commit.sha === sha);
    return [
      commitLink(sha, context, commits[at]?.url, true),
      { text: '  ' },
      behind(at, commits.length),
    ] as Segment[];
  };
  //? One commit: one line. Several: the builds are from different commits — a line per build
  if (deployed.length === 1 && deployed[0]) {
    rows.push([label(on), ...commitOf(deployed[0].sha)]);
    return rows;
  }
  const builds = deployed.flatMap((entry) => entry.builds.map((build) => ({ ...build, sha: entry.sha })));
  const nameWidth = Math.max(...builds.map((build) => `${build.stepId} ${build.run.label}`.length));
  builds.forEach((build, index) => {
    rows.push([
      label(index ? '' : on),
      { text: `${build.stepId} `, role: 'muted' },
      {
        text: build.run.label,
        role: 'accent',
        url: build.run.url,
        to: buildTo(context.history, build.stepId, Number(build.run.id)),
      },
      { text: ' '.repeat(nameWidth - `${build.stepId} ${build.run.label}`.length + 2) },
      ...commitOf(build.sha),
    ]);
  });
  return rows;
};

/** A step that does not act on the env: its newest run of the branch the env is on. */
const branchRunRow = (step: StepConfig, jobs: readonly JobHistory[], context: BoxContext): Line => {
  const branch = envBranch(context);
  const newest = jobs
    .flatMap((job) => job.runs.map((run) => ({ job, run })))
    .filter((entry) => entry.run.branch === branch)
    .sort((a, b) => (b.run.at ?? 0) - (a.run.at ?? 0))[0];
  if (!newest) return [{ text: `no run of ${branch || 'its branch'} read`, role: 'muted' }];
  return [
    { text: 'newest ', role: 'muted' },
    ...compactRun(newest.run, {
      hideBranch: true,
      to: toRun(step.id, newest.job.job, newest.run.id),
    }),
  ];
};

/**
 * A step's box for one env — only what it left there: a deploy, what it put on the env and with
 * which builds; a build, the one the env runs and whether its branch has newer good ones; the
 * push, the branch and how far the deployed commit is behind its head. Its title opens the step.
 */
export const stepContent = (
  step: StepConfig,
  history: StepHistory | undefined,
  context: BoxContext,
): GraphNodeContent => {
  const title = fillTemplate(step.label, { env: context.env, branch: context.branch });
  const to = history?.jobs.length ? toStep(step.id) : undefined;
  if (isBranchStep(step, context)) return { title, to, rows: branchRows(history, context) };
  const here = deployedHere(context.row, step.id);
  if (here !== undefined) return { title, to, rows: buildRows(step, here, history, context) };
  const cell = cellOf(context.row, step);
  const jobs = history?.jobs ?? [];
  if (cell) return { title, to, rows: onEnvRows(cell, jobs, context) };
  if (!jobs.length)
    return {
      title,
      rows: [
        [
          {
            text: history?.error ?? (context.history ? 'no runs read' : 'reading…'),
            role: history?.error ? 'warn' : 'muted',
          },
        ],
      ],
    };
  return { title, to, rows: [branchRunRow(step, jobs, context)] };
};

// --- runs ---------------------------------------------------------------------------------------

export interface RunContext {
  history?: History;
  /** The branch the dashboard shows — highlighted where it appears. */
  branch?: string;
  /** For a build run: the envs running it now (`deployedBuilds`). */
  deployedOn?: Map<number, string[]>;
  /** The run's page; set, the builds a run deployed link to theirs too. */
  toRun?: (run: HistoryRun) => string | undefined;
}

/** One run as a line: number (link), result, time, duration, branch, what it deployed, who. */
export const runLine = (step: StepConfig, run: HistoryRun, context: RunContext): Line => {
  const versions = versionsOf(step, run).filter((version) => version.value);
  const on = context.deployedOn?.get(Number(run.id));
  return [
    { text: '    ' },
    { text: run.label.padStart(6), role: 'accent', url: run.url, to: context.toRun?.(run) },
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
            to: context.toRun && buildTo(context.history, version.stepId, version.number),
          },
    ]),
    ...(on?.length ? [{ text: `  → on ${on.join(', ')}`, role: 'ok' } as Segment] : []),
    ...(run.actor
      ? [{ text: `  ${run.actor.name ?? run.actor.login}`, role: 'muted' } as Segment]
      : []),
    ...(run.detail ? [{ text: `  ${run.detail}`, role: 'text' } as Segment] : []),
  ];
};

/** The fold key of one day of a job's runs. */
export const dayKey = (scope: string, job: string, day: string) => `day:${scope}:${job}:${day}`;

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
  /** The folds the person opened or closed; each as it says by default when unset. */
  isOpen?: IsOpen;
  /** A commit's page in the repository, when its provider can say. */
  commitUrl?: (sha: string) => string | undefined;
}

/** The folds in the lines, and whether any is closed — what "open all" acts on. */
export const foldsOf = (lines: readonly Line[]) => {
  const folds = linksOf(lines).filter((item) => item.action);
  return {
    keys: folds.map((item) => item.action as string),
    anyClosed: folds.some((item) => !item.open),
  };
};
