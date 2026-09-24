import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { getHealth, type HealthIssue, type Severity } from '../../../core/health';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import type { ViewProps } from '../../types';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';

const LABEL: Record<Severity, string> = { error: 'Errors', warn: 'Warnings', info: 'Suggestions' };

/**
 * What is wrong with this scope's agent setup, worst first, with a fix where
 * one is safe to make from here.
 *
 * Every check is in `core/health`; a fix is always a plain file change —
 * adding a line to `.gitignore`, removing a stale link, approving a server in
 * the local settings. Anything that would need git (untracking a committed
 * file) is described, with the command, and left to the user.
 */
export const HealthView = ({
  scope,
  ides,
  session,
  notify,
  onCaptureInput,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.health);
  const [busy, setBusy] = useState(false);
  const ideIds = ides.map((ide) => ide.id).join(',');

  const {
    data: issues = [],
    isLoading,
    reload,
  } = useLoader(() => getHealth(scope, ides), [scope.root, scope.kind, ideIds, refreshKey]);

  const items: PickItem<HealthIssue>[] = (['error', 'warn', 'info'] as Severity[]).flatMap(
    (severity) => {
      const group = issues.filter((issue) => issue.severity === severity);
      if (!group.length) return [];
      return [
        { id: `header-${severity}`, label: `${LABEL[severity]} (${group.length})`, isHeader: true },
        ...group.map((issue) => ({
          id: issue.id,
          label: issue.title,
          hint: issue.fix ? 'fixable' : undefined,
          hintColor: issue.fix ? colors.accent : undefined,
          value: issue,
        })),
      ];
    },
  );
  const current = items.find((item) => item.id === currentId)?.value;

  const fix = async (issue: HealthIssue) => {
    if (!issue.fix || busy) return;
    setBusy(true);
    try {
      const result = await issue.fix();
      notify(result.message, result.ok ? 'ok' : 'error');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const fixable = issues.filter((issue) => issue.fix);
  const fixAll = () =>
    prompt.confirm(`Apply ${fixable.length} fix(es)?`, async () => {
      setBusy(true);
      let done = 0;
      for (const issue of fixable) {
        const result = await issue.fix?.();
        if (result?.ok) done += 1;
      }
      setBusy(false);
      notify(`Applied ${done} of ${fixable.length} fixes`, done === fixable.length ? 'ok' : 'warn');
      reload();
    });

  useInput(
    (input) => {
      if (busy) return;
      if (input === 'f' && current) void fix(current);
      else if (input === 'F' && fixable.length) fixAll();
    },
    { isActive: !prompt.isOpen },
  );

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const header = prompt.line ?? (
    <Text color={errors ? colors.error : issues.length ? colors.warn : colors.ok} wrap="truncate">
      {isLoading && !issues.length
        ? 'Checking…'
        : issues.length
          ? `${errors} error(s) · ${issues.length - errors} other · ${fixable.length} fixable here`
          : `Nothing to fix for ${ides.map((ide) => ide.name).join(', ')}`}
      {busy ? ' · working…' : ''}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={`Health (${issues.length})`}
        items={items}
        emptyText={isLoading ? 'Checking…' : 'All clear.'}
        detailTitle="Issue"
        reservedChrome={['viewHeader']}
        activateLabel="fix"
        activateOnClick={false}
        initialSelectedId={session.selected.health}
        isInputActive={!prompt.isOpen}
        hints={
          fixable.length ? [{ key: 'F', label: `fix all ${fixable.length}`, onPress: fixAll }] : []
        }
        onActivate={(item) => item.value && void fix(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.health = item?.id;
        }}
        renderDetail={(item) => {
          const issue = item?.value;
          if (!issue) return null;
          return (
            <Box flexDirection="column">
              {issue.fix && (
                <Toolbar
                  actions={[
                    {
                      hotkey: 'f',
                      label: issue.fixLabel ?? 'Fix',
                      onPress: () => void fix(issue),
                      tone: 'primary',
                      disabled: busy,
                    },
                  ]}
                />
              )}
              <Text
                bold
                color={
                  issue.severity === 'error'
                    ? colors.error
                    : issue.severity === 'warn'
                      ? colors.warn
                      : colors.text
                }
              >
                {issue.title}
              </Text>
              <Box marginTop={1}>
                <Text color={colors.text}>{issue.detail}</Text>
              </Box>
              {!issue.fix && (
                <Box marginTop={1}>
                  <Text color={colors.muted}>No automatic fix — this one is yours to make.</Text>
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default HealthView;
