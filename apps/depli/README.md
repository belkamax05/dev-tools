# depli

Deployments as a terminal dashboard, where every target — Jenkins, GitHub, anything else — is a
plugin with one small contract, so each is replaceable. **Template stage:** the plugins' checks
work, their `deploy` is not written yet.

```sh
depli                            # dashboard
depli targets|settings           # open it on a tab
depli list [--json]              # the targets here and whether each is ready
depli deploy <target> [--dry-run]
```

## Plugins

A plugin is an object with an `id`, a `check` (is everything it needs there?) and a `deploy`:

```ts
import { definePlugin, envCheck } from '@/dev-tools/depli/index';

export default definePlugin<{ site?: string }>({
  id: 'netlify',
  label: 'Netlify',
  icon: '🌐',
  description: 'Deploy a site',
  check: async ({ env, options }) => [envCheck(env, 'NETLIFY_TOKEN'), { label: 'Site', ok: !!options.site }],
  deploy: async ({ options, log, dryRun }) => ({ ok: true, message: `deployed ${options.site}` }),
});
```

Built in: `jenkins` and `github` (`src/plugins/`). A plugin reads only what its context gives it
— the project folder, the environment, its options — so a test or another tool can drive it.

## depli.config.ts

The nearest one at or above the cwd (or in `DEPLI_PROJECT_DIR`) configures the targets:

```ts
export default {
  targets: {
    jenkins: { url: 'https://jenkins.example.com', job: 'web/job/deploy', tokenEnv: 'MY_JENKINS_TOKEN' },
    github: { repo: 'owner/name', workflow: 'deploy.yml' },
  },
  plugins: [netlify],   // added — or replacing a built-in, by reusing its id
  disable: ['github'],  // built-ins not offered here
};
```

Secrets never go in it: a plugin names the variable (`tokenEnv`) and reads it from the
environment. Run depli under `envi use -- depli` to have envi's variables there.

## Where settings are kept

`~/.config/depli/config.json` — the theme. The last tab is state, in
`~/.local/state/depli/state.json`.
