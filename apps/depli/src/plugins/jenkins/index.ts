import { type DeployCheck, definePlugin, envCheck } from '../../core/plugin';

export interface JenkinsOptions {
  /** e.g. https://jenkins.example.com */
  url?: string;
  /** The job to trigger, as its path: `folder/job/name`. */
  job?: string;
  /** The Jenkins user the token belongs to. */
  user?: string;
  /** The variable holding the API token. */
  tokenEnv?: string;
}

/** Template: checks are real, the deploy itself is not written yet. */
export const jenkinsPlugin = definePlugin<JenkinsOptions>({
  id: 'jenkins',
  label: 'Jenkins',
  icon: '🤵',
  description: 'Trigger a Jenkins job with an API token',
  check: async ({ env, options }) => {
    const tokenEnv = options.tokenEnv ?? 'JENKINS_TOKEN';
    const checks: DeployCheck[] = [envCheck(env, tokenEnv, 'API token')];
    checks.push({
      label: 'Server URL',
      ok: Boolean(options.url),
      detail: options.url ?? 'set targets.jenkins.url in depli.config.ts',
    });
    checks.push({
      label: 'Job',
      ok: Boolean(options.job),
      detail: options.job ?? 'set targets.jenkins.job in depli.config.ts',
    });
    return checks;
  },
  deploy: async ({ options, log, dryRun }) => {
    log(`${dryRun ? 'Would trigger' : 'Triggering'} ${options.job ?? '(no job)'} on Jenkins`);
    return { ok: false, message: 'The Jenkins plugin is a template — deploy is not written yet' };
  },
});

export default jenkinsPlugin;
