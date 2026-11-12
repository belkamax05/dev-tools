import { useEffect } from 'react';

import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { BranchHead } from '../../../core/plugin';
import type { Session } from '../../types';
import type { DepliData, PickState } from '../../useDepli';
import BranchesView from '../BranchesView';

export interface PickViewProps {
  data: Pick<DepliData, 'connections' | 'pickSuggestions' | 'loadPickSuggestions' | 'setPick'>;
  pick: PickState;
  session: Session;
  onCaptureInput: (captured: boolean) => void;
  /** Picked, or closed: back to the chain. */
  onClose: () => void;
}

/**
 * A pick's picker (`picks` in depli.config.ts) — the branch picker's list, filter and typed
 * value, over what the pick's `suggest` offers in its source's order. The first row goes back to
 * the pick's default; with `custom`, a typed value not suggested is used as it is.
 */
export const PickView = ({ data, pick, session, onCaptureInput, onClose }: PickViewProps) => {
  const colors = useColors();
  const suggestions = data.pickSuggestions[pick.id];

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per pick, and once connected
  useEffect(() => {
    if (!suggestions) data.loadPickSuggestions(pick.id);
  }, [pick.id, data.connections]);

  //? The default is listed once, as the first row — with the suggestion's commit when it has one
  const suggested = suggestions?.find((head) => head.name === pick.fallback);
  const fallback: BranchHead = {
    name: '',
    sha: suggested?.sha ?? '',
    committedAt: suggested?.committedAt,
    message: `Not picked: each step gets the default for its branch${pick.fallback ? ` — ${pick.fallback} for the branch shown` : ''}, as depli.config.ts works it out.${suggested?.message ? `\n${suggested.message}` : ''}`,
  };
  //? Picked by hand but equal to the default: the default row carries the ✓
  const onDefault = !pick.picked || pick.picked === pick.fallback;
  return (
    <BranchesView
      data={{
        branch: pick.picked ?? '',
        current: undefined,
        branches: suggestions,
        connections: data.connections,
        allBranches: false,
        loadBranches: () => {},
        selectBranch: (name) => data.setPick(pick.id, name || undefined),
      }}
      watch={[]}
      noun={pick.label}
      allowAll={false}
      custom={pick.custom}
      source={pick.source ?? 'the suggestions'}
      scopeTitle={pick.source ? `Suggested by ${pick.source}` : 'Suggested'}
      leading={[
        {
          id: 'pick:default',
          label: `${onDefault ? '✓' : ' '} ↺ default${pick.fallback ? ` (${pick.fallback})` : ''}`,
          hint: 'worked out from the branch',
          hintColor: colors.muted,
          value: fallback,
        },
      ]}
      leadingCovers={pick.fallback ? [pick.fallback] : []}
      detailNote={pick.description}
      session={session}
      onCaptureInput={onCaptureInput}
      onPicked={onClose}
      onClose={onClose}
    />
  );
};

export default PickView;
