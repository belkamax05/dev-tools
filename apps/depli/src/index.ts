/**
 * depli as a library — for writing a provider plugin or a `depli.config.ts`, or for reading a
 * chain from another tool. Nothing here imports React or Ink.
 *
 * ```ts
 * import { openSession, connectAll, evaluateChain } from '@/dev-tools/depli/index';
 *
 * const session = await openSession();
 * const connections = await connectAll(session.project, session.env);
 * const chain = await evaluateChain(session.project, connections, session.env, 'main', 'qa');
 * ```
 */
export {
  type DepliProjectConfig,
  defineConfig,
  type EnvConfig,
  loadProjectConfig,
  type ProviderConfig,
} from './config/project';
export { currentBranch, resolveSelection } from './core/branch';
export { type ChainStep, evaluateChain, stepsFor } from './core/chain';
export { connect, connectAll } from './core/connection';
export * from './core/plugin';
export { BUILTIN_PLUGINS, type Project, resolveProject } from './core/registry';
export { openSession, saveSession } from './core/session';
export { planTrigger, sendTrigger } from './core/trigger';
export { type GithubOptions, githubPlugin } from './plugins/github';
export { type JenkinsOptions, type JobStepOptions, jenkinsPlugin } from './plugins/jenkins';
