import { loadProjectConfig, resolveFlow } from '../../config/project';
import { type ProjectState, stateStore, updateState } from '../../config/settings';
import { currentBranch, resolveSelection } from '../branch';
import type { Env } from '../plugin';
import { type Project, resolveProject } from '../registry';

export interface Session {
  project: Project;
  path?: string;
  env: Env;
  /** The checkout's branch right now. */
  current?: string;
  /** The branch the app works on — the saved pick; undefined until one is made or read. */
  branch?: string;
  targetEnv: string;
  state: ProjectState;
}

/** Where a project's pick is saved: per flow (`dir#be`), as each has its own branches and envs. */
export const stateKey = (project: { dir: string; flow?: { id: string } }) =>
  project.flow ? `${project.dir}#${project.flow.id}` : project.dir;

/** The flow after the open one, in file order — what the dashboard's `f` switches to. */
export const nextFlow = (project: Pick<Project, 'flow'>): string | undefined => {
  if (!project.flow || project.flow.all.length < 2) return undefined;
  const { id, all } = project.flow;
  return all[(all.indexOf(id) + 1) % all.length];
};

/**
 * Load the project, its saved pick and env, and the checkout's branch.
 *
 * The flow of a multi-flow config: `flow` when given (the dashboard's switch), else
 * `DEPLI_FLOW` (`--flow=`), else the one last switched to, else the config's default.
 */
export const openSession = async (env: Env = process.env, flow?: string): Promise<Session> => {
  const loaded = await loadProjectConfig(undefined, env);
  const saved = await stateStore.load();
  const requested = flow ?? (env.DEPLI_FLOW ? undefined : saved.flows[loaded.dir]);
  //? Only the flow differs from what loading picked — the file is not read again
  const resolved =
    requested && loaded.flows.includes(requested) && requested !== loaded.flow
      ? { ...resolveFlow(loaded.raw, requested), error: undefined }
      : { config: loaded.config, flow: loaded.flow, label: loaded.flowLabel, error: loaded.error };
  const project = resolveProject(loaded.dir, resolved.config);
  if (resolved.flow)
    project.flow = { id: resolved.flow, label: resolved.label ?? resolved.flow, all: loaded.flows };
  if (resolved.error) project.problems.unshift(`${loaded.path}: ${resolved.error}`);
  //? The first flow takes over what was saved before the config had flows
  const savedFor = (flow?: string) =>
    saved.projects[stateKey({ dir: project.dir, flow: flow ? { id: flow } : undefined })] ??
    (flow === loaded.flows[0] ? saved.projects[project.dir] : undefined);
  const picked = savedFor(project.flow?.id) ?? {};
  //? Another flow's pick, read-only here — the backend deploys the frontend's branch too
  const linkedBranches = Object.entries(project.config.linkedBranches ?? {});
  if (linkedBranches.length)
    project.linked = Object.fromEntries(
      linkedBranches.map(([id, { flow, label }]) => {
        if (!loaded.flows.includes(flow))
          project.problems.push(`linkedBranches.${id}: no flow "${flow}"`);
        return [id, { flow, label: label ?? `${flow} branch`, branch: savedFor(flow)?.selected }];
      }),
    );
  const current = project.config.repo?.path
    ? await currentBranch(project.config.repo.path)
    : undefined;
  const { branch, selection } = resolveSelection(picked);
  const envIds = (project.config.envs ?? []).map((entry) => entry.id);
  const targetEnv =
    picked.env && envIds.includes(picked.env)
      ? picked.env
      : (project.config.defaultEnv ?? envIds[0] ?? '');
  return {
    project,
    path: loaded.path,
    env,
    current,
    branch,
    targetEnv,
    state: {
      ...selection,
      env: targetEnv,
      timingsExpanded: picked.timingsExpanded === true,
      otherRunsExpanded: picked.otherRunsExpanded ?? {},
      connections: picked.connections ?? {},
    },
  };
};

/** Remember the pick and env for this project (and flow). */
export const saveSession = async (session: Pick<Session, 'project' | 'state'>) => {
  const key = stateKey(session.project);
  const projectState = { ...session.state };
  await updateState((state) => ({
    ...state,
    projects: { ...state.projects, [key]: projectState },
  }));
};

/** Remember the flow open, so the next start opens it again (unless `--flow=` says otherwise). */
export const saveFlow = async (project: Pick<Project, 'dir' | 'flow'>) => {
  const { flow, dir } = project;
  if (!flow) return;
  await updateState((state) => ({ ...state, flows: { ...state.flows, [dir]: flow.id } }));
};
