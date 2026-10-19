import { Text } from 'ink';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../utils/getRepoSnapshot';
import SyncSummary from '../SyncSummary';
import type { RemoteSync } from '../useRemoteSync';

export interface SyncBarProps {
  snapshot: RepoSnapshot;
  sync: RemoteSync;
  /** Makes the branch name a button — the dashboard opens its branch picker from it. */
  onPickBranch?: () => void;
  /** The dashboard's More/Less toggle for its detail lines; left off, there is no such button. */
  details?: { shown: boolean; onToggle: () => void };
}

/**
 * Where the branch stands against its remote, and the three things done about it — the same bar
 * on the dashboard and in the commit form, keys included (`f` fetch, `p` pull, `P` push, handled
 * by whoever owns the keyboard there).
 *
 * One line, always shown: this is what the first glance at a repository is for — am I behind,
 * do I have something to push — and the button for each answer sits right next to it. The
 * likely next step is the highlighted one: Pull when behind, Push when ahead.
 */
export const SyncBar = ({ snapshot, sync, onPickBranch, details }: SyncBarProps) => {
  const colors = useColors();
  const { ahead, behind } = snapshot;
  const busy = Boolean(sync.progress);
  //? A mega pull brings in the vendored directories too, so their waiting commits count here
  const incoming = behind + sync.vendoredBehind;

  return (
    <Box flexDirection="row" flexShrink={0}>
      <SyncSummary snapshot={snapshot} sync={sync} onPickBranch={onPickBranch} />
      <Box flexShrink={0} flexDirection="row">
        <Text> </Text>
        <ActionButton hotkey="f" label="Fetch" disabled={busy} onPress={sync.fetch} />
        <Text> </Text>
        <ActionButton
          hotkey="p"
          label={incoming ? `Pull ↓${incoming}` : 'Pull'}
          color={incoming ? colors.accent : undefined}
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
        {details && (
          <>
            <Text> </Text>
            <ActionButton
              hotkey={details.shown ? '-' : '+'}
              label={details.shown ? 'Less' : 'More'}
              onPress={details.onToggle}
            />
          </>
        )}
      </Box>
    </Box>
  );
};

export default SyncBar;
