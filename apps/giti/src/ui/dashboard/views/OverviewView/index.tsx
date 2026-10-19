import { type DOMElement, Text, useInput } from 'ink';
import { type RefObject, useEffect, useRef, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Popover from '@/dev-tools/ui/components/Popover';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import type { GitViewProps } from '../../types';
import copyToClipboard from '../../clipboard';
import SyncBar from '../../SyncBar';
import type { RemoteSync } from '../../useRemoteSync';
import IgnoredView from '../IgnoredView';
import StatusView from '../StatusView';

export interface OverviewViewProps extends GitViewProps {
  snapshot: RepoSnapshot;
  /** Fetch / pull / push, owned by App so they keep running across a tab switch. */
  sync: RemoteSync;
  /** Whether the extra lines are showing — remembered between runs in giti's state.json. */
  details: boolean;
  onToggleDetails: () => void;
  /** True while something else owns the keyboard (a prompt, the palette): the keys below stand down. */
  isInputCaptured: boolean;
  onPickBranch: () => void;
  onOpenLog: () => void;
  onOpenStash: () => void;
  onOpenRemotes: () => void;
}

/**
 * What `+` adds: the facts worth having but not worth the room every time — which commit HEAD
 * is, who commits go out as, and the rest of the repository's inventory. Four fixed lines, so
 * the file list below can budget for them exactly (`overviewDetails` in the theme).
 */
const Details = ({
  snapshot,
  headRef,
  onCopy,
}: {
  snapshot: RepoSnapshot;
  headRef: RefObject<DOMElement | null>;
  onCopy: () => void;
}) => {
  const colors = useColors();
  const { isHovered } = useClickable(headRef, {
    onClick: onCopy,
    isActive: Boolean(snapshot.headFull),
  });
  const {
    root,
    headFull,
    headSubject,
    user,
    originUrl,
    stashCount,
    localBranches,
    remoteBranches,
    mergedBranches,
    remotes,
    vendored,
  } = snapshot;
  //? `git branch --merged` lists the current branch too, which is never safe to delete.
  const merged = Math.max(0, mergedBranches.length - 1);

  const label = (text: string) => <Text color={colors.muted}>{text.padEnd(6)}</Text>;

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* The full hash, uncut: the one value here someone is going to copy. */}
      <Box flexDirection="row">
        {label('HEAD')}
        <Box ref={headRef}>
          <Text color={isHovered ? colors.highlight : colors.heading} underline={isHovered}>
            {headFull || '—'}
          </Text>
        </Box>
        <Text color={colors.muted}> [H] copy</Text>
      </Box>
      <Text wrap="truncate">
        {label('last')}
        <Text>{headSubject || '—'}</Text>
      </Text>
      <Text wrap="truncate">
        {label('you')}
        <Text color={user.isValid ? colors.text : colors.warn}>
          {user.name || '—'} {`<${user.email || '—'}>`}
        </Text>
        <Text color={colors.muted}>{`  · origin ${originUrl || 'none'}`}</Text>
      </Text>
      <Text wrap="truncate">
        {label('refs')}
        <Text>
          {`${localBranches.length} local · ${remoteBranches.length} remote · `}
          <Text color={merged ? colors.highlight : colors.text}>
            {`${merged} merged${merged ? ' (safe to delete)' : ''}`}
          </Text>
          {` · ${remotes.length} remotes · ${vendored.length} vendored · `}
          <Text color={stashCount ? colors.highlight : colors.text}>{`${stashCount} stashed`}</Text>
        </Text>
        <Text color={colors.muted}>{`  · ${root}`}</Text>
      </Text>
    </Box>
  );
};

/**
 * The first tab: where the branch stands, and the working tree to act on.
 *
 * It used to be two tabs — Overview (read-only cards) and Status (stage, diff, commit) — and the
 * usual first move on opening either was a trip to the other. Now it is one screen that starts
 * minimal: a sync line with Fetch / Pull / Push, then Status as it was. `+` opens the details
 * (HEAD, identity, inventory) above the file list and `-` folds them away; which of the two the
 * user left it in is remembered.
 */
export const OverviewView = ({
  snapshot,
  sync,
  details,
  onToggleDetails,
  isInputCaptured,
  onPickBranch,
  onOpenLog,
  onOpenStash,
  onOpenRemotes,
  ...viewProps
}: OverviewViewProps) => {
  //? The ignored-files tree takes Status's place rather than getting a tab of its own: it is a
  //? rare cleanup over the same work tree, not somewhere anyone goes every day
  const [showIgnored, setShowIgnored] = useState(false);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const colors = useColors();
  const containerRef = useRef<DOMElement>(null);
  const headRef = useRef<DOMElement>(null);
  const [copied, setCopied] = useState(0);
  const copyHead = () => {
    if (!snapshot.headFull) return;
    copyToClipboard(snapshot.headFull);
    setCopied((count) => count + 1);
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useInput(
    (input, key) => {
      //? Ctrl+P arrives as input 'p' too, and it belongs to the command palette
      if (key.ctrl) return;
      if (input === 'I') setShowIgnored(true);
      else if (input === 'b') onPickBranch();
      else if (input === 'l') onOpenLog();
      else if (input === 'S') onOpenStash();
      else if (input === 'R') onOpenRemotes();
      else if (input === 'H' && details) copyHead();
      else if (input === 'f') sync.fetch();
      else if (input === 'p') sync.pull();
      else if (input === 'P') sync.push();
      else if (input === '+' || input === '=') {
        if (!details) onToggleDetails();
      } else if (input === '-' || input === '_') {
        if (details) onToggleDetails();
      }
    },
    { isActive: !isInputCaptured },
  );

  const reservedChrome = [
    ...viewProps.reservedChrome,
    ...(!filePreviewOpen
      ? ['syncBar', 'overviewTools', ...(details ? ['overviewDetails'] : [])]
      : []),
  ];

  return (
    <Box ref={containerRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {!filePreviewOpen && (
        <>
          <SyncBar
            snapshot={snapshot}
            sync={sync}
            details={{ shown: details, onToggle: onToggleDetails }}
            onPickBranch={onPickBranch}
          />
          <Box flexDirection="row" flexShrink={0}>
            <ActionButton hotkey="b" label="Branches" onPress={onPickBranch} />
            <Text> </Text>
            <ActionButton hotkey="l" label="Log" onPress={onOpenLog} />
            <Text> </Text>
            <ActionButton hotkey="S" label="Stashes" onPress={onOpenStash} />
            <Text> </Text>
            <ActionButton hotkey="R" label="Remotes" onPress={onOpenRemotes} />
          </Box>
          {details && <Details snapshot={snapshot} headRef={headRef} onCopy={copyHead} />}
        </>
      )}
      {showIgnored ? (
        <IgnoredView
          root={viewProps.root}
          onClose={() => setShowIgnored(false)}
          onCleared={(result) => {
            viewProps.notify(result.message, result.ok ? 'ok' : 'error');
            viewProps.reload();
          }}
          onCaptureInput={viewProps.onCaptureInput}
          reservedChrome={['appShell', ...reservedChrome]}
        />
      ) : (
        <StatusView
          {...viewProps}
          reservedChrome={reservedChrome}
          onShowIgnored={() => setShowIgnored(true)}
          onPreviewModeChange={setFilePreviewOpen}
        />
      )}
      {details && copied > 0 && (
        <Popover anchorRef={headRef} containerRef={containerRef} width={25}>
          <Box borderStyle="round" borderColor={colors.ok} paddingX={1}>
            <Text color={colors.ok}>Copied to clipboard</Text>
          </Box>
        </Popover>
      )}
    </Box>
  );
};

export default OverviewView;
