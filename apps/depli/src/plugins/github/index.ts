import { type DeployCheck, definePlugin, envCheck } from '../../core/plugin';

export interface GithubOptions {
  /** `owner/name` */
  repo?: string;
  /** The workflow file to dispatch, e.g. `deploy.yml`. */
  workflow?: string;
  /** The ref it runs on; the current branch when unset. */
  ref?: string;
  /** The variable holding a token with `actions: write`. */
  tokenEnv?: string;
}

/** Template: checks are real, the deploy itself is not written yet. */
export const githubPlugin = definePlugin<GithubOptions>({
  id: 'github',
  label: 'GitHub',
  icon: '🐙',
  description: 'Dispatch a GitHub Actions workflow',
  check: async ({ env, options }) => {
    const tokenEnv = options.tokenEnv ?? 'GITHUB_TOKEN';
    const checks: DeployCheck[] = [envCheck(env, tokenEnv, 'Token')];
    checks.push({
      label: 'Repository',
      ok: Boolean(options.repo),
      detail: options.repo ?? 'set targets.github.repo in depli.config.ts',
    });
    checks.push({
      label: 'Workflow',
      ok: Boolean(options.workflow),
      detail: options.workflow ?? 'set targets.github.workflow in depli.config.ts',
    });
    return checks;
  },
  deploy: async ({ options, log, dryRun }) => {
    log(`${dryRun ? 'Would dispatch' : 'Dispatching'} ${options.workflow ?? '(no workflow)'}`);
    return { ok: false, message: 'The GitHub plugin is a template — deploy is not written yet' };
  },
});

export default githubPlugin;
