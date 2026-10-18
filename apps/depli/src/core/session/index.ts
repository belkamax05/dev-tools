import { loadProjectConfig } from '../../config/project';
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

/** Load the project, its saved pick and env, and the checkout's branch. */
export const openSession = async (env: Env = process.env): Promise<Session> => {
  const loaded = await loadProjectConfig(undefined, env);
  const project = resolveProject(loaded.dir, loaded.config);
  if (loaded.error) project.problems.unshift(`${loaded.path}: ${loaded.error}`);
  const saved = (await stateStore.load()).projects[project.dir] ?? {};
  const current = project.config.repo?.path
    ? await currentBranch(project.config.repo.path)
    : undefined;
  const { branch, selection } = resolveSelection(saved);
  const envIds = (project.config.envs ?? []).map((entry) => entry.id);
  const targetEnv =
    saved.env && envIds.includes(saved.env)
      ? saved.env
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
      timingsExpanded: saved.timingsExpanded === true,
      otherRunsExpanded: saved.otherRunsExpanded ?? {},
      connections: saved.connections ?? {},
    },
  };
};

/** Remember the pick and env for this project. */
export const saveSession = async (session: Pick<Session, 'project' | 'state'>) => {
  const projectDir = session.project.dir;
  const projectState = { ...session.state };
  await updateState((state) => ({
    ...state,
    projects: { ...state.projects, [projectDir]: projectState },
  }));
};
