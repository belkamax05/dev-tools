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
depli environments                             # dashboard on the Environments window (dfs environments)
depli status [--branch=B] [--env=E] [--json]   # the chain, and what is recommended next
depli probe [--json]                           # each provider's transports, probed
depli list-branches [glob…] [--json]           # branches.recent (else the watch list) by default
depli where [--json]                           # what every env runs now
depli plan <step> [--branch=B] [--env=E]       # dry run of one step's trigger
depli trigger <step> … --yes [--confirm-env=E] # refused unless triggers.enabled
depli be [command…]  |  depli … --flow=be      # a flow of a multi-flow config (see Flows)
```

## Tabs and keys

| Tab | |
| --- | --- |
| 🚀 Chain | the chain once, as a graph: one box per step, steps that wait on the same steps side by side (they can run in parallel — both builds), connectors fanning out and back in. `↑`/`↓` between levels, `←`/`→` between parallel steps, click a box; each box shows when it last did its job. `← next` marks every step that can run now, `n` cycles through them. **Environments**: closed by default — one line with the env chosen and what it runs; `e` (or a click) opens a table above both panels on the env chosen: every env, its tags (`current`, `protected`, and for the selected branch `yours`, or `behind` when the branch has newer builds — all that apply), the branch on it, the build numbers (`#deployed→#latest` when behind), when it was deployed and when the other steps last ran (local time and how long ago), with the columns named and a legend under them. Each `e` moves on to the next env (`↑`/`↓` too); Enter (or a click) picks the env under the cursor and closes it, saving the pick; Esc closes it and keeps the env it had. Closed, `]` next and `[` previous switch env without opening it. **Branch picker**: `b` (or the branch under the tabs) turns the whole tab into the branch list with the filter open — the newest branches on GitHub (`branches.recent`, else the watched ones), never local ones; `/` fuzzy filter as you type (`r2616` → `release-26.16`, searching every branch), `a` all / recent, Enter picks and returns to the chain, Esc goes back unchanged. Detail: the last good run's time first, then who did it (who pushed — from GitHub's activity log, so the pusher or merger rather than the commit's author — or who started the build), `o` open the step, `O` its last run, `c` copy the dry run as curl (variable names only), Enter dry run; clickable links and runs; a strip of recent runs (colour = result, length = duration); the pusher's avatar |
| | `l` swaps the detail for the selected step's **logs** (open by default while the step is running, otherwise closed): highlighted — errors, warnings, success, commands (`+ cmd`), Jenkins `[Pipeline]` structure, Actions groups — and following the tail of a live Jenkins build, read incrementally every 3s. the mouse wheel, `j`/`k`, `Space`/PgDn / PgUp (or Ctrl+d / Ctrl+u, Shift+↑/↓) scroll, with a scrollbar beside the lines; `G` follows again, `g` top, `,` / `.` older / newer run. GitHub serves a job's log once it has finished; the pane keeps polling until then. Skipped checks appear after jobs with logs and explicitly say they were skipped; whole workflow runs only as a zip, so those link to the browser |
| 🔌 Connections | per provider: **Auto** (the first transport that works — only one is needed), each transport, and for SSH each key. The detail says how it connects (remote, host alias, agent, key offered/accepted; token source and scopes), why it fails and how to fix it, and a setup guide (`g`). `Enter` picks: Auto, a pinned transport, or one SSH key — remembered per project. The cursor on a key tests it (`T` again); `o` opens the fix link; `P` probes now. A recommended way in that is not working offers a guided setup in its own panel (`L`): GitHub runs `gh auth login` for you (a code to type on github.com); Jenkins asks for your user id and an API token and stores them with the project's `envSet` command — `dfs env set` here, `envi set` otherwise — then uses them at once |
| 🔧 Settings | theme, the two files, reset |

Everywhere: `1-3`/`Tab` switch tab, `E` (or the footer's **Environments** button) the Environments window, `f` (or the footer's **Flow** button) the next flow of a multi-flow config, `F` (a flow with `linkedBranches`, e.g. **FE branch**) change the linked branch, `r` refresh, `B` back to the checkout's branch, `t` theme, `q` quit. The row under the tabs is clickable: the flow (`⇄ fe [f] → be`) switches flow, a provider opens Connections, the branch the branch picker, the env the environments panel.

## Flows

One `depli.config.ts` can hold several deploy flows — `flows: { fe: {…}, be: {…} }`, each with its
own repo, branches, envs and pipeline. The top-level keys are shared: a flow's own keys replace
them, except `providers`, which are merged by name (a shared `jenkins`, a `github` per flow). One
flow is open at a time:

- in the dashboard, `f` switches to the next flow **in place** — no window: the session is read
  again for that flow and everything (chain, envs, connections) is about it. The flow open shows in
  the header and first on the row under the tabs;
- on the command line, `--flow=<id>` or the flow as the first word (`depli be`, `depli be status`)
  — on every command, `DEPLI_FLOW` too;
- otherwise the flow last switched to in the dashboard (per project), else `defaultFlow`, else the
  first.

Each flow keeps its own branch pick, env and connection choices (state key `<dir>#<flow>`); the
first flow takes over what was saved before the config had flows. An unknown flow is reported and
the default one opened. A launcher providing secrets (`dfs deploy`) gets every flow's variables.

**Linked branches** — a flow can use another flow's pick: `linkedBranches: { fe: { flow: 'fe',
label: 'FE branch' } }`. It shows on the Chain tab under the branch, read-only; `F` (the footer's
button, or a click on the row) opens that flow on its branch picker and comes back once one is
picked (Esc too). In the pipeline:

- `branchFrom: 'fe'` — the step runs on the linked branch, not the one picked here (blocked, saying
  so, while nothing is picked there);
- `observeOnly: true` — shown and compared, never triggered or recommended from this flow;
- Jenkins `linkedBranchParams: { FE_CODE_BRANCH: 'fe' }` — a param that sends it (`← fe branch`);
  every step's input also has `branches.fe` for a param function.

**Branches without a repository** — `branches: { provider: 'jenkins', source: { job, param },
custom: true }` lists the job's choice list for `param` plus the branches its recent builds were
for (newest build first, no commit). `custom` lets the picker take a typed name that is not listed
(`+ name`, last); a job whose choice list refuses it then offers **Add** before triggering — the
same fix as any refused branch, which Jenkins keeps for one build.

**Triggers** (only with `triggers.enabled`): whether the selected step can be sent is worked out as soon as it is selected (a dry run — reads only): the button reads `[T] Trigger…` when it can, and orange **⊘ Trigger blocked** with every reason under it (plus the step's `blockedHelp` from the project config when the target itself would refuse) when it cannot. When the target refuses a value it could be taught (a branch outside a Jenkins job's choice list), an **Add …** action — `A` — appears directly under the reason in the same group, labelled “Resolve before triggering”, with a shared-configuration notice. It offers to change the target: a red popover says exactly what changes and for how long, and clickable Apply and Cancel buttons confirm or dismiss it (Enter applies, Esc cancels). Applying is refused while triggers are off. The step is planned again afterwards; triggering still has its own confirmation. `T`, or the Trigger button, plans the request, shows it in a popover and asks to confirm — for a protected env by typing its name. With triggers off, `T` is not bound at all and the button says what blocks it. **Stop**: while a step is running and its plugin can stop runs (Jenkins jobs), the detail shows a framed red **■ Stop #N** button — `X` or a click — that aborts the running build after a confirmation (a protected env by typing its name); it is not shown otherwise, nor while triggers are off.

The entire Chain detail scrolls with the mouse wheel, `j`/`k` or Shift+↑/↓; PgUp/PgDn (or Space, Ctrl+u/Ctrl+d) page, and `g`/`G` go to the top/bottom. The detail and log scrollbars support dragging the thumb and clicking the track. A scrollbar shows the position; selecting another step resets it to the top. The Chain detail highlights each step’s produced values with their origin (from its log or derived from the build number). Parameters appear under the Trigger button before confirmation: values from earlier steps are highlighted and labelled `← step-id`; other values are labelled `← branch` or `← config`. Enter shows the request line and warnings without repeating the parameters.

A green `●` on the connector marks the completed boundary immediately before the recommended next step. Parallel builds share one marker at their common push junction; completed builds merge into one marker before deploy. If only one build remains, the marker appears on its own incoming connector.

**Job badges**: explicit status labels accompany their icons: red `⊘ Blocked`, blue `➜ Next`, orange `○ Never run`, `👁 Read-only`, and `… Checking`. Running jobs take priority and show an animated spinner with “Running”. Blocked takes priority over recommended. Status icons use larger pixel drawings when graphics are supported, with text fallbacks elsewhere. GitHub and Jenkins logos appear in the bottom-right corner; provider names appear only when their logo cannot be rendered.

**Graphics**: the graph and history strips are box-drawing characters in theme colours, so they sit on the app's own background everywhere; avatars (PNG, or JPEG through `jpeg-js` — what GitHub serves for uploaded photos) draw with kitty / sixel / iTerm2 where the terminal supports it (probed at start), half-block characters elsewhere.

## Environments window

`E` — the footer's **Environments** button, on every tab — opens it over the tab you are on; Esc
goes back there. `depli environments` (`dfs environments`, aliases `environment`, `envs`) starts the
dashboard on it.

- **The table**: the Chain tab's env picker, extended — every env with its tags, the branch on it,
  **TRACKS** (what it is meant to run, `envs[].branches`) right beside it, the build numbers, when it
  was deployed and when the other env steps last ran. An env running a branch outside its
  `branches` is tagged orange `off-track`. `↑`/`↓` moves; Enter (or a click on a row) makes it the env
  the chain shows.
- **Under it, the env at the cursor — pipeline and runs**: its site (`envs[].url`), what it tracks
  and runs, then the **pipeline as a graph** (the `after` relations) whose boxes say what each
  step means for *this* env, `◀ on ci` marking the run that is on it:
  - **push** (GitHub): the branch the env runs, its head commit, the commit(s) the env's builds
    were made from (`deployed 1a2b3c4d  2 commits behind head ← build-nginx #1008, build-nodejs
    #3257`, or `= head`), and the branch's newest commits;
  - **a build**: the build the env runs in full — branch, when, who, the commit — then how it stands
    among the builds of *that* branch (`2 newer good builds of release-26.14 — newest #3290`, or
    the newest good one), and that branch's newest builds only (other branches' numbers are not
    comparable), the deployed one always listed. A build older than the ones read says so;
  - **a deploy**: what it put on the env (branch), by which run and job (an `alsoDeployedBy` job is
    named), when and who, and the build numbers it runs; then each job with its tally and newest
    runs (`+` for an `alsoDeployedBy` job).

  Under the graph, **Runs**: one closed line per job (its tally and newest run) — the branch's
  commits too; opening it lists its runs by day — each day a fold of its own, the newest open —
  with number, result, time, duration, branch, the builds it deployed, who started it and, for a
  commit, its message. A click on a job or a day opens or closes it; `x` opens (or closes) every
  job. Job names, run numbers and commits are links: a click opens the page. `n`/`p` step through
  links and folds, `o` opens the link or toggles the fold focused (the env's latest deploy when
  nothing is), `w` the site. The wheel, `j`/`k`, PgUp/PgDn and `g`/`G` scroll it.
- **Open detailed**: while the window is open the same footer button reads **Open detailed**
  (`E`). It fills the whole terminal with two panels. On top: an overview table (each env's
  site, deploy run, deployer and deployed build numbers as links) and **Branches → envs** — a
  graph of every `envs[].branches` pattern fanning out to the envs that track it and the ones that
  run it now (an env tracking one branch and running another sits under both), every running
  branch no pattern covers. Under it, **tabs** —
  one page at a time, the chain's env open first:
  - **an env tab** (`envs` row): the same pipeline graph and job folds as the window, the builds'
    runs included;
  - **a job tab** (`jobs` row, one per step with jobs read — `deploy_frontend_only_{env}` is one
    tab): its runs alone, open by day. A build says which envs run which of its builds now
    (`#1008 → ci, uat3`), each run too (`→ on ci, uat3`); an env-scoped step lists its latest run
    on every env, then per env its jobs (`alsoDeployedBy` ones too) and their runs.

  `←`/`→` (`h`/`l`, or a click) switch tab; `Tab` moves the keys between the two panels (the
  focused one framed in the accent). `n`/`p` step through links and folds, Enter/`o` opens a link
  or toggles a fold, `x` opens or closes every job, `r` reads it all again, Esc closes it back to
  the window. Nothing under it can be clicked while it is open.

Runs come from the step plugin's `history`: Jenkins reads the last 100 builds of the step's job and
of every `alsoDeployedBy` job (one request each, with the commit each build checked out); GitHub
(`historyByBranch`) the 30 newest commits of every branch an env runs and of the branch shown —
API transport only. A step whose plugin has none is a box with no runs. Read-only, like everything outside the trigger gate.

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

`jenkins` — lists branches from a job's choice list (`branches.source`, see Flows). Step kind `job` also has `history` (the Environments window's runs). Transport `api` (`userEnv` + `tokenEnv`, basic auth; reachability is checked first,
so a VPN-only server reads as offline, not as an error). `ssh` is a reported slot, not used yet.
Step kind `job`: `job` (with `{env}`/`{branch}`), `branchParam`, `revisionRepo`, `versions`,
`versionFromLog` (a RegExp whose first group is what the build produced, read from its console —
e.g. the image tag it pushed; read once per build), `version` (the fallback rule when the log has no
match — plans using it are marked "derived — check"), `params` (values or functions of the step input — send every
parameter explicitly, job defaults are not trusted). Plans are checked against the job's parameters as Jenkins defines them now: a value outside a choice list blocks the trigger (Jenkins would answer 500 and start nothing), and a parameter not sent — Jenkins would use its default — is a warning. A refused send shows Jenkins' own reason.

A plugin of your own is an object with `id`, `transports` (each with a `probe`) and `steps` (each
with `status`, optionally `plan`, `send`, `latest` — the env matrix — and `history` — every job the
step reads and its recent runs, for the Environments window; `historyByBranch` when that depends on
the branch) — see `src/core/plugin`. Add it to the config's
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
  //? url: the env's site; branches: what it is meant to run (globs) — the Environments window
  //? relates branches to envs with them and tags an env running anything else off-track
  envs: [
    { id: 'qa', url: 'https://qa.example.com', branches: ['develop'] },
    { id: 'staging', protected: true, branches: ['release-*'] },
  ],
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
  // How guided setups store what they ask for (KEY=VALUE arguments); `envi set` when unset
  envSet: ['dfs', 'env', 'set'],
};
```

With flows, the same keys go per flow, and the shared ones stay at the top:

```ts
export default {
  providers: { jenkins: { plugin: 'jenkins', url: 'https://ci.example.com', userEnv: 'CI_USER', tokenEnv: 'CI_TOKEN' } },
  triggers: { enabled: false },
  flows: {
    fe: { label: 'Frontend', repo: { path: '~/code/fe' }, providers: { github: { plugin: 'github', repo: 'owner/fe' } }, envs: […], pipeline: […] },
    be: { label: 'Backend', repo: { path: '~/code/be' }, providers: { github: { plugin: 'github', repo: 'owner/be' } }, envs: […], pipeline: […] },
  },
  defaultFlow: 'fe',
};
```

The dfs repository's `depli.config.ts` is a full example: `fe` (GitHub push → two builds → frontend
deploy → propagate) and `be` (four GitLab-built backend jobs and fe's two builds for the FE branch,
in parallel → `deploy_environment_{env}` → full propagation), branches from Jenkins.

## Where settings are kept

`~/.config/depli/config.json` — the theme. State, in `~/.local/state/depli/state.json`: the last
tab and, per project (per flow, `<dir>#<flow>`), the env and the branch pick; per project folder,
the flow last switched to.

In Settings, the Files section exposes both **Settings in $EDITOR** and **State in $EDITOR**. Select a file to see its path and contents description; Enter opens it. Edits are reloaded when the dashboard returns.

**Jenkins stage timings**: selecting a Jenkins job shows a Timings subpanel (collapsed until first expanded) with elapsed time, estimated total time and approximate time remaining. Click its header or press `s` to expand or collapse the full scrollable stage breakdown inside that panel. The open/closed choice is remembered per project across navigation and app restarts. Overall estimates use whole-run wall-clock durations, so parallel stages are not double-counted. It refreshes every 3 seconds while active and shows each stage’s elapsed time, average from up to five earlier successful builds of the same job (across branches), and the time difference. The bar measures elapsed time against that average, not percentage completion. Stages not yet reported by Jenkins are inferred from the latest successful build and labelled pending. `l` switches to live logs and back. A completed build behind its preceding step is labelled `#build · Stale · Complete`; this indicates freshness only and does not add a deployment blocker. Stage timings require Jenkins Pipeline REST API; unavailable timings do not block logs or triggers.

**Other branches running**: for the selected Jenkins job, running builds on other branches appear above its Timings panel, even when the selected branch is idle. Each preview shows the branch, build number, explicit Running/Complete/Failed/Aborted status, elapsed time and estimate. Click a preview header to expand its stages; expansion choices are saved per project. The activity list refreshes every 5 seconds and finished builds disappear. Timings previews continue refreshing every 3 seconds while running.
