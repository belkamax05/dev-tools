import { Text, useInput } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { Provider } from '../../../core/registry';
import type { DepliData } from '../../useDepli';
import type { Session } from '../../types';

export interface ConnectionsViewProps {
  data: DepliData;
  providers: Provider[];
  problems: string[];
  session: Session;
}

/**
 * Each provider and its transports in order of preference: which one is in use, what each probe
 * said, and what the one in use can do — so a fallback (SSH without the API) says what it lacks.
 */
export const ConnectionsView = ({ data, providers, problems, session }: ConnectionsViewProps) => {
  const colors = useColors();
  useInput((input) => {
    if (input === 'P') data.reprobe();
  });
  const items: PickItem<Provider>[] = providers.map((provider) => {
    const connection = data.connections[provider.name];
    return {
      id: provider.name,
      label: `${provider.plugin.icon} ${provider.name}`,
      hint: connection ? (connection.transport ?? 'offline') : '…',
      hintColor: connection?.transport ? colors.ok : colors.error,
      value: provider,
    };
  });

  return (
    <ListDetail
      title="Connections"
      items={items}
      emptyText="No providers — add some to depli.config.ts"
      detailTitle="Transports"
      hints={[{ key: 'P', label: 'probe now', onPress: data.reprobe }]}
      initialSelectedId={session.selected.connections}
      onSelectionChange={(item) => {
        session.selected.connections = item?.id;
      }}
      renderDetail={(item) => {
        const provider = item?.value;
        if (!provider) return null;
        const connection = data.connections[provider.name];
        const all = new Set(provider.transports.flatMap((transport) => transport.capabilities));
        const missing = [...all].filter(
          (capability) => !connection?.capabilities.includes(capability),
        );
        return (
          <Box flexDirection="column">
            <Text color={colors.text}>
              {provider.plugin.label}
              {connection
                ? ` · checked ${new Date(connection.checkedAt).toLocaleTimeString()}`
                : ''}
            </Text>
            {(connection?.probes ?? []).map((probe, index) => (
              <Text key={probe.transport} wrap="wrap">
                <Text color={probe.ok ? colors.ok : colors.error}>{probe.ok ? '✓' : '✗'}</Text>
                <Text color={colors.text}>
                  {' '}
                  {index + 1}. {probe.label}
                  {probe.transport === connection?.transport ? ' (in use)' : ''}
                </Text>
                <Text color={colors.muted}>
                  {' '}
                  — {probe.detail}
                  {probe.identity ? ` · as ${probe.identity}` : ''}
                </Text>
              </Text>
            ))}
            <Text> </Text>
            <Text color={colors.muted} wrap="wrap">
              can: {connection?.capabilities.join(', ') || 'nothing'}
            </Text>
            {missing.length > 0 && (
              <Text color={colors.warn} wrap="wrap">
                missing over this transport: {missing.join(', ')}
              </Text>
            )}
            {problems.map((problem) => (
              <Text key={problem} color={colors.error} wrap="wrap">
                ! {problem}
              </Text>
            ))}
          </Box>
        );
      }}
    />
  );
};

export default ConnectionsView;
