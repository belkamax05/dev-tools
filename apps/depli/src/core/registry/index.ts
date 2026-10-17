import type { DepliProjectConfig } from '../../config/project';
import githubPlugin from '../../plugins/github';
import jenkinsPlugin from '../../plugins/jenkins';
import type { DeployCheck, DeployContext, DeployPlugin } from '../plugin';

/** What ships with depli. Each is an ordinary plugin — nothing here is special-cased. */
export const BUILTIN_PLUGINS: readonly DeployPlugin<any>[] = [jenkinsPlugin, githubPlugin];

/** One plugin as a project sees it: the plugin and the options its config gives it. */
export interface Target {
  plugin: DeployPlugin<any>;
  options: Record<string, unknown>;
}

/**
 * The built-ins, minus `disable`, with the project's own `plugins` added — or swapped in, when
 * one reuses a built-in's id. Order: built-ins first, in their own order, then the new ones.
 */
export const resolveTargets = (config: DepliProjectConfig): Target[] => {
  const disabled = new Set(config.disable ?? []);
  const byId = new Map<string, DeployPlugin<any>>();
  for (const plugin of BUILTIN_PLUGINS) byId.set(plugin.id, plugin);
  for (const plugin of config.plugins ?? []) byId.set(plugin.id, plugin);
  return [...byId.values()]
    .filter((plugin) => !disabled.has(plugin.id))
    .map((plugin) => ({ plugin, options: config.targets?.[plugin.id] ?? {} }));
};

export interface ContextBase {
  cwd: string;
  env: DeployContext['env'];
  log?: (line: string) => void;
  dryRun?: boolean;
}

export const contextFor = (target: Target, base: ContextBase): DeployContext => ({
  cwd: base.cwd,
  env: base.env,
  options: target.options,
  log: base.log ?? (() => {}),
  dryRun: base.dryRun ?? false,
});

/** A plugin whose check throws is reported as one failed check, not a crash. */
export const checkTarget = async (target: Target, base: ContextBase): Promise<DeployCheck[]> => {
  try {
    return await target.plugin.check(contextFor(target, base));
  } catch (error) {
    return [{ label: 'check', ok: false, detail: (error as Error).message }];
  }
};
