import { Text, useInput } from 'ink';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import type { GitViewProps } from '../../types';
import type { LastFetch, RemoteSync } from '../../useRemoteSync';
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
}

const clock = (at: Date) =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

const fetchState = (progress: string | undefined, lastFetch: LastFetch | undefined) =>
  progress ??
  (lastFetch
    ? lastFetch.ok
      ? `fetched ${clock(lastFetch.at)}`
      : `fetch failed ${clock(lastFetch.at)}`
    : 'not fetched yet');

/**
 * Where the branch stands against its remote, and the three things done about it.
 *
 * One line, always shown: this is what the first glance at a repository is for — am I behind,
 * do I have something to push — and the button for each answer sits right next to it. The
 * likely next step is the highlighted one: Pull when behind, Push when ahead.
 */
const SyncBar = ({
  snapshot,
  sync,
  details,
  onToggleDetails,
}: Pick<OverviewViewProps, 'snapshot' | 'sync' | 'details' | 'onToggleDetails'>) => {
  const colors = useColors();
  const { branch, detached, headShort, upstream, remote, ahead, behind } = snapshot;
  const busy = Boolean(sync.progress);

  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexShrink={1} flexGrow={1} overflow="hidden">
        <Text wrap="truncate">
          <Text color={detached ? colors.warn : colors.accent} bold>
            {detached ? `detached @ ${headShort}` : branch || '—'}
          </Text>
          <Text color={colors.muted}> → </Text>
          <Text color={upstream ? colors.text : colors.warn}>
            {upstream ? `${remote || 'origin'}/${upstream}` : 'no upstream'}
          </Text>
          <Text color={ahead ? colors.ok : colors.muted}>{`  ↑${ahead}`}</Text>
          <Text color={behind ? colors.warn : colors.muted}>{` ↓${behind}`}</Text>
          <Text color={sync.lastFetch?.ok === false ? colors.warn : colors.muted}>
            {`  · ${fetchState(sync.progress, sync.lastFetch)}`}
          </Text>
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="row">
        <Text> </Text>
        <ActionButton hotkey="f" label="Fetch" disabled={busy} onPress={sync.fetch} />
        <Text> </Text>
        <ActionButton
          hotkey="l"
          label={behind ? `Pull ↓${behind}` : 'Pull'}
          color={behind ? colors.accent : undefined}
          disabled={busy}
          onPress={sync.pull}
        />
        <Text> </Text>
        <ActionButton
          hotkey="P"
          label={ahead ? `Push ↑${ahead}` : 'Push'}
          color={ahead && !behind ? colors.accent : undefined}
          disabled={busy}
          onPress={sync.push}
        />
        <Text> </Text>
        <ActionButton
          hotkey={details ? '-' : '+'}
          label={details ? 'Less' : 'More'}
          onPress={onToggleDetails}
        />
      </Box>
    </Box>
  );
};

/**
 * What `+` adds: the facts worth having but not worth the room every time — which commit HEAD
 * is, who commits go out as, and the rest of the repository's inventory. Four fixed lines, so
 * the file list below can budget for them exactly (`overviewDetails` in the theme).
 */
const Details = ({ snapshot }: { snapshot: RepoSnapshot }) => {
  const colors = useColors();
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
      <Text wrap="truncate">
        {label('HEAD')}
        <Text color={colors.heading}>{headFull || '—'}</Text>
      </Text>
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
  ...viewProps
}: OverviewViewProps) => {
  useInput(
    (input) => {
      if (input === 'f') sync.fetch();
      else if (input === 'l') sync.pull();
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
    'syncBar',
    ...(details ? ['overviewDetails'] : []),
  ];

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <SyncBar
        snapshot={snapshot}
        sync={sync}
        details={details}
        onToggleDetails={onToggleDetails}
      />
      {details && <Details snapshot={snapshot} />}
      <StatusView {...viewProps} reservedChrome={reservedChrome} />
    </Box>
  );
};

export default OverviewView;
