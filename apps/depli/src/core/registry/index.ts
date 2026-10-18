import type { DepliProjectConfig, ProviderConfig } from '../../config/project';
import githubPlugin from '../../plugins/github';
import jenkinsPlugin from '../../plugins/jenkins';
import { saveEnv } from '../envSet';
import type { PluginContext, ProviderPlugin, Transport } from '../plugin';

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
  for (const step of config.pipeline ?? []) {
    const provider = providers.find((entry) => entry.name === step.provider);
    if (!provider) problems.push(`pipeline.${step.id}: no provider "${step.provider}"`);
    else if (!provider.plugin.steps[step.kind])
      problems.push(`pipeline.${step.id}: ${provider.plugin.id} has no step kind "${step.kind}"`);
  }
  return { dir, config, providers, problems };
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
