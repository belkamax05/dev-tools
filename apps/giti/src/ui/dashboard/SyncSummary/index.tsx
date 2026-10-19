import { type DOMElement, Text } from 'ink';
import { type RefObject, useRef } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../utils/getRepoSnapshot';
import SpinnerGlyph from '../SpinnerGlyph';
import type { LastFetch, RemoteSync } from '../useRemoteSync';

const clock = (at: Date) =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

const fetchState = (progress: string | undefined, lastFetch: LastFetch | undefined) =>
  progress ??
  (lastFetch
    ? lastFetch.ok
      ? `fetched ${clock(lastFetch.at)}`
      : `fetch failed ${clock(lastFetch.at)}`
    : 'not fetched yet');

export interface SyncSummaryProps {
  snapshot: RepoSnapshot;
  sync: Pick<RemoteSync, 'progress' | 'lastFetch'>;
  /** Makes the branch name a button — the dashboard opens its branch picker from it. */
  onPickBranch?: () => void;
  /** Handed the branch name's element, for something to hang beneath it — "Switched to main". */
  branchRef?: RefObject<DOMElement | null>;
}

/**
 * Where the branch stands against its remote, in one line: `main → origin/main  ↑2 ↓1 · fetched
 * 14:02`. The dashboard's sync bar puts its buttons beside it; the commit form shows it alone,
 * so the commits waiting to go out or come in are in view while a commit is being made.
 */
export const SyncSummary = ({ snapshot, sync, onPickBranch, branchRef: given }: SyncSummaryProps) => {
  const colors = useColors();
  const { branch, detached, headShort, upstream, remote, ahead, behind } = snapshot;
  const own = useRef<DOMElement>(null);
  const branchRef = given ?? own;
  const { isHovered } = useClickable(branchRef, {
    onClick: onPickBranch,
    isActive: Boolean(onPickBranch),
  });

  return (
    <Box flexDirection="row" flexShrink={1} flexGrow={1} overflow="hidden">
      <Box ref={branchRef} flexShrink={1}>
        <Text
          color={isHovered ? colors.highlight : detached ? colors.warn : colors.accent}
          bold
          underline={isHovered}
          wrap="truncate"
        >
          {detached ? `detached @ ${headShort}` : branch || '—'}
        </Text>
      </Box>
      <Text wrap="truncate">
        <Text color={colors.muted}> → </Text>
        <Text color={upstream ? colors.text : colors.warn}>
          {upstream ? `${remote || 'origin'}/${upstream}` : 'no upstream'}
        </Text>
        <Text color={ahead ? colors.ok : colors.muted}>{`  ↑${ahead}`}</Text>
        <Text color={behind ? colors.warn : colors.muted}>{` ↓${behind}`}</Text>
        <Text color={colors.muted}>{'  · '}</Text>
        {sync.progress && <SpinnerGlyph color={colors.accent} />}
        <Text
          color={
            sync.progress
              ? colors.accent
              : sync.lastFetch?.ok === false
                ? colors.warn
                : colors.muted
          }
        >
          {fetchState(sync.progress, sync.lastFetch)}
        </Text>
      </Text>
    </Box>
  );
};

export default SyncSummary;
