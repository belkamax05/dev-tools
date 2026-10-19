import { Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  type Branch,
  type BranchSort,
  type SwitchOptions,
  compareWithCurrent,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  getBranches,
  mergeBranch,
  renameBranch,
  restoreBranch,
  setUpstream,
  sortBranches,
  switchBranch,
} from '../../../../core/branches';
import type { OperationResult } from '../../../../core/status';
import {
  applyVendoredHop,
  planVendoredHopAtHead,
  type VendoredHop,
} from '../../../../core/vendoredHop';
import { VendoredHopForm } from '../../../renderInkVendoredHop';
import PatchLines from '../../PatchLines';
import SpinnerGlyph from '../../SpinnerGlyph';
import type { GitViewProps } from '../../types';
import type { RemoteSync } from '../../useRemoteSync';

export interface BranchesViewProps extends GitViewProps {
  /** Pull, shared with Overview and Remotes so a pull in flight is one state across tabs. */
  sync: RemoteSync;
  /** Close the branch picker and return to the view that opened it. */
  onClose?: () => void;
  /** The search to open with — `giti hop fea` starts filtered on "fea". */
  initialQuery?: string;
  /** How switches and new branches are made — `giti hop`'s flags; plain on the dashboard. */
  switchOptions?: SwitchOptions;
  /** A switch or a new branch went through — `giti hop` is done then, and closes. */
  onSwitched?: (message: string) => void;
  /**
   * After a switch, offer the branch to submodules and subrepos before `onSwitched` — on by
   * default (the dashboard). `giti hop` turns it off: it asks once its own screen has closed.
   */
  followVendored?: boolean;
  /** Open on the new-branch prompt — `giti hop -c` with no name yet. */
  startCreating?: boolean;
  /** False while something else on screen has the keyboard (`giti hop`'s flags). */
  isInputActive?: boolean;
}

/**
 * Where following a dashboard switch into the vendored repos is: asking each upstream, waiting on
 * the checklist, or carrying out what was ticked.
 */
type VendoredStep =
  | { phase: 'planning'; branch?: string; count?: number }
  | { phase: 'asking'; branch: string; entries: VendoredHop[] }
  | { phase: 'applying'; branch: string; done: number; total: number };

const trackHint = (branch: Branch) =>
  [
    branch.isCurrent ? 'current' : undefined,
    branch.ahead ? `↑${branch.ahead}` : undefined,
    branch.behind ? `↓${branch.behind}` : undefined,
    branch.gone ? 'upstream gone' : undefined,
    branch.merged ? 'merged' : undefined,
    //? First name only, as the Log tab writes it: the row has room for a word, not a name
    branch.author.split(' ')[0],
  ]
    .filter(Boolean)
    .join(' ');

//? Same as CommandsView's: control bytes arrive as part of escape sequences
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
const printable = (input: string): string => input.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * Local and remote branches, and everything you do with one: switch to it,
 * start a new one from it, rename, set what it tracks, see what it has that
 * the current branch does not — and delete it, with ^Z to bring it back.
 */
export const BranchesView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  offerUndo,
  reservedChrome,
  sync,
  onClose,
  initialQuery = '',
  switchOptions,
  onSwitched,
  startCreating = false,
  isInputActive = true,
  followVendored = true,
}: BranchesViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [compare, setCompare] = useState(false);
  const [sort, setSort] = useState<BranchSort>('time');
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const lastClick = useRef<{ id: string; at: number } | undefined>(undefined);
  const [vendored, setVendored] = useState<VendoredStep>();
  //? Bumped by every new switch and on unmount: a plan still asking upstream for an older switch
  //? (`ls-remote` can take seconds) lands on nothing rather than over the newer one
  const vendoredRun = useRef(0);
  useEffect(
    () => () => {
      vendoredRun.current++;
    },
    [],
  );
  //? The checklist, and the applying after it, own the keyboard; planning leaves the list usable
  const isVendoredOpen = vendored?.phase === 'asking' || vendored?.phase === 'applying';

  const { data: branches = [], isLoading } = useLoader(() => getBranches(root), [root, refreshKey]);
  const checkedOut = branches.find((b) => b.isCurrent);

  //? The search box takes the keyboard, so the app's own keys (digits, q, r)
  //? must stand down while it is open — and get it back on Esc or unmount.
  useEffect(() => {
    onCaptureInput(isSearching || isVendoredOpen);
  }, [isSearching, isVendoredOpen, onCaptureInput]);
  useEffect(() => () => onCaptureInput(false), [onCaptureInput]);
  const current = branches.find((b) => `${b.isRemote ? 'r' : 'l'}:${b.name}` === currentId);
  const { data: diff = '' } = useLoader(
    () =>
      current && compare && !current.isCurrent
        ? compareWithCurrent(root, current.name)
        : Promise.resolve(''),
    [current?.name, compare, refreshKey],
  );

  const run = async (action: () => Promise<OperationResult>) => {
    const result = await action();
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  //? The dashboard's half of `giti hop`'s vendored step: the same plan and the same checklist,
  //? shown in place of the list. `then` is the end of the switch (the dashboard's `onSwitched`,
  //? which closes the picker) — held back until the checklist is answered or there is none
  const afterVendored = useRef<() => void>(undefined);
  const followIntoVendored = async (then: () => void) => {
    const run = ++vendoredRun.current;
    const isCurrent = () => run === vendoredRun.current;
    setVendored({ phase: 'planning' });
    const plan = await planVendoredHopAtHead(root, (branch, count) => {
      if (isCurrent()) setVendored({ phase: 'planning', branch, count });
    });
    if (!isCurrent()) return;
    if (!plan?.entries.some((entry) => entry.action !== 'none')) {
      setVendored(undefined);
      return then();
    }
    afterVendored.current = then;
    setVendored({ phase: 'asking', ...plan });
  };
  const applyVendored = async (branch: string, picked: VendoredHop[]) => {
    const then = afterVendored.current;
    afterVendored.current = undefined;
    if (picked.length === 0) {
      setVendored(undefined);
      notify('Vendored repos left where they were', 'info');
      return then?.();
    }
    const run = vendoredRun.current;
    const failures: string[] = [];
    //? One at a time: subrepo commands each commit in the parent, and two at once race the index
    for (const [done, entry] of picked.entries()) {
      if (run === vendoredRun.current) {
        setVendored({ phase: 'applying', branch, done, total: picked.length });
      }
      const result = await applyVendoredHop(root, entry, branch);
      if (!result.ok) failures.push(result.message);
    }
    if (run === vendoredRun.current) setVendored(undefined);
    const followed = picked.length - failures.length;
    if (failures.length) notify(failures.join(' · '), 'error');
    else notify(`${followed} vendored repo${followed === 1 ? '' : 's'} on ${branch}`, 'ok');
    reload();
    then?.();
  };

  //? A switch that went through is the end of `giti hop` and closes the dashboard's picker — on
  //? the dashboard only once the vendored step is answered. Without `onSwitched` it is one more action
  const runSwitch = async (action: () => Promise<OperationResult>) => {
    const result = await action();
    const finish = () => {
      if (onSwitched) return onSwitched(result.message);
      notify(result.message, 'ok');
      reload();
    };
    if (!result.ok) {
      notify(result.message, 'error');
      return reload();
    }
    if (!followVendored) return finish();
    //? The list shows the new branch as current while upstream is asked
    reload();
    await followIntoVendored(finish);
  };
  const switchTo = (branch: Branch) => {
    if (branch.isCurrent && !switchOptions?.detach)
      return notify(`Already on ${branch.name}`, 'info');
    void runSwitch(() => switchBranch(root, branch, switchOptions));
  };
  const create = (branch?: Branch) =>
    prompt.ask(`New branch${branch ? ` from ${branch.name}` : ''}:`, (name) => {
      if (name.trim()) void runSwitch(() => createBranch(root, name, branch?.name, switchOptions));
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (startCreating) create();
  }, []);
  const rename = (branch: Branch) =>
    prompt.ask(
      `Rename ${branch.name} to:`,
      (name) => {
        if (name.trim()) void run(() => renameBranch(root, branch.name, name));
      },
      { initial: branch.name },
    );
  //? "Merged" only means every commit on it is already in the checked-out branch — true of a
  //? branch created a moment ago with no commits of its own. So say that, and whether it was
  //? ever pushed, rather than implying it went somewhere. An unmerged one is deleted too (often
  //? it was squash-merged upstream, which git cannot see), but the question says what goes.
  const remove = (branch: Branch) => {
    if (branch.isCurrent) return notify('Switch to another branch first', 'warn');
    const into = checkedOut?.name ?? 'HEAD';
    const remoteNote = branch.gone
      ? ', and its remote copy is already gone'
      : branch.upstream
        ? ''
        : ', but it was never pushed';
    const question = branch.merged
      ? `Delete ${branch.name}? Every commit on it is already in ${into}${remoteNote}.`
      : `Delete ${branch.name}? It has commits ${into} does not${remoteNote} — ^Z brings it back.`;
    prompt.confirm(question, () =>
      run(async () => {
        const result = await deleteBranch(root, branch, { force: !branch.merged });
        const undo = result.undo;
        if (undo)
          offerUndo({ label: `Deleted ${undo.name}`, run: () => restoreBranch(root, undo) });
        return result;
      }),
    );
  };
  const removeRemote = (branch: Branch) =>
    prompt.confirm(
      `Delete ${branch.name} on the remote? It goes for everyone who fetches from there.`,
      () => run(() => deleteRemoteBranch(root, branch)),
    );
  const merge = (branch: Branch) => {
    if (branch.isCurrent || !checkedOut) return;
    prompt.confirm(`Merge ${branch.name} into ${checkedOut.name}?`, () =>
      run(() => mergeBranch(root, branch)),
    );
  };
  const pull = () => {
    if (!sync.progress) sync.pull();
  };
  const toggleSort = () => setSort((by) => (by === 'time' ? 'name' : 'time'));
  const track = (branch: Branch) =>
    prompt.ask(
      `${branch.name} tracks:`,
      (upstream) => {
        if (upstream.trim()) void run(() => setUpstream(root, branch.name, upstream.trim()));
      },
      { initial: branch.upstream || `origin/${branch.name}` },
    );

  useInput(
    (input, key) => {
      if (isSearching) {
        if (key.escape) {
          setIsSearching(false);
          setQuery('');
        } else if (key.return) setIsSearching(false);
        else if (key.backspace || key.delete) setQuery((text) => text.slice(0, -1));
        else if (!key.ctrl && !key.meta) {
          const typed = printable(input);
          if (typed) setQuery((text) => text + typed);
        }
        return;
      }
      //? `startsWith`: "/" and the first letters typed can land in one chunk
      if (input.startsWith('/')) {
        setIsSearching(true);
        setQuery(printable(input.slice(1)));
        return;
      }
      if (key.escape && query) return setQuery('');
      if (key.escape) return onClose?.();
      //? Ctrl+P arrives as input 'p' too, and it belongs to the command palette
      if (input === 'p' && !key.ctrl) return pull();
      if (input === 'n') return create(current);
      if (input === 's') return toggleSort();
      if (!current) return;
      //? Enter is the list's own (its onActivate, below): handled here as well, one press ran two
      //? `git switch`es at once, and the slower one failed on the other's index.lock
      if (input === ' ') switchTo(current);
      else if (input === 'v') setCompare((on) => !on);
      else if (input === 'M') merge(current);
      else if (current.isRemote) {
        if (input === 'D') removeRemote(current);
        //? Plain d is the local delete; a remote one takes the deliberate Shift+D
        else if (input === 'd') notify('Shift+D deletes a remote branch', 'info');
      } else if (input === 'r') rename(current);
      else if (input === 'd') remove(current);
      else if (input === 'u') track(current);
    },
    { isActive: !prompt.isOpen && !isVendoredOpen && isInputActive },
  );

  const needle = query.toLowerCase();
  const shown = sortBranches(
    branches.filter((b) => b.name.toLowerCase().includes(needle)),
    sort,
  );
  const local = shown.filter((b) => !b.isRemote);
  const remote = shown.filter((b) => b.isRemote);
  const toItem = (branch: Branch): PickItem<Branch> => ({
    id: `${branch.isRemote ? 'r' : 'l'}:${branch.name}`,
    label: branch.name,
    hint: trackHint(branch),
    hintColor: branch.isCurrent ? colors.accent : branch.gone ? colors.warn : undefined,
    value: branch,
    isCurrent: branch.isCurrent,
  });
  const items: PickItem<Branch>[] = [
    ...(local.length
      ? [
          { id: 'header-local', label: `Local (${local.length})`, isHeader: true },
          ...local.map(toItem),
        ]
      : []),
    ...(remote.length
      ? [
          { id: 'header-remote', label: `Remote (${remote.length})`, isHeader: true },
          ...remote.map(toItem),
        ]
      : []),
  ];

  const actionsFor = (branch: Branch): ToolbarAction[] => [
    {
      hotkey: 'Enter/Space',
      label: branch.isCurrent ? 'Checked out' : 'Switch',
      onPress: () => switchTo(branch),
      tone: 'primary',
      disabled: branch.isCurrent,
    },
    { hotkey: 'n', label: 'New from here', onPress: () => create(branch) },
    ...(!branch.isCurrent
      ? [
          { hotkey: 'v', label: 'Compare', onPress: () => setCompare((on) => !on), isOn: compare },
          {
            hotkey: 'Shift+M',
            label: `Merge into ${checkedOut?.name ?? 'HEAD'}`,
            onPress: () => merge(branch),
            disabled: !checkedOut,
          },
        ]
      : []),
    ...(!branch.isRemote
      ? [
          { hotkey: 'r', label: 'Rename', onPress: () => rename(branch) },
          { hotkey: 'u', label: 'Set upstream', onPress: () => track(branch) },
          {
            hotkey: 'd',
            label: 'Delete',
            onPress: () => remove(branch),
            tone: 'danger' as const,
            disabled: branch.isCurrent,
          },
        ]
      : [
          {
            hotkey: 'Shift+D',
            label: 'Delete on remote',
            onPress: () => removeRemote(branch),
            tone: 'danger' as const,
          },
        ]),
  ];

  const hints: Hint[] = [
    {
      key: 'p',
      label: checkedOut?.behind ? `pull ↓${checkedOut.behind}` : 'pull',
      //? Gray while a fetch/pull/push is running, the same as Remotes' disabled button
      onPress: sync.progress ? undefined : pull,
    },
    { key: 'n', label: 'new branch', onPress: () => create(current) },
    { key: '/', label: 'search', onPress: () => setIsSearching(true) },
    {
      key: 's',
      label: sort === 'time' ? 'sort: time' : 'sort: name',
      onPress: toggleSort,
    },
    ...(query ? [{ key: 'Esc', label: 'clear', onPress: () => setQuery('') }] : []),
    ...(!query && onClose ? [{ key: 'Esc', label: 'back', onPress: onClose }] : []),
  ];

  const rows = Math.max(
    3,
    viewport.contentRows(
      ['appShell', 'viewHints', 'panelFrame', 'viewHeader', ...reservedChrome],
      3,
    ) - 4,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ??
          (vendored?.phase === 'planning' || vendored?.phase === 'applying' ? (
            <Text wrap="truncate" color={colors.muted}>
              <SpinnerGlyph />
              {vendored.phase === 'applying'
                ? `Following ${vendored.branch} in vendored repos — ${vendored.done + 1} of ${vendored.total}…`
                : vendored.branch && vendored.count
                  ? `Looking for ${vendored.branch} in ${vendored.count} vendored repo${vendored.count === 1 ? '' : 's'}…`
                  : 'Checking vendored repos…'}
            </Text>
          ) : (
            <>
              <Text wrap="truncate" color={colors.muted}>
                {isLoading && !branches.length && <SpinnerGlyph />}
                {isLoading && !branches.length
                  ? 'Reading branches…'
                  : `${local.length} local · ${remote.length} remote · by ${sort} `}
              </Text>
              {isSearching || query ? (
                <>
                  <Text color={colors.accent}>/{query}</Text>
                  {isSearching && <Text color={colors.highlight}>▌</Text>}
                </>
              ) : (
                <Text color={colors.muted}>— press / to search</Text>
              )}
            </>
          ))}
      </Box>
      {vendored?.phase === 'asking' ? (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <VendoredHopForm
            branch={vendored.branch}
            entries={vendored.entries}
            isActive={isInputActive}
            onDone={(picked) => void applyVendored(vendored.branch, picked)}
          />
        </Box>
      ) : (
        <ListDetail
          detailScroll={false}
          key={`${root}:${checkedOut?.name ?? ''}`}
          initialSelectedId={checkedOut ? `l:${checkedOut.name}` : undefined}
          title={`Branches (${shown.length})`}
          items={items}
          emptyText={
            query
              ? `No branch matches "${query}".`
              : 'No branches — this repository has no commits yet.'
          }
          detailTitle={current?.name ?? 'Branch'}
          reservedChrome={['viewHeader', ...reservedChrome]}
          activateLabel="switch"
          activateOnClick={(item) => {
            const now = Date.now();
            const previous = lastClick.current;
            if (previous?.id === item.id && now - previous.at < 400) {
              lastClick.current = undefined;
              return true;
            }
            lastClick.current = { id: item.id, at: now };
            return false;
          }}
          isInputActive={!prompt.isOpen && !isSearching && isInputActive}
          hints={hints}
          onActivate={(item) => item.value && switchTo(item.value)}
          onSelectionChange={(item) => setCurrentId(item?.id)}
          renderDetail={(item) => {
            const branch = item?.value;
            if (!branch) return null;
            const actions = actionsFor(branch);
            return (
              <Box flexDirection="column" flexGrow={1} minHeight={0}>
                {/* The same shape whether Compare is on or off: it is the diff that gives up
                  rows, never the buttons that move. */}
                <Toolbar actions={actions} maxRows={rows - 1} />
                {compare && !branch.isCurrent ? (
                  <PatchLines
                    text={diff}
                    isActive={!prompt.isOpen && !isSearching && isInputActive}
                  />
                ) : (
                  <ScrollPanel
                    key={branch.name}
                    keyboardMode="preview"
                    isActive={!prompt.isOpen && !isSearching && isInputActive}
                  >
                    <Text bold color={branch.isCurrent ? colors.accent : colors.text}>
                      {branch.name}
                    </Text>
                    <Text color={colors.muted} wrap="truncate">
                      {branch.author} · {branch.when} · {branch.subject}
                    </Text>
                    {!branch.isRemote && (
                      <Text color={branch.upstream ? colors.text : colors.warn} wrap="truncate">
                        tracks {branch.upstream || 'nothing'}
                        {branch.upstream ? ` · ${branch.ahead} ahead, ${branch.behind} behind` : ''}
                      </Text>
                    )}
                    {!branch.isRemote && !branch.isCurrent && (
                      <Text color={branch.merged ? colors.ok : colors.muted}>
                        {branch.merged
                          ? `every commit is already in ${checkedOut?.name ?? 'HEAD'} — deleting loses nothing`
                          : 'has commits HEAD does not'}
                      </Text>
                    )}
                  </ScrollPanel>
                )}
              </Box>
            );
          }}
        />
      )}
    </Box>
  );
};

export default BranchesView;
