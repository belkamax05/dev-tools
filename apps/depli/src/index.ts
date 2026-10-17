/**
 * depli as a library — for writing a plugin or a `depli.config.ts`. Nothing here imports React or
 * Ink.
 *
 * ```ts
 * // depli.config.ts
 * import { defineConfig, definePlugin } from '@/dev-tools/depli/index';
 *
 * export default defineConfig({
 *   targets: { jenkins: { url: 'https://jenkins.example.com', job: 'web/job/deploy' } },
 *   plugins: [definePlugin({ id: 'netlify', … })],
 * });
 * ```
 */
export { type DepliProjectConfig, defineConfig, loadProjectConfig } from './config/project';
export {
  type DeployCheck,
  type DeployContext,
  type DeployPlugin,
  type DeployResult,
  definePlugin,
  envCheck,
} from './core/plugin';
export { BUILTIN_PLUGINS, checkTarget, resolveTargets, type Target } from './core/registry';
export { type GithubOptions, githubPlugin } from './plugins/github';
export { type JenkinsOptions, jenkinsPlugin } from './plugins/jenkins';
