import type { Connection, Env } from '../plugin';
import { contextFor, type Project, type Provider } from '../registry';

/**
 * Probe a provider's transports in its order of preference; the first that passes is the
 * connection. The rest are still probed, so the Connections tab can show what a fallback offers.
 */
export const connect = async (
  project: Project,
  provider: Provider,
  env: Env,
): Promise<Connection> => {
  const context = contextFor(project, provider, env);
  const probes = await Promise.all(
    provider.transports.map(async (transport) => {
      try {
        return {
          ...(await transport.probe(context)),
          transport: transport.id,
          label: transport.label,
        };
      } catch (error) {
        return {
          ok: false,
          detail: (error as Error).message,
          transport: transport.id,
          label: transport.label,
        };
      }
    }),
  );
  const chosen = provider.transports.find((transport, index) => probes[index]?.ok);
  return {
    transport: chosen?.id,
    capabilities: chosen?.capabilities ?? [],
    probes,
    checkedAt: Date.now(),
  };
};

export const connectAll = async (project: Project, env: Env) =>
  Object.fromEntries(
    await Promise.all(
      project.providers.map(
        async (provider) => [provider.name, await connect(project, provider, env)] as const,
      ),
    ),
  ) as Record<string, Connection>;
