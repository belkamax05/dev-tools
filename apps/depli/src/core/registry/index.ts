import type {
  DepliProjectConfig,
  PickDefaultInput,
  ProviderConfig,
  SuggestSource,
} from '../../config/project';
import githubPlugin from '../../plugins/github';
import jenkinsPlugin from '../../plugins/jenkins';
import { saveEnv } from '../envSet';
import type {
  PluginContext,
  ProviderPlugin,
  StepConfig,
  StepInput,
  Transport,
} from '../plugin';

/** What ships with depli. Each is an ordinary plugin — nothing here is special-cased. */
export const BUILTIN_PLUGINS: readonly ProviderPlugin<any>[] = [githubPlugin, jenkinsPlugin];

/** One provider instance of the project: its name in config, the plugin, its options. */
export interface Provider {
  name: string;
  plugin: ProviderPlugin<any>;
  options: ProviderConfig;
  /** The plugin's transports in the order this instance prefers them. */
  transports: Transport<any>[];
  /** Transport ids the config switched off — listed, never probed or used. */
  disabled?: string[];
}

export interface Project {
  dir: string;
  /** The flow open, of a multi-flow config (`flows`) — its id and label, and every flow id. */
  flow?: { id: string; label: string; all: string[] };
  /** `linkedBranches`, with what each other flow has picked (undefined: nothing yet). */
  linked?: Record<string, { flow: string; label: string; branch?: string }>;
  /** `picks`, with what was picked (undefined: the pick's default is used). */
  picks?: Record<string, { label: string; value?: string }>;
  config: DepliProjectConfig;
  providers: Provider[];
  /** Config mistakes, reported in the UI rather than thrown. */
  problems: string[];
}

export const resolveProject = (dir: string, config: DepliProjectConfig): Project => {
  const plugins = new Map<string, ProviderPlugin<any>>();
  for (const plugin of [...BUILTIN_PLUGINS, ...(config.plugins ?? [])])
    plugins.set(plugin.id, plugin);
  const problems: string[] = [];
  const providers: Provider[] = [];
  for (const [name, options] of Object.entries(config.providers ?? {})) {
    const plugin = plugins.get(options.plugin);
    if (!plugin) {
      problems.push(`providers.${name}: no plugin "${options.plugin}"`);
      continue;
    }
    const order = options.transports ?? plugin.transports.map((transport) => transport.id);
    const transports = order
      .map((id) => plugin.transports.find((transport) => transport.id === id))
      .filter((transport): transport is Transport<any> => Boolean(transport));
    const disabled = options.disabledTransports ?? [];
    for (const id of disabled)
      if (!plugin.transports.some((transport) => transport.id === id))
        problems.push(`providers.${name}.disabledTransports: ${plugin.id} has no transport "${id}"`);
    providers.push({ name, plugin, options, transports, disabled });
  }
  const checkSuggest = (where: string, suggest?: SuggestSource) => {
    if (!suggest) return;
    const provider = providers.find((entry) => entry.name === suggest.provider);
    if (!provider) problems.push(`${where}.suggest: no provider "${suggest.provider}"`);
    else if (!provider.plugin.suggestions)
      problems.push(`${where}.suggest: ${provider.plugin.id} cannot suggest`);
  };
  checkSuggest('branches', config.branches?.suggest);
  for (const [id, pick] of Object.entries(config.picks ?? {})) checkSuggest(`picks.${id}`, pick.suggest);
  for (const step of config.pipeline ?? []) {
    const provider = providers.find((entry) => entry.name === step.provider);
    if (!provider) problems.push(`pipeline.${step.id}: no provider "${step.provider}"`);
    else if (!provider.plugin.steps[step.kind])
      problems.push(`pipeline.${step.id}: ${provider.plugin.id} has no step kind "${step.kind}"`);
    if (step.branchFrom && !config.linkedBranches?.[step.branchFrom])
      problems.push(`pipeline.${step.id}: branchFrom "${step.branchFrom}" is not in linkedBranches`);
  }
  return { dir, config, providers, problems };
};

/**
 * A pick's value for a branch and env: the one picked, else its `default` (fixed, or worked out
 * from the branch). Undefined when it has neither.
 */
export const resolvePick = (
  project: Partial<Pick<Project, 'config' | 'picks'>>,
  id: string,
  input: PickDefaultInput,
): string | undefined => {
  const picked = project.picks?.[id]?.value;
  if (picked) return picked;
  const fallback = project.config?.picks?.[id]?.default;
  return (typeof fallback === 'function' ? fallback(input) : fallback) || undefined;
};

/**
 * What a step is given: its own branch — the one picked, or the linked branch it names in
 * `branchFrom` ('' when that has none yet) — and every linked branch by id.
 */
export const inputFor = (
  project: Pick<Project, 'linked'> & Partial<Pick<Project, 'config' | 'picks'>>,
  step: StepConfig,
  branch: string,
  env: string,
  upstream: StepInput['upstream'] = {},
): StepInput => {
  const branches = Object.fromEntries(
    Object.entries(project.linked ?? {}).flatMap(([id, linked]) =>
      linked.branch ? [[id, linked.branch]] : [],
    ),
  );
  const own = step.branchFrom ? (branches[step.branchFrom] ?? '') : branch;
  const picks = Object.fromEntries(
    Object.keys(project.config?.picks ?? {}).flatMap((id) => {
      const value = resolvePick(project, id, { branch: own, env });
      return value ? [[id, value]] : [];
    }),
  );
  return { step, branch: own, env, upstream, branches, picks };
};

/** Why a step cannot be read yet: its `branchFrom` names a linked branch nothing picked. */
export const missingLinkedBranch = (project: Pick<Project, 'linked'>, step: StepConfig) => {
  if (!step.branchFrom) return undefined;
  const linked = project.linked?.[step.branchFrom];
  if (!linked) return `branchFrom: no linked branch "${step.branchFrom}"`;
  return linked.branch
    ? undefined
    : `no ${linked.label} picked yet — [F] picks it (the ${linked.flow} flow's branches)`;
};

export const contextFor = (
  project: Project,
  provider: Provider,
  env: PluginContext['env'],
  connection?: PluginContext['connection'],
): PluginContext<any> => ({
  cwd: project.dir,
  env,
  options: provider.options,
  connection,
  choice: connection?.choice,
  setEnv: (vars) => saveEnv(project, env, vars),
});
