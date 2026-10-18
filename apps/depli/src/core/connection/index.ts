import type { Connection, ConnectionPreference, Env, ProbeResult } from '../plugin';
import { contextFor, type Project, type Provider } from '../registry';

type Probe = Connection['probes'][number];

const runProbe = async (
  project: Project,
  provider: Provider,
  env: Env,
  transportId: string,
  choice: string | undefined,
): Promise<Probe> => {
  const transport = provider.transports.find((entry) => entry.id === transportId);
  if (!transport)
    return { ok: false, detail: `no transport ${transportId}`, transport: transportId, label: '?' };
  //? Switched off for the project: not even asked
  if (provider.disabled?.includes(transport.id))
    return {
      ok: false,
      detail: `disabled in depli.config.ts (providers.${provider.name}.disabledTransports)`,
      transport: transport.id,
      label: transport.label,
      disabled: true,
    };
  const context = { ...contextFor(project, provider, env), choice };
  let result: ProbeResult;
  try {
    result = await transport.probe(context);
  } catch (error) {
    result = { ok: false, detail: (error as Error).message };
  }
  return { ...result, transport: transport.id, label: transport.label, choice };
};

/**
 * Probe a provider's transports in its order of preference; the first that passes is the
 * connection — or the pinned one, passing or not, when the person pinned one. The rest are still
 * probed, so the Connections tab can show what a fallback offers.
 */
export const connect = async (
  project: Project,
  provider: Provider,
  env: Env,
  preference: ConnectionPreference = {},
): Promise<Connection> => {
  const probes = await Promise.all(
    provider.transports.map((transport) =>
      runProbe(project, provider, env, transport.id, preference.choices?.[transport.id]),
    ),
  );
  //? A pin on a transport the config switched off is ignored — back to the first that works
  const pinned = provider.transports.find(
    (transport) =>
      transport.id === preference.transport && !provider.disabled?.includes(transport.id),
  );
  const chosen = pinned
    ? probes.find((probe) => probe.transport === pinned.id && probe.ok) && pinned
    : provider.transports.find(
        (transport, index) =>
          !transport.planned && !provider.disabled?.includes(transport.id) && probes[index]?.ok,
      );
  return {
    transport: chosen?.id,
    choice: chosen ? preference.choices?.[chosen.id] : undefined,
    pinned: pinned?.id,
    capabilities: chosen?.capabilities ?? [],
    probes,
    checkedAt: Date.now(),
  };
};

/**
 * One transport with one of its choices (or its default, for undefined) — what the Connections
 * tab runs to test every SSH key before the person picks one. Changes nothing.
 */
export const probeChoice = (
  project: Project,
  provider: Provider,
  env: Env,
  transportId: string,
  choice: string | undefined,
): Promise<Probe> => runProbe(project, provider, env, transportId, choice);

export const connectAll = async (
  project: Project,
  env: Env,
  preferences: Record<string, ConnectionPreference> = {},
) =>
  Object.fromEntries(
    await Promise.all(
      project.providers.map(
        async (provider) =>
          [provider.name, await connect(project, provider, env, preferences[provider.name])] as const,
      ),
    ),
  ) as Record<string, Connection>;
