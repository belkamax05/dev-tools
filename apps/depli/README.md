# depli

A deploy chain as a terminal dashboard — push → build → deploy → whatever comes after — read live
from the systems that run it, with the next step recommended. Every system is a *provider
plugin* (GitHub and Jenkins ship built in), so each one is replaceable; a project's
`depli.config.ts` says which instances to use and what its pipeline is.

**Triggering is gated.** Every step's trigger is shown as a dry run — the exact request, every
parameter spelled out — and nothing is sent unless `triggers.enabled` is on in the project config,
the trigger is confirmed, and a protected env is confirmed by its own name.

```sh
depli                            # dashboard
depli chain|connections|settings
depli status [--branch=B] [--env=E] [--json]   # the chain, and what is recommended next
depli probe [--json]                           # each provider's transports, probed
depli list-branches [glob…] [--json]           # branches.recent (else the watch list) by default
depli where [--json]                           # what every env runs now
depli plan <step> [--branch=B] [--env=E]       # dry run of one step's trigger
depli trigger <step> … --yes [--confirm-env=E] # refused unless triggers.enabled
```

## Tabs and keys

| Tab | |
| --- | --- |
| 🚀 Chain | the chain once, as a graph: one box per step, steps that wait on the same steps side by side (they can run in parallel — both builds), connectors fanning out and back in. `↑`/`↓` between levels, `←`/`→` between parallel steps, click a box; each box shows when it last did its job. `← next` marks every step that can run now, `n` cycles through them. **Environments**: closed by default — one line with the env chosen and what it runs; `E` (or a click) opens a panel above both panels with every env, what each runs (deploy state, branch, build numbers, age, the other steps' ages), the selected branch's rows `yours`, `behind` when it has newer builds; `↑`/`↓` and Enter (or a click) pick one and close it again, Esc closes; the pick is saved. `e`/`]` next, `[` previous. **Branch picker**: `b` (or the branch under the tabs) turns the whole tab into the branch list with the filter open — the newest branches on GitHub (`branches.recent`, else the watched ones), never local ones; `/` fuzzy filter as you type (`r2616` → `release-26.16`, searching every branch), `a` all / recent, Enter picks and returns to the chain, Esc goes back unchanged. Detail: the last good run's time first, then who did it (who pushed — from GitHub's activity log, so the pusher or merger rather than the commit's author — or who started the build), `o` open the step, `O` its last run, `c` copy the dry run as curl (variable names only), Enter dry run; clickable links and runs; a strip of recent runs (colour = result, length = duration); the pusher's avatar |
| | `l` swaps the detail for the selected step's **logs** (open by default while the step is running, otherwise closed): highlighted — errors, warnings, success, commands (`+ cmd`), Jenkins `[Pipeline]` structure, Actions groups — and following the tail of a live Jenkins build, read incrementally every 3s. the mouse wheel, `j`/`k`, `Space`/PgDn / PgUp (or Ctrl+d / Ctrl+u, Shift+↑/↓) scroll, with a scrollbar beside the lines; `G` follows again, `g` top, `,` / `.` older / newer run. GitHub serves a job's log once it has finished; the pane keeps polling until then. Skipped checks appear after jobs with logs and explicitly say they were skipped; whole workflow runs only as a zip, so those link to the browser |
| 🔌 Connections | per provider: **Auto** (the first transport that works — only one is needed), each transport, and for SSH each key. The detail says how it connects (remote, host alias, agent, key offered/accepted; token source and scopes), why it fails and how to fix it, and a setup guide (`g`). `Enter` picks: Auto, a pinned transport, or one SSH key — remembered per project. The cursor on a key tests it (`T` again); `o` opens the fix link; `P` probes now |
| 🔧 Settings | theme, the two files, reset |

Everywhere: `1-3`/`Tab` switch tab, `r` refresh, `B` back to the checkout's branch, `t` theme, `q` quit. The row under the tabs is clickable: a provider opens Connections, the branch the branch picker, the env the environments panel.

**Triggers** (only with `triggers.enabled`): whether the selected step can be sent is worked out as soon as it is selected (a dry run — reads only): the button reads `[T] Trigger…` when it can, and orange **⊘ Trigger blocked** with every reason under it (plus the step's `blockedHelp` from the project config when the target itself would refuse) when it cannot. When the target refuses a value it could be taught (a branch outside a Jenkins job's choice list), an **Add …** action — `A` — appears directly under the reason in the same group, labelled “Resolve before triggering”, with a shared-configuration notice. It offers to change the target: a red popover says exactly what changes and for how long, and clickable Apply and Cancel buttons confirm or dismiss it (Enter applies, Esc cancels). Applying is refused while triggers are off. The step is planned again afterwards; triggering still has its own confirmation. `T`, or the Trigger button, plans the request, shows it in a popover and asks to confirm — for a protected env by typing its name. With triggers off, `T` is not bound at all and the button says what blocks it. **Stop**: while a step is running and its plugin can stop runs (Jenkins jobs), the detail shows a framed red **■ Stop #N** button — `X` or a click — that aborts the running build after a confirmation (a protected env by typing its name); it is not shown otherwise, nor while triggers are off.

The entire Chain detail scrolls with the mouse wheel, `j`/`k` or Shift+↑/↓; PgUp/PgDn (or Space, Ctrl+u/Ctrl+d) page, and `g`/`G` go to the top/bottom. The detail and log scrollbars support dragging the thumb and clicking the track. A scrollbar shows the position; selecting another step resets it to the top. The Chain detail highlights each step’s produced values with their origin (from its log or derived from the build number). Parameters appear under the Trigger button before confirmation: values from earlier steps are highlighted and labelled `← step-id`; other values are labelled `← branch` or `← config`. Enter shows the request line and warnings without repeating the parameters.

A green `●` on the connector marks the completed boundary immediately before the recommended next step. Parallel builds share one marker at their common push junction; completed builds merge into one marker before deploy. If only one build remains, the marker appears on its own incoming connector.

**Job badges**: explicit status labels accompany their icons: red `⊘ Blocked`, blue `➜ Next`, orange `○ Never run`, `👁 Read-only`, and `… Checking`. Running jobs take priority and show an animated spinner with “Running”. Blocked takes priority over recommended. Status icons use larger pixel drawings when graphics are supported, with text fallbacks elsewhere. GitHub and Jenkins logos appear in the bottom-right corner; provider names appear only when their logo cannot be rendered.

**Graphics**: the graph and history strips are box-drawing characters in theme colours, so they sit on the app's own background everywhere; avatars (PNG, or JPEG through `jpeg-js` — what GitHub serves for uploaded photos) draw with kitty / sixel / iTerm2 where the terminal supports it (probed at start), half-block characters elsewhere.

## How steps compare

A step compares itself with the steps it lists in `after`, as precisely as the data allows:

1. **by commit** — a build's checked-out SHA (`revisionRepo`) against the push's head SHA;
2. **by artifact** — a deploy's version params (`versions`) end in a build number, compared with
   that build step's last good build;
3. **by time** — otherwise, the last good run finished after the step before it.

Every `stale` (or never-run) step whose upstream is all `done` is recommended — several at once when they can run in parallel.

## Branch selection

The branch is the last one picked, saved per project; the local checkout (`repo.path`) never
preselects or resets it — it is only shown, and `B` jumps to it. With nothing picked yet, the app
starts on the newest branch of the list. The list is read from the provider (GitHub), newest
commit first: with `branches.recent`, its `required` branches always, at least `count` of each
`atLeast` group, then the newest others up to `limit` (default 12); without it, the `watch`
globs. The branch shown always stays listed. In the picker the cursor starts on it.

## Providers

`github` — transports `api` (a token variable, else the `gh` CLI's login: heads, commit times,
check runs, PRs, Actions runs) then `ssh` (`git ls-remote` from `checkout`: heads only). Step kind
`branch`, observe-only.

`jenkins` — transport `api` (`userEnv` + `tokenEnv`, basic auth; reachability is checked first,
so a VPN-only server reads as offline, not as an error). `ssh` is a reported slot, not used yet.
Step kind `job`: `job` (with `{env}`/`{branch}`), `branchParam`, `revisionRepo`, `versions`,
`versionFromLog` (a RegExp whose first group is what the build produced, read from its console —
e.g. the image tag it pushed; read once per build), `version` (the fallback rule when the log has no
match — plans using it are marked "derived — check"), `params` (values or functions of the step input — send every
parameter explicitly, job defaults are not trusted). Plans are checked against the job's parameters as Jenkins defines them now: a value outside a choice list blocks the trigger (Jenkins would answer 500 and start nothing), and a parameter not sent — Jenkins would use its default — is a warning. A refused send shows Jenkins' own reason.

A plugin of your own is an object with `id`, `transports` (each with a `probe`) and `steps` (each
with `status`, optionally `plan` and `send`) — see `src/core/plugin`. Add it to the config's
`plugins`; reusing a built-in's id replaces it.

## depli.config.ts

The nearest one at or above the cwd (or in `DEPLI_PROJECT_DIR`). Secrets never go in it:
providers name the variables, read from the environment — run depli under `envi use -- depli`.

```ts
export default {
  repo: { path: '~/code/app' },
  branches: { watch: ['main', 'release-*', '!release-old-*'], provider: 'github' },
  providers: {
    github: { plugin: 'github', repo: 'owner/app', checkout: '~/code/app' },
    jenkins: { plugin: 'jenkins', url: 'https://ci.example.com', userEnv: 'CI_USER', tokenEnv: 'CI_TOKEN' },
  },
  envs: [{ id: 'qa' }, { id: 'staging', protected: true }],
  defaultEnv: 'qa',
  pipeline: [
    { id: 'push', label: 'Push', provider: 'github', kind: 'branch' },
    { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job', job: 'build',
      branchParam: 'BRANCH', revisionRepo: 'owner/app', after: ['push'],
      version: ({ buildNumber }) => `1.0.${buildNumber}` },
    { id: 'deploy', label: 'Deploy to {env}', provider: 'jenkins', kind: 'job', job: 'deploy_{env}',
      branchParam: 'BRANCH', versions: { VERSION: 'build' }, after: ['build'] },
  ],
  triggers: { enabled: false },
  pollSeconds: 30,
};
```

## Where settings are kept

`~/.config/depli/config.json` — the theme. State, in `~/.local/state/depli/state.json`: the last
tab and, per project, the env and the branch pick.

In Settings, the Files section exposes both **Settings in $EDITOR** and **State in $EDITOR**. Select a file to see its path and contents description; Enter opens it. Edits are reloaded when the dashboard returns.

**Jenkins stage timings**: selecting a Jenkins job shows a Timings subpanel (collapsed until first expanded) with elapsed time, estimated total time and approximate time remaining. Click its header or press `s` to expand or collapse the full scrollable stage breakdown inside that panel. The open/closed choice is remembered per project across navigation and app restarts. Overall estimates use whole-run wall-clock durations, so parallel stages are not double-counted. It refreshes every 3 seconds while active and shows each stage’s elapsed time, average from up to five earlier successful builds of the same job (across branches), and the time difference. The bar measures elapsed time against that average, not percentage completion. Stages not yet reported by Jenkins are inferred from the latest successful build and labelled pending. `l` switches to live logs and back. A completed build behind its preceding step is labelled `#build · Stale · Complete`; this indicates freshness only and does not add a deployment blocker. Stage timings require Jenkins Pipeline REST API; unavailable timings do not block logs or triggers.

**Other branches running**: for the selected Jenkins job, running builds on other branches appear above its Timings panel, even when the selected branch is idle. Each preview shows the branch, build number, explicit Running/Complete/Failed/Aborted status, elapsed time and estimate. Click a preview header to expand its stages; expansion choices are saved per project. The activity list refreshes every 5 seconds and finished builds disappear. Timings previews continue refreshing every 3 seconds while running.
