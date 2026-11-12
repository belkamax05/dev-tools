---
name: dev-tools-depli
description: Use depli (dev-tools) to read a deploy chain (push → build → deploy) live from GitHub and Jenkins, see what each environment runs, dry-run a step's trigger, and edit `depli.config.ts` (flows, envs, pipeline, providers, plugins). Trigger when asked what is deployed where, whether a branch is built/deployed, what to run next, to plan or trigger a deploy, to add an env or pipeline step, or to write a provider plugin.
---

# depli — deploy chain dashboard

`depli` lives in `apps/depli` (`bin/depli`). Every system is a provider plugin (GitHub and Jenkins
built in); a project's `depli.config.ts` names instances, envs and the pipeline.

## Hard rule: triggering is gated

Everything is read-only except `depli trigger`. It is refused unless `triggers.enabled` is on in
the project config, it is passed `--yes`, and a `protected` env is confirmed by name
(`--confirm-env=E`). **Never run `depli trigger`, never pass `--yes`/`--confirm-env`, and never
flip `triggers.enabled` unless the user explicitly asked for that specific deploy.** Use
`depli plan` to show what would be sent.

## Commands

```sh
depli status [--branch=B] [--env=E] [--json]   # chain state and recommended next step(s)
depli where [--json]                           # what every env runs now
depli list-branches [glob…] [--json]           # branches.suggest, else branches.recent, else watch
depli picks [--json]                           # values picked beside the branch, and suggestions
depli status|plan|trigger … --pick=<id>=<value> # a pick for this run only (not saved)
depli probe [--json]                           # each provider's transports (API/ssh reachability)
depli plan <step> [--branch=B] [--env=E]       # dry run: exact request, every param
depli trigger <step> … --yes [--confirm-env=E] # gated — see above
depli environments                             # dashboard on the Environments view
depli be status | depli status --flow=be       # pick a flow (also DEPLI_FLOW)
depli                                          # dashboard (chain|connections|settings tabs)
```

Prefer `--json` outputs for answering questions. A VPN-only Jenkins reads as *offline*, not an
error — say so rather than retrying.

## Secrets

Never in `depli.config.ts`. Providers name variables (`userEnv`, `tokenEnv`; GitHub falls back to
the `gh` login); run under envi: `envi use -- depli …` (dfs does this for you). `envSet` in the
config says how guided setups store values (`['dfs','env','set']`, default `envi set`).

## How it decides

Steps compare with the steps in `after`: by commit (`revisionRepo` SHA vs push head), by artifact
(`versions` params vs the build's number), else by time. A `stale`/never-run step whose upstream
is all `done` is recommended. An env running a branch outside its `envs[].branches` is
`off-track`.

## `depli.config.ts`

Nearest at/above cwd, or `DEPLI_PROJECT_DIR`. Key parts:

- `repo`, `branches` (`watch` globs or `recent: { required, atLeast, limit }`; or from a Jenkins
  choice list: `{ provider: 'jenkins', source: { job, param }, custom: true }`)
- `providers` — `{ plugin: 'github', repo, checkout }`, `{ plugin: 'jenkins', url, userEnv, tokenEnv }`
- `envs: [{ id, url, branches, protected }]`, `defaultEnv`
- `pipeline` steps: `id`, `label` (`{env}` allowed), `provider`, `kind` (`branch` | `job`), `after`,
  Jenkins `job`, `branchParam`, `revisionRepo`, `versions`, `versionFromLog`, `version`, `params`
  (send every param explicitly), `alsoDeployedBy`, `branchFrom`, `observeOnly`, `linkedBranchParams`
- `flows: { fe: {…}, be: {…} }` + `defaultFlow` — flow keys replace top-level ones, `providers`
  merge by name; `linkedBranches` lets a flow use another flow's branch pick
- `branches.suggest: { provider, source }` — the picker's list is that provider's suggestions in
  its order (Jenkins: a job's choice list, `{ job, param }`), with commits from the branch provider;
  `recent`/`watch` is the fallback
- `picks: { id: { label, hotkey, default, suggest, custom, description } }` — a value picked beside
  the branch (saved per flow; `default` fixed or `({ branch, env }) => …`); Jenkins steps send it
  with `pickParams: { PARAM: id }`, any step reads `input.picks[id]`
- `triggers: { enabled: false }`, `pollSeconds`, `plugins` (custom providers)

Plans are validated against Jenkins' current job parameters: a value outside a choice list blocks
the trigger; an unsent param is a warning.

## Custom provider plugin

Object with `id`, `transports` (each with `probe`) and `steps` (`status`, optional `plan`, `send`,
`latest`, `history`/`historyByBranch`), plus `commitUrl(options, sha)` for repo hosts. See
`src/core/plugin`; add to `plugins` (reusing a built-in id replaces it).

## State

`~/.config/depli/config.json` (theme); `~/.local/state/depli/state.json` (last tab, per project
and flow the env and branch pick, last flow).

## Changing depli

`src/run.ts` CLI, `src/core/*` (chain logic, `plugin`, `curl`), `src/plugins/{github,jenkins}`,
`src/ui/*`. Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint` from `apps/depli`; keep the
README in step.
