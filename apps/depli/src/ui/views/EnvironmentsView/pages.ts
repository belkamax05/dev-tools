/**
 * The Environments view's pages, each inside the one before it — an env, a step of its pipeline,
 * one run — and each only about that env: a step's page lists the runs that concern the env (a
 * build's of the branch it is on, a deploy's on it), never every run of the job. Pure, like
 * `lines` — tested without a terminal.
 */
import {
  deployedBuilds,
  onTrack,
  runningBranch,
  runsByDay,
  versionsOf,
} from '../../../core/history';
import type { HistoryRun, JobHistory, StepConfig } from '../../../core/plugin';
import { age, shortStamp } from '../../../core/time';
import {
  type BoxContext,
  cellOf,
  commitLink,
  compactRun,
  type DetailInput,
  dayKey,
  duration,
  envBranch,
  findBuild,
  graphLines,
  heading,
  historyFor,
  type IsOpen,
  isBranchStep,
  type Line,
  RUN_ICON,
  RUN_ROLE,
  type RunContext,
  runLine,
  runOnEnv,
  type Segment,
  stepContent,
  subheading,
  type Target,
  tally,
  toRun,
  when,
} from './lines';

const closedByDefault: IsOpen = (_key, byDefault) => byDefault;

/** The env's context for its boxes and pages. */
const contextOf = (input: DetailInput, env: string): BoxContext => ({
  env,
  branch: input.branch ?? '',
  history: input.history,
  row: input.rows.find((item) => item.env === env),
  commitUrl: input.commitUrl,
});

/** The step's name on the env — `Deploy to {env}` filled. */
const stepTitle = (step: StepConfig, context: BoxContext) =>
  step.label.replaceAll('{env}', context.env).replaceAll('{branch}', context.branch);

/**
 * A job's runs that concern the env: a deploy's (its job is the env's), a push's commits (read for
 * that branch already); a build's or any shared step's, those of the branch the env is on — and
 * the one the env runs, whatever its branch says.
 */
export const runsFor = (step: StepConfig, job: JobHistory, context: BoxContext) => {
  if (isBranchStep(step, context) || cellOf(context.row, step)) return job.runs;
  const onEnv = runOnEnv(step, [job], context)?.run;
  return job.runs.filter((run) => run === onEnv || run.branch === envBranch(context));
};

/** A target's step, its history for the env, the job and (for a run page) the run — if still read. */
export const resolveTarget = (input: DetailInput, env: string, target: Target) => {
  const context = contextOf(input, env);
  const step =
    input.stepsFor(env).find((item) => item.id === target.step) ??
    input.pipeline.find((item) => item.id === target.step);
  const history = step && historyFor(step, context);
  const job =
    target.job === undefined ? undefined : history?.jobs.find((item) => item.job === target.job);
  const run =
    target.run === undefined ? undefined : job?.runs.find((item) => item.id === target.run);
  return { step, history, job, run, context };
};

/** The path to a page: a step's, or a run's under its step's. */
export const pathTo = (target: Target): Target[] =>
  target.run === undefined ? [{ step: target.step }] : [{ step: target.step }, target];

/** What each step of the path is called: the step's name on the env, then `#run`. */
export const crumbs = (input: DetailInput, env: string, path: readonly Target[]) =>
  path.map((target) => {
    if (target.run !== undefined) return `#${target.run}`;
    const { step, context } = resolveTarget(input, env, target);
    return step ? stepTitle(step, context) : target.step;
  });

/** The env's lines under the path: the branch on it, what it is meant for, its site. */
const envSummary = (input: DetailInput, env: string): Line[] => {
  const config = input.configs.find((entry) => entry.id === env);
  const running = runningBranch(input.rows.find((item) => item.env === env));
  const off = onTrack(config, running) === false;
  return [
    [
      { text: 'branch ', role: 'muted' },
      {
        text: running ?? 'unknown',
        role: off ? 'warn' : running === input.branch ? 'accent' : 'text',
        bold: true,
      },
      ...(config?.branches?.length
        ? [
            { text: '   meant for ', role: 'muted' } as Segment,
            { text: config.branches.join(' '), role: 'text' } as Segment,
          ]
        : []),
      ...(config?.url
        ? [
            { text: '   site ', role: 'muted' } as Segment,
            { text: config.url, role: 'accent', url: config.url } as Segment,
          ]
        : []),
    ],
    ...(off
      ? [[{ text: `⚠ off-track — ${running} is not a branch ${env} is meant for`, role: 'warn' }]]
      : []),
  ] as Line[];
};

/**
 * The env's page: the branch on it, then its pipeline as a graph whose boxes hold only what each
 * step left on the env. A box's title opens the step; a run number, the run.
 */
export const envRootLines = (input: DetailInput, env: string): Line[] => {
  const context = contextOf(input, env);
  return [
    ...envSummary(input, env),
    [],
    ...graphLines(
      input.stepsFor(env),
      (step) => stepContent(step, historyFor(step, context), context),
      input.width - 2,
    ).map((line) => [{ text: '  ' }, ...line]),
    [],
  ];
};

/** Not read (yet, or any more): one line saying so under the page's heading. */
const missingPage = (input: DetailInput, title: string): Line[] => [
  heading(title, input.width),
  [
    {
      text: input.history ? 'not in what was read — r reads again' : 'reading…',
      role: 'muted',
    },
  ],
];

/**
 * A step's page on the env: what it left there now (its box), then each of its jobs (the step's
 * own, and any deploying alongside it) with the runs that concern the env, by day — the newest
 * day open.
 */
export const stepPageLines = (
  input: DetailInput,
  env: string,
  target: Target,
  isOpen: IsOpen = closedByDefault,
): Line[] => {
  const { step, history, context } = resolveTarget(input, env, target);
  if (!step || !history) return missingPage(input, target.step);
  const onEnv = runOnEnv(step, history.jobs, context);
  const deployedOn = deployedBuilds(input.rows).get(step.id);
  //? A step that does not act on the env: only its runs of the env's branch concern it
  const scoped = !isBranchStep(step, context) && !cellOf(context.row, step);
  const lines: Line[] = [
    heading(stepTitle(step, context), input.width),
    ...stepContent(step, history, context).rows,
    [],
  ];
  if (history.error && !history.jobs.length) lines.push([{ text: history.error, role: 'warn' }]);
  for (const job of history.jobs) {
    const runs = runsFor(step, job, context);
    lines.push([
      { text: job.job, role: job.missing ? 'warn' : 'heading', bold: true },
      { text: ' ' },
      { text: '↗', role: 'accent', url: job.url },
      {
        text: job.missing
          ? '  not on the server'
          : `  ${scoped ? `${envBranch(context)} · ` : ''}${tally(runs)}${job.relation ? ` · ${job.relation}` : ''}`,
        role: job.missing ? 'warn' : 'muted',
      },
    ]);
    if (!job.missing && !runs.length)
      lines.push([
        { text: `  no runs${scoped ? ` of ${envBranch(context)}` : ''} read`, role: 'muted' },
      ]);
    const runContext: RunContext = {
      history: input.history,
      branch: input.branch,
      deployedOn,
      toRun: (run) => toRun(step.id, job.job, run.id),
    };
    runsByDay(runs).forEach(({ day, runs: dayRuns }, index) => {
      const key = dayKey(env, job.job, day);
      const open = isOpen(key, index === 0);
      lines.push([
        { text: '  ' },
        { text: `${open ? '▾' : '▸'} ${day}`, bold: true, action: key, open },
        { text: `  ${tally(dayRuns)}`, role: 'muted' },
      ]);
      if (open)
        lines.push(
          ...dayRuns.map((run) => {
            const line = runLine(step, run, runContext);
            return run === onEnv?.run
              ? [...line, { text: `  ◀ on ${env}`, role: 'ok', bold: true } as Segment]
              : line;
          }),
        );
    });
    lines.push([]);
  }
  return lines;
};

/** The run next to this one among the env's runs of the job: older (`1`) or newer (`-1`). */
export const neighbour = (runs: readonly HistoryRun[], run: HistoryRun, delta: number) =>
  runs[runs.indexOf(run) + delta];

/**
 * A run's page on the env: its result, when, how long, who, the branch and commit; where it
 * stands for the env — on it now or replaced, a build's newer good ones; the builds it deployed;
 * its parameters. Older and newer runs (of those that concern the env) are a click away.
 */
export const runPageLines = (input: DetailInput, env: string, target: Target): Line[] => {
  const { step, history: stepHistory, job, run, context } = resolveTarget(input, env, target);
  if (!step || !stepHistory || !job || !run) return missingPage(input, `#${target.run}`);
  const { history, branch } = input;
  const runs = runsFor(step, job, context);
  const older = neighbour(runs, run, 1);
  const newer = neighbour(runs, run, -1);
  const lines: Line[] = [
    heading(`${job.job} ${run.label}`, input.width, run.url),
    [
      { text: `${RUN_ICON[run.state]} ${run.state}`, role: RUN_ROLE[run.state], bold: true },
      { text: `   started ${when(run.at)}`, role: 'text' },
      ...(run.durationMs !== undefined
        ? [{ text: ` · took ${duration(run.durationMs)}`, role: 'text' } as Segment]
        : []),
      ...(run.actor
        ? [{ text: ` · by ${run.actor.name ?? run.actor.login}`, role: 'text' } as Segment]
        : []),
    ],
    [
      { text: 'branch ', role: 'muted' },
      {
        text: run.branch ?? '—',
        role: run.branch && run.branch === branch ? 'accent' : 'text',
        bold: true,
      },
      ...(run.sha
        ? [
            { text: '   commit ', role: 'muted' } as Segment,
            commitLink(
              run.sha,
              context,
              Object.values(history?.branches ?? {})
                .flat()
                .flatMap((item) => item.jobs)
                .flatMap((item) => item.runs)
                .find((commit) => commit.sha === run.sha)?.url,
            ),
          ]
        : []),
    ],
    ...(run.detail ? [[{ text: run.detail, role: 'text' } as Segment]] : []),
    [
      { text: '↗ open on the server', role: 'accent', url: run.url },
      { text: '    ' },
      ...(older
        ? [
            { text: '‹ older ', role: 'muted' } as Segment,
            { text: older.label, role: 'accent', to: toRun(step.id, job.job, older.id) } as Segment,
          ]
        : [{ text: '‹ oldest read', role: 'muted' } as Segment]),
      { text: '   ' },
      ...(newer
        ? [
            { text: 'newer ', role: 'muted' } as Segment,
            { text: newer.label, role: 'accent', to: toRun(step.id, job.job, newer.id) } as Segment,
            { text: ' ›', role: 'muted' } as Segment,
          ]
        : [{ text: 'newest ›', role: 'muted' } as Segment]),
    ],
    [],
  ];

  //? Where it stands for the env: on it now, or what replaced it; a build, its newer good ones
  const onEnv = runOnEnv(step, stepHistory.jobs, context);
  const cell = cellOf(context.row, step);
  if (onEnv?.run === run) lines.push([{ text: `◀ what ${env} runs now`, role: 'ok', bold: true }]);
  else if (cell || onEnv)
    lines.push([
      { text: `not on ${env} now — it runs `, role: 'warn' },
      ...(onEnv
        ? compactRun(onEnv.run, { branch, to: toRun(step.id, onEnv.job.job, onEnv.run.id) })
        : [{ text: cell?.latest.summary ?? '—', role: 'text', url: cell?.latest.url } as Segment]),
    ]);
  if (history?.shared.some((entry) => entry.step.id === step.id)) {
    const newerGood = runs.filter(
      (item) => item.state === 'success' && Number(item.id) > Number(run.id),
    );
    if (newerGood.length)
      lines.push([
        {
          text: `${newerGood.length} newer good build${newerGood.length === 1 ? '' : 's'} of ${run.branch ?? 'its branch'} — newest `,
          role: 'warn',
        },
        {
          text: newerGood[0]?.label ?? '',
          role: 'accent',
          to: newerGood[0] && toRun(step.id, job.job, newerGood[0].id),
        },
        { text: ` ${age(newerGood[0]?.at)} ago`, role: 'muted' },
      ]);
  }

  //? A deploy: the builds it put on the env
  const versions = versionsOf(step, run).filter((version) => version.value);
  if (versions.length) {
    lines.push([], subheading('With builds'));
    for (const version of versions) {
      const build =
        version.number === undefined
          ? undefined
          : findBuild(history, version.stepId, version.number);
      lines.push([
        { text: `  ${version.stepId.padEnd(16)} `, role: 'muted' },
        build
          ? ({
              text: build.run.label,
              role: 'accent',
              url: build.run.url,
              to: toRun(version.stepId, build.job.job, build.run.id),
            } as Segment)
          : ({ text: version.value ?? '', role: 'text' } as Segment),
        ...(build
          ? [
              { text: ` ${RUN_ICON[build.run.state]}`, role: RUN_ROLE[build.run.state] } as Segment,
              { text: `  ${build.run.branch ?? ''}`, role: 'text' } as Segment,
              {
                text: build.run.at ? `  ${shortStamp(build.run.at)}` : '',
                role: 'muted',
              } as Segment,
            ]
          : [{ text: '  older than the builds read', role: 'muted' } as Segment]),
      ]);
    }
  }

  const params = Object.entries(run.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (params.length) {
    const keyWidth = Math.min(28, Math.max(...params.map(([key]) => key.length)));
    lines.push(
      [],
      subheading('Parameters'),
      ...params.map(([key, value]): Line => [
        { text: `  ${key.padEnd(keyWidth)}  `, role: 'muted' },
        { text: value || '""', role: value ? 'text' : 'muted' },
      ]),
    );
  }
  lines.push([]);
  return lines;
};
