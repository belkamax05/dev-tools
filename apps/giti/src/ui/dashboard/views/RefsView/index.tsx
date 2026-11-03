import { Text, useInput } from 'ink';
import { useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  deleteRef,
  getAdvertisedRefs,
  getRefDetail,
  getRefs,
  getRemoteNames,
  type RefEntry,
  restoreRef,
  splitRefName,
} from '../../../../core/refs';
import copyToClipboard from '../../clipboard';
import PatchLines, { PATCH_SCROLL_HINT } from '../../PatchLines';
import SpinnerGlyph from '../../SpinnerGlyph';
import type { GitViewProps } from '../../types';

type DetailMode = 'info' | 'object' | 'reflog' | 'preview';

const MODES: { mode: DetailMode; hotkey: string; label: string }[] = [
  { mode: 'info', hotkey: '1', label: 'Info' },
  { mode: 'object', hotkey: '2', label: 'Object' },
  { mode: 'reflog', hotkey: '3', label: 'Reflog' },
  { mode: 'preview', hotkey: '4', label: 'Preview' },
];

/** A group's heading: the namespace as a pattern, or what a remote advertised. */
const groupTitle = (group: string) =>
  !group ? 'root refs' : group.endsWith(':') ? `${group.slice(0, -1)} · ls-remote` : `${group}/*`;

//? `reload` is called after a delete, never bound to `r`: that key is the host's
export type RefsViewProps = Pick<
  GitViewProps,
  'root' | 'refreshKey' | 'reload' | 'notify' | 'onCaptureInput' | 'offerUndo' | 'reservedChrome'
> & {
  /** Measure the list to a host that sets the height — the standalone screen. */
  fitToHost?: boolean;
  /** Appended to the view's own hints — the standalone screen's quit. */
  extraHints?: Hint[];
};

/**
 * Every ref in the repository, grouped by family, with the selected one taken apart beside it:
 * what it is and where it is stored (Info), the raw object (`cat-file -p`), its reflog, and what
 * the object holds (Preview — a commit's patch, a merge's per parent). `L` adds what each remote
 * advertises, set against what has been fetched. `x` deletes the selected ref — locally, or on its
 * remote for an advertised one — after asking, and offers the undo.
 */
export const RefsView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  offerUndo,
  reservedChrome,
  fitToHost = false,
  extraHints = [],
}: RefsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput, { inlineConfirm: true });
  const [currentId, setCurrentId] = useState<string>();
  const [mode, setMode] = useState<DetailMode>('info');
  const [filter, setFilter] = useState('');
  const [advertised, setAdvertised] = useState<RefEntry[]>();
  const [readingRemotes, setReadingRemotes] = useState(false);

  const { data: refs = [], isLoading, error } = useLoader(() => getRefs(root), [root, refreshKey]);
  const all = [...refs, ...(advertised ?? [])];
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? all.filter(
        (ref) =>
          ref.name.toLowerCase().includes(needle) ||
          ref.id.toLowerCase().includes(needle) ||
          ref.hash.startsWith(needle) ||
          ref.subject.toLowerCase().includes(needle),
      )
    : all;
  const current = shown.find((ref) => ref.id === currentId);

  const { data: detail, isLoading: readingDetail } = useLoader(
    () => (current ? getRefDetail(root, current) : Promise.resolve(undefined)),
    [current?.id, current?.hash, refreshKey],
  );

  const toggleRemotes = async () => {
    if (advertised) return setAdvertised(undefined);
    setReadingRemotes(true);
    try {
      const remotes = await getRemoteNames(root);
      if (!remotes.length) return notify('No remotes to list refs from.', 'warn');
      const settled = await Promise.allSettled(
        remotes.map((remote) => getAdvertisedRefs(root, remote, refs)),
      );
      const failed = settled.flatMap((result) =>
        result.status === 'rejected' ? [String((result.reason as Error).message)] : [],
      );
      setAdvertised(
        settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      );
      notify(
        failed.length ? failed.join(' · ') : `Listed refs on ${remotes.join(', ')}`,
        failed.length ? 'error' : 'ok',
      );
    } finally {
      setReadingRemotes(false);
    }
  };

  const copy = (text: string, what: string) => {
    if (!text) return;
    copyToClipboard(text);
    notify(`Copied ${what} to the clipboard`, 'ok');
  };

  const remove = (ref: RefEntry) =>
    prompt.confirm(
      ref.remote
        ? `Delete ${ref.name} on ${ref.remote}, for everyone who fetches it?`
        : `Delete ${ref.name} (${ref.hash.slice(0, 8) || ref.symref})? Its reflog goes with it.`,
      async () => {
        const result = await deleteRef(root, ref);
        notify(result.message, result.ok ? 'ok' : 'error');
        if (!result.ok) return;
        const restore = result.restore;
        if (restore)
          offerUndo({
            label: result.message,
            run: async () => {
              const back = await restoreRef(root, restore);
              //? A remote's listing is a snapshot: read it again to show the ref back
              if (back.ok && restore.remote) setAdvertised(undefined);
              reload();
              return back;
            },
          });
        if (ref.remote) setAdvertised((was) => was?.filter((entry) => entry.id !== ref.id));
        reload();
      },
    );

  const search = () => {
    const before = filter;
    prompt.ask('Filter refs (name, hash, subject):', setFilter, {
      initial: filter,
      onChange: setFilter,
      onCancel: () => setFilter(before),
    });
  };

  useInput(
    (input) => {
      if (input === '/') return search();
      if (input === 'L') return void toggleRemotes();
      const picked = MODES.find((entry) => entry.hotkey === input);
      if (picked) return setMode(picked.mode);
      if (!current) return;
      if (input === 'x') remove(current);
      else if (input === 'y') copy(current.hash, current.hash.slice(0, 12));
      else if (input === 'Y') copy(current.name, current.name);
    },
    { isActive: !prompt.isOpen },
  );

  //? Groups in the order the refs come — root first, namespaces by name, then each remote's listing
  const groups = [...new Set(shown.map((ref) => ref.group))];
  const items: PickItem<RefEntry>[] = groups.flatMap((name) => {
    const group = shown.filter((ref) => ref.group === name);
    return [
      { id: `header:${name}`, label: `${groupTitle(name)} (${group.length})`, isHeader: true },
      ...group.map((ref) => ({
        id: ref.id,
        label: ref.short,
        prefix: ref.isHead
          ? { text: '* ', color: colors.ok }
          : ref.symref
            ? { text: '→ ', color: colors.accent }
            : undefined,
        tag: ref.symref
          ? splitRefName(ref.symref).short
          : ref.type === 'missing'
            ? 'missing'
            : undefined,
        hint: ref.remote
          ? `${ref.hash.slice(0, 8)} · ${ref.fetched}`
          : [ref.hash.slice(0, 8), ref.track, ref.when].filter(Boolean).join(' · '),
        hintColor:
          ref.fetched === 'differs' || ref.track?.includes('gone')
            ? colors.warn
            : ref.fetched === 'not fetched'
              ? colors.error
              : undefined,
        value: ref,
      })),
    ];
  });

  //? The views are a tab row of their own: in the Toolbar, past three buttons it stacks a line each
  const actionsFor = (ref: RefEntry): ToolbarAction[] => [
    { hotkey: 'y', label: 'Copy hash', onPress: () => copy(ref.hash, ref.hash.slice(0, 12)) },
    { hotkey: 'Y', label: 'Copy name', onPress: () => copy(ref.name, ref.name) },
    { hotkey: 'x', label: 'Delete', onPress: () => remove(ref), tone: 'danger' },
  ];

  const hints: Hint[] = [
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: search },
    {
      key: 'L',
      label: advertised ? 'hide remote refs' : 'list remote refs',
      onPress: () => void toggleRemotes(),
    },
    ...(mode === 'info' ? [] : [PATCH_SCROLL_HINT]),
    ...extraHints,
  ];

  const counts = [...new Set(refs.map((ref) => ref.group))]
    .map((name) => `${refs.filter((ref) => ref.group === name).length} ${name || 'root'}`)
    .join(' · ');

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text wrap="truncate" color={error ? colors.error : colors.muted}>
            {(isLoading && !refs.length) || readingRemotes ? <SpinnerGlyph /> : null}
            {error
              ? String(error)
              : isLoading && !refs.length
                ? 'Reading refs…'
                : readingRemotes
                  ? 'Asking the remotes what they advertise…'
                  : `${refs.length} refs · ${counts}${filter ? ` · ${shown.length} match “${filter}”` : ''}`}
          </Text>
        )}
      </Box>
      <ListDetail
        question={prompt.question}
        detailScroll={false}
        title={`Refs (${shown.length})`}
        items={items}
        emptyText={isLoading ? '' : filter ? `No ref matches “${filter}”.` : 'No refs.'}
        detailTitle={current ? current.name : 'Ref'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="next view"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        fitToHost={fitToHost}
        hints={hints}
        onActivate={() =>
          setMode(
            (was) =>
              MODES[(MODES.findIndex((entry) => entry.mode === was) + 1) % MODES.length]?.mode ??
              'info',
          )
        }
        onSelectionChange={(item) => setCurrentId(item?.value ? item.id : undefined)}
        renderDetail={(item) => {
          const ref = item?.value;
          if (!ref) return null;
          return (
            <Box flexDirection="column" flexGrow={1} minHeight={0}>
              <Box flexDirection="row" flexShrink={0}>
                {MODES.map((entry) => (
                  <Box key={entry.mode} marginRight={1}>
                    <ActionButton
                      hotkey={entry.hotkey}
                      label={entry.label}
                      isOn={mode === entry.mode}
                      onPress={() => setMode(entry.mode)}
                    />
                  </Box>
                ))}
              </Box>
              <Toolbar actions={actionsFor(ref)} />
              {!detail || readingDetail ? (
                <Text color={colors.muted}>
                  <SpinnerGlyph /> Reading {ref.name}…
                </Text>
              ) : mode === 'info' ? (
                <ScrollPanel key={ref.id} keyboardMode="preview" isActive={!prompt.isOpen}>
                  {detail.info.map(([label, value], index) => (
                    <Text key={`${label}-${index}`} wrap="truncate">
                      <Text color={colors.accent}>{label.padEnd(12)}</Text>
                      <Text color={colors.text}>{value}</Text>
                    </Text>
                  ))}
                </ScrollPanel>
              ) : (
                <PatchLines
                  text={
                    mode === 'object'
                      ? detail.raw
                      : mode === 'reflog'
                        ? detail.reflog
                        : detail.preview
                  }
                  isActive={!prompt.isOpen}
                />
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default RefsView;
