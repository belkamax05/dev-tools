import { type BranchHead, matchesPatterns } from '../../core/plugin';
import { buildParam, type JenkinsBuild } from './api';
import type { ParamDefinition } from './params';

/** `branches.source` for Jenkins: the job, and its parameter that holds the branch. */
export interface JenkinsBranchSource {
  job: string;
  param: string;
}

export const branchSourceOf = (source?: Record<string, unknown>): JenkinsBranchSource => {
  const job = source?.job;
  const param = source?.param;
  if (typeof job !== 'string' || typeof param !== 'string')
    throw new Error(
      "branches.source for Jenkins needs { job, param } — e.g. { job: 'build_ts-app', param: 'CODE_BRANCH' }",
    );
  return { job, param };
};

/**
 * A job's branches when no repository is read (the code lives where depli cannot see it): its
 * branch parameter's choice list, plus the branches its recent builds were for — one added for a
 * single build stays findable after the list is rewritten. Newest build first; listed choices
 * never built come last, in the list's order. `sha` is empty: there is no commit to read.
 */
export const jenkinsBranches = (
  definitions: readonly ParamDefinition[],
  builds: readonly JenkinsBuild[],
  { job, param }: JenkinsBranchSource,
  patterns: readonly string[] = [],
): BranchHead[] => {
  const choices = definitions.find((definition) => definition.name === param)?.choices ?? [];
  const newest = new Map<string, JenkinsBuild>();
  for (const build of builds) {
    const name = buildParam(build, param);
    const seen = name ? newest.get(name) : undefined;
    if (name && (!seen || build.timestamp > seen.timestamp)) newest.set(name, build);
  }
  const names = [...new Set([...choices, ...newest.keys()])].filter(
    (name) => !patterns.length || matchesPatterns(name, patterns),
  );
  const heads = names.map((name): BranchHead => {
    const build = newest.get(name);
    const listed = choices.includes(name);
    const result = build ? (build.building ? 'running' : (build.result?.toLowerCase() ?? '?')) : '';
    return {
      name,
      sha: '',
      committedAt: build ? new Date(build.timestamp).toISOString() : undefined,
      message: [
        build ? `${job} #${build.number} ${result}` : `never built by ${job} (of the builds kept)`,
        listed
          ? `one of ${param}'s choices`
          : `not in ${param}'s choices now — a trigger offers to add it, for one build`,
      ].join(' · '),
    };
  });
  return heads.sort(
    (a, b) =>
      (b.committedAt ?? '').localeCompare(a.committedAt ?? '') ||
      choices.indexOf(a.name) - choices.indexOf(b.name),
  );
};

/**
 * A job's choice list for one parameter, in the job's own order — the first is its default. What
 * the job's pipeline builds the list from (build-and-deploy's branch lists, say) is the
 * suggestion; each says when the job last ran with it, as `jenkinsBranches` does.
 */
export const jenkinsSuggestions = (
  definitions: readonly ParamDefinition[],
  builds: readonly JenkinsBuild[],
  source: JenkinsBranchSource,
): BranchHead[] => {
  const choices = definitions.find((definition) => definition.name === source.param)?.choices ?? [];
  const heads = jenkinsBranches(definitions, builds, source);
  return choices.flatMap((name, index) => {
    const head = heads.find((item) => item.name === name);
    if (!head) return [];
    return [{ ...head, message: `${index === 0 ? `${source.job}'s default · ` : ''}${head.message}` }];
  });
};
