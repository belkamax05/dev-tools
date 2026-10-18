import exec from '@/dev-tools/utils/process/exec';

import { expandHome } from '../../config/project';
import {
  type BranchHead,
  definePlugin,
  matchesPatterns,
  type PluginContext,
  type StepActor,
  type StepRun,
  type StepStatus,
} from '../../core/plugin';
import { API_GUIDE, type GithubOptions, githubRequest, probeApi, splitRepo } from './api';
import { ghLoginSetup } from './ghLogin';
import { checkLog } from './logs';
import { headsSshCommand, probeSsh, SSH_GUIDE } from './ssh';

export type { GithubOptions };

/**
 * `git ls-remote` heads from the configured checkout — what the SSH transport can see — with
 * the SSH key picked in the Connections tab, when one was.
 */
const lsRemote = async (context: PluginContext<GithubOptions>, refs: string[] = []) => {
  const { cwd, options } = context;
  const ssh = await headsSshCommand(context);
  const result = await exec(
    [
      'git',
      '-C',
      expandHome(options.checkout ?? cwd),
      ...(ssh ? ['-c', `core.sshCommand=${ssh}`] : []),
      'ls-remote',
      '--heads',
      options.remote ?? 'origin',
      ...refs,
    ],
    {},
  );
  if (result.exitCode !== 0)
    throw new Error(
      result.stderr.split('\n').find((line) => line.trim()) || 'git ls-remote failed',
    );
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ref = ''] = line.split('\t');
      return { sha, name: ref.replace('refs/heads/', '') };
    });
};

interface RefsPage {
  data: {
    repository: {
      refs: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          name: string;
          target: { oid: string; committedDate?: string; messageHeadline?: string };
        }>;
      };
    };
  };
}

/** Every branch with its head commit's time, 100 per GraphQL page. */
const apiBranches = async ({ options, env }: PluginContext<GithubOptions>) => {
  const { owner, name } = splitRepo(options.repo);
  const heads: BranchHead[] = [];
  let after: string | null = null;
  do {
    const page: RefsPage = await githubRequest<RefsPage>(options, env, '/graphql', {
      query: `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){refs(refPrefix:"refs/heads/",first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{name target{oid ... on Commit{committedDate messageHeadline}}}}}}`,
      variables: { owner, name, after },
    });
    const refs = page.data.repository.refs;
    for (const node of refs.nodes) {
      heads.push({
        name: node.name,
        sha: node.target.oid,
        committedAt: node.target.committedDate,
        message: node.target.messageHeadline,
      });
    }
    after = refs.pageInfo.hasNextPage ? refs.pageInfo.endCursor : null;
  } while (after);
  return heads;
};

const runState = (status: string, conclusion: string | null): StepRun['state'] => {
  if (status === 'queued' || status === 'waiting' || status === 'pending') return 'queued';
  if (status !== 'completed') return 'running';
  if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral')
    return 'success';
  if (conclusion === 'cancelled') return 'aborted';
  return 'failure';
};

interface BranchResponse {
  commit: {
    sha: string;
    html_url: string;
    commit: { committer: { date: string }; author?: { name?: string }; message: string };
    author: { login?: string; avatar_url?: string } | null;
  };
}
interface CheckRunsResponse {
  check_runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    completed_at: string | null;
    started_at: string | null;
    html_url: string;
  }>;
}
interface PullsResponse
  extends Array<{
    number: number;
    title: string;
    html_url: string;
    base: { ref: string };
    draft: boolean;
  }> {}
interface ActivityResponse
  extends Array<{
    activity_type: string;
    after: string;
    timestamp: string;
    actor: { login: string; avatar_url?: string } | null;
  }> {}

/** The push (or merge) that made `head` the branch's head, else the commit's author. */
const actorOf = (head: BranchResponse, activity: ActivityResponse): StepActor | undefined => {
  const event = activity.find((item) => item.after === head.commit.sha) ?? undefined;
  if (event?.actor)
    return {
      login: event.actor.login,
      avatarUrl: event.actor.avatar_url,
      action: event.activity_type,
      at: Date.parse(event.timestamp),
    };
  const author = head.commit.author;
  return author
    ? {
        login: (author as { login?: string }).login ?? head.commit.commit.author?.name ?? '?',
        name: head.commit.commit.author?.name,
        avatarUrl: author.avatar_url,
        action: 'authored',
      }
    : undefined;
};

interface RunsResponse {
  workflow_runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
    head_sha: string;
  }>;
}

/**
 * The branch's head as the chain's checkpoint, with what GitHub is doing about it: the open PRs
 * from it, the head commit's check runs and the branch's latest Actions runs. Observe-only.
 */
const branchStatus = async (
  context: PluginContext<GithubOptions>,
  branch: string,
  transport: string | undefined,
): Promise<StepStatus> => {
  const { options, env } = context;
  if (transport === 'ssh') {
    const [head] = await lsRemote(context, [`refs/heads/${branch}`]);
    if (!head) return { state: 'missing', summary: `no branch ${branch} on the remote` };
    return {
      state: 'done',
      summary: `head ${head.sha.slice(0, 8)} (SSH: no commit time, checks or PRs)`,
      ref: { sha: head.sha },
      //? Built, not read: the commit page needs only the repo and the SHA (github.com only —
      //? an Enterprise apiUrl does not say where its web pages are)
      url:
        options.repo && !options.apiUrl
          ? `https://github.com/${options.repo}/commit/${head.sha}`
          : undefined,
      notes: [
        'Over SSH git sees only branch heads — checks, PRs and Actions runs (last run) need the API transport.',
      ],
    };
  }
  const path = `/repos/${options.repo}`;
  const encoded = encodeURIComponent(branch);
  let head: BranchResponse;
  try {
    head = await githubRequest<BranchResponse>(options, env, `${path}/branches/${encoded}`);
  } catch (error) {
    if ((error as { status?: number }).status === 404)
      return { state: 'missing', summary: `no branch ${branch} on GitHub` };
    throw error;
  }
  const { owner } = splitRepo(options.repo);
  const [checks, pulls, runs, activity] = await Promise.all([
    githubRequest<CheckRunsResponse>(
      options,
      env,
      `${path}/commits/${head.commit.sha}/check-runs?per_page=30`,
    ),
    githubRequest<PullsResponse>(options, env, `${path}/pulls?state=open&head=${owner}:${encoded}`),
    githubRequest<RunsResponse>(options, env, `${path}/actions/runs?branch=${encoded}&per_page=5`),
    //? Who pushed (or merged) — not the commit's author, who may be someone else entirely.
    //? Optional: a token without access to it just loses the name
    githubRequest<ActivityResponse>(
      options,
      env,
      `${path}/activity?ref=${encodeURIComponent(`refs/heads/${branch}`)}&per_page=10`,
    ).catch(() => [] as ActivityResponse),
  ]);
  const checkRuns: StepRun[] = checks.check_runs
    .map((run) => ({
      id: `check-${run.id}`,
      label: `check: ${run.name}`,
      state: runState(run.status, run.conclusion),
      at: Date.parse(run.completed_at ?? run.started_at ?? '') || undefined,
      durationMs: run.started_at
        ? Math.max(
            0,
            (run.completed_at ? Date.parse(run.completed_at) : Date.now()) -
              Date.parse(run.started_at),
          )
        : undefined,
      url: run.html_url,
      detail: run.conclusion === 'skipped' ? 'skipped' : undefined,
    }))
    .sort((a, b) => Number(a.detail === 'skipped') - Number(b.detail === 'skipped'));
  const actionRuns: StepRun[] = runs.workflow_runs
    .filter((run) => run.head_sha !== head.commit.sha || !checkRuns.length)
    .map((run) => ({
      id: `run-${run.id}`,
      label: `action: ${run.name}`,
      state: runState(run.status, run.conclusion),
      at: Date.parse(run.created_at),
      durationMs:
        (run.status === 'completed' ? Date.parse(run.updated_at) : Date.now()) -
        Date.parse(run.created_at),
      url: run.html_url,
      detail: run.head_sha === head.commit.sha ? 'head' : `at ${run.head_sha.slice(0, 8)}`,
    }));
  const committedAt = Date.parse(head.commit.commit.committer.date);
  const running = checkRuns.some((run) => run.state === 'running' || run.state === 'queued');
  const failed = checkRuns.filter((run) => run.state === 'failure');
  return {
    state: running ? 'running' : failed.length ? 'failed' : 'done',
    summary: `head ${head.commit.sha.slice(0, 8)} · ${head.commit.commit.message.split('\n')[0]}`,
    ref: { sha: head.commit.sha, finishedAt: committedAt },
    url: head.commit.html_url,
    actor: actorOf(head, activity),
    runs: [...checkRuns, ...actionRuns],
    notes: [
      ...(failed.length
        ? [`failing checks: ${failed.map((run) => run.label.slice(7)).join(', ')}`]
        : []),
      ...(pulls.length
        ? pulls.map(
            (pr) => `PR #${pr.number} → ${pr.base.ref}${pr.draft ? ' (draft)' : ''}: ${pr.title}`,
          )
        : ['no open PR from this branch']),
    ],
  };
};

export const githubPlugin = definePlugin<GithubOptions>({
  id: 'github',
  label: 'GitHub',
  icon: '🐙',
  transports: [
    {
      id: 'api',
      label: 'API (token / gh login)',
      capabilities: ['heads', 'commits', 'checks', 'pulls', 'runs'],
      guide: API_GUIDE,
      recommended: true,
      setup: ghLoginSetup,
      probe: ({ options, env }) => probeApi(options, env),
    },
    {
      id: 'ssh',
      label: 'SSH (git ls-remote)',
      capabilities: ['heads'],
      guide: SSH_GUIDE,
      choiceLabel: 'SSH key',
      probe: probeSsh,
    },
  ],
  steps: {
    branch: {
      status: (context, input) =>
        branchStatus(context, input.branch, context.connection?.transport),
      logs: ({ options, env }, _input, run) => checkLog(options, env, run),
    },
  },
  branches: async (context, connection, patterns) => {
    const all =
      connection.transport === 'api' ? await apiBranches(context) : await lsRemote(context);
    return patterns.length ? all.filter((head) => matchesPatterns(head.name, patterns)) : all;
  },
});

export default githubPlugin;
