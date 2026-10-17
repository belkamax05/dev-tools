import { Text } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { DeployCheck } from '../../../core/plugin';
import { checkTarget, contextFor, type Target } from '../../../core/registry';
import type { Session, Tone } from '../../types';

export interface TargetsViewProps {
  root: string;
  targets: Target[];
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  /** Bumped by [r]: run every check again. */
  refreshKey: number;
}

/**
 * Every target with its checks beside it. Enter runs the target's deploy as a dry run — the
 * template stops there; a real deploy will ask first.
 */
export const TargetsView = ({ root, targets, session, notify, refreshKey }: TargetsViewProps) => {
  const colors = useColors();
  const [checks, setChecks] = useState<Record<string, DeployCheck[]>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the trigger
  useEffect(() => {
    let live = true;
    Promise.all(
      targets.map(
        async (target) =>
          [target.plugin.id, await checkTarget(target, { cwd: root, env: process.env })] as const,
      ),
    ).then((entries) => {
      if (live) setChecks(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [targets, root, refreshKey]);

  const isReady = (id: string) => checks[id]?.every((check) => check.ok);

  const items: PickItem<Target>[] = targets.map((target) => ({
    id: target.plugin.id,
    label: `${target.plugin.icon} ${target.plugin.label}`,
    hint: checks[target.plugin.id] ? (isReady(target.plugin.id) ? 'ready' : 'not ready') : '…',
    hintColor: isReady(target.plugin.id) ? colors.ok : colors.warn,
    value: target,
  }));

  const dryRun = async (target: Target) => {
    const lines: string[] = [];
    const result = await target.plugin.deploy(
      contextFor(target, { cwd: root, env: process.env, dryRun: true, log: (l) => lines.push(l) }),
    );
    notify([...lines, result.message].join(' · '), result.ok ? 'ok' : 'warn');
  };

  return (
    <ListDetail
      title="Targets"
      items={items}
      emptyText="No targets — every built-in is disabled in depli.config.ts"
      detailTitle="Checks"
      activateLabel="dry run"
      initialSelectedId={session.selected.targets}
      onActivate={(item) => {
        if (item.value) dryRun(item.value);
      }}
      onSelectionChange={(item) => {
        session.selected.targets = item?.id;
      }}
      renderDetail={(item) => {
        const target = item?.value;
        if (!target) return null;
        return (
          <Box flexDirection="column">
            <Text color={colors.muted} wrap="wrap">
              {target.plugin.description}
            </Text>
            <Text> </Text>
            {(checks[target.plugin.id] ?? []).map((check) => (
              <Text key={check.label} wrap="truncate-end">
                <Text color={check.ok ? colors.ok : colors.error}>{check.ok ? '✓' : '✗'}</Text>
                <Text color={colors.text}> {check.label}</Text>
                {check.detail ? <Text color={colors.muted}> — {check.detail}</Text> : null}
              </Text>
            ))}
          </Box>
        );
      }}
    />
  );
};

export default TargetsView;
