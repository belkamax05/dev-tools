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
import hotkeys from '@/dev-tools/config/hotkeys';

import {
  type DeletedRef,
  deleteRef,
  findCounterparts,
  getAdvertisedRefs,
  getRefDetail,
  getRefs,
  getRemoteNames,
  type RefCounterpart,
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

  //? Deleting asks where: the side the ref is on, or that side and what the other side holds of
  //? it — looked up first (`ls-remote` for a local ref), so the choice names real refs. `x`
  //? again deletes the side it is on, Shift+X both — the suite's delete and its bigger variant
  const [pending, setPending] = useState<{
    ref: RefEntry;
    counterparts?: RefCounterpart[];
    errors?: string[];
    /** Ids of the counterparts that go along with Shift. */
    ticked: Set<string>;
    cursor: number;
  }>();
  const remove = (ref: RefEntry) => {
    setPending({ ref, ticked: new Set(), cursor: 0 });
    onCaptureInput(true);
    const settle = ({
      counterparts,
      errors,
    }: {
      counterparts: RefCounterpart[];
      errors: string[];
    }) => {
      //? A refspec or the same name says it is this ref; the same object alone could be chance,
      //? so it starts ticked only when nothing says more
      const strong = counterparts.filter((counterpart) => counterpart.reason !== 'same object');
      const ticked = new Set((strong.length ? strong : counterparts).map((c) => c.ref.id));
      setPending((was) =>
        was?.ref.id === ref.id ? { ref, counterparts, errors, ticked, cursor: 0 } : was,
      );
    };
    findCounterparts(root, ref, refs).then(settle, (failure: Error) =>
      settle({ counterparts: [], errors: [failure.message] }),
    );
  };
  const closeDelete = () => {
    setPending(undefined);
    onCaptureInput(false);
  };
  const runDelete = async (ref: RefEntry, also: RefEntry[]) => {
    closeDelete();
    const targets = [ref, ...also];
    const restores: DeletedRef[] = [];
    const said: string[] = [];
    let failed = false;
    for (const target of targets) {
      const result = await deleteRef(root, target);
      said.push(result.message);
      if (result.restore) restores.push(result.restore);
      //? Stop at the first refusal: what is left stays as it was, and the undo covers the rest
      if (!result.ok) {
        failed = true;
        break;
      }
    }
    notify(said.join(' · '), failed ? 'error' : 'ok');
    if (restores.length)
      offerUndo({
        label: said.join(' · '),
        run: async () => {
          const back = await Promise.all(restores.map((restore) => restoreRef(root, restore)));
          //? A remote's listing is a snapshot: read it again to show the ref back
          if (restores.some((restore) => restore.remote)) setAdvertised(undefined);
          reload();
          return {
            ok: back.every((result) => result.ok),
            message: back.map((result) => result.message).join(' · '),
          };
        },
      });
    setAdvertised((was) =>
      was?.filter((entry) => !targets.some((target) => target.id === entry.id)),
    );
    reload();
  };

  const tickedRefs = (pending?.counterparts ?? [])
    .filter((counterpart) => pending?.ticked.has(counterpart.ref.id))
    .map((counterpart) => counterpart.ref);
  const deleteOneSide = () => pending && void runDelete(pending.ref, []);
  const deleteBothSides = () =>
    pending && tickedRefs.length && void runDelete(pending.ref, tickedRefs);
  const toggle = (id: string) =>
    setPending((was) => {
      if (!was) return was;
      const ticked = new Set(was.ticked);
      if (!ticked.delete(id)) ticked.add(id);
      return { ...was, ticked };
    });

  useInput(
    (input, key) => {
      if (!pending) return;
      if (key.escape || input === 'N' || input === 'n') return closeDelete();
      if (input === hotkeys.delete) return deleteOneSide();
      if (input === hotkeys.deleteMore) return deleteBothSides();
      const count = pending.counterparts?.length ?? 0;
      if (key.upArrow || key.downArrow)
        return setPending({
          ...pending,
          cursor: (pending.cursor + (key.upArrow ? count - 1 : 1)) % Math.max(1, count),
        });
      const at = pending.counterparts?.[pending.cursor];
      if (input === ' ' && at) toggle(at.ref.id);
    },
    { isActive: Boolean(pending) },
  );

  const describeRef = (ref: RefEntry) => (ref.remote ? `${ref.remote}: ${ref.name}` : ref.name);
  const thisSide = pending?.ref.remote ? 'Remote' : 'Local';
  const otherSide = pending?.ref.remote ? 'local' : 'remote';
  const deleteQuestion = pending && (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color={colors.warn} bold wrap="wrap">
        Delete {describeRef(pending.ref)}?{' '}
        {pending.ref.remote ? 'Gone for everyone who fetches it.' : 'Its reflog goes with it.'}
      </Text>
      {!pending.counterparts ? (
        <Text color={colors.muted}>
          <SpinnerGlyph /> Looking for it {pending.ref.remote ? 'locally' : 'on the remotes'}…
        </Text>
      ) : pending.counterparts.length ? (
        <>
          <Text color={colors.muted}>
            Also {pending.ref.remote ? 'here' : 'on the remotes'}
            {pending.counterparts.length > 1 ? ' — ↑/↓ and Space or a click tick them' : ''}:
          </Text>
          {pending.counterparts.map((counterpart, index) => (
            <Box key={counterpart.ref.id} flexDirection="row">
              <Text color={colors.accent}>
                {pending.counterparts && pending.counterparts.length > 1 && index === pending.cursor
                  ? '❯ '
                  : '  '}
              </Text>
              <ActionButton
                label={`${pending.ticked.has(counterpart.ref.id) ? '[x]' : '[ ]'} ${describeRef(counterpart.ref)}`}
                color={colors.text}
                onPress={() => toggle(counterpart.ref.id)}
              />
              <Text color={colors.muted}> · {counterpart.reason}</Text>
            </Box>
          ))}
        </>
      ) : (
        <Text color={colors.muted}>
          Nothing matches it {pending.ref.remote ? 'locally' : 'on any remote'}.
        </Text>
      )}
      {pending.errors?.length ? (
        <Text color={colors.error} wrap="truncate">
          {pending.errors.join(' · ')}
        </Text>
      ) : null}
      <Box flexDirection="row">
        <ActionButton
          hotkey={hotkeys.delete}
          label={`${thisSide} only`}
          color={colors.warn}
          bordered
          onPress={deleteOneSide}
        />
        <ActionButton
          hotkey={hotkeys.deleteMore}
          label={`${thisSide} + ${otherSide}${tickedRefs.length ? ` (${tickedRefs.length})` : ''}`}
          color={colors.warn}
          bordered
          disabled={!tickedRefs.length}
          onPress={deleteBothSides}
        />
        <ActionButton
          hotkey="N"
          label="Cancel"
          color={colors.text}
          bordered
          onPress={closeDelete}
        />
      </Box>
    </Box>
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
      if (input === hotkeys.search) return search();
      if (input === 'L') return void toggleRemotes();
      const picked = MODES.find((entry) => entry.hotkey === input);
      if (picked) return setMode(picked.mode);
      if (!current) return;
      if (input === hotkeys.delete) remove(current);
      else if (input === hotkeys.copy) copy(current.hash, current.hash.slice(0, 12));
      else if (input === 'Y') copy(current.name, current.name);
    },
    { isActive: !prompt.isOpen && !pending },
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
    { hotkey: hotkeys.copy, label: 'Copy hash', onPress: () => copy(ref.hash, ref.hash.slice(0, 12)) },
    { hotkey: 'Y', label: 'Copy name', onPress: () => copy(ref.name, ref.name) },
    { hotkey: hotkeys.delete, label: 'Delete', onPress: () => remove(ref), tone: 'danger' },
  ];

  const hints: Hint[] = [
    { key: hotkeys.search, label: filter ? `filter: ${filter}` : 'filter', onPress: search },
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
        question={deleteQuestion || prompt.question}
        detailScroll={false}
        title={`Refs (${shown.length})`}
        items={items}
        emptyText={isLoading ? '' : filter ? `No ref matches “${filter}”.` : 'No refs.'}
        detailTitle={current ? current.name : 'Ref'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="next view"
        activateOnClick={false}
        isInputActive={!prompt.isOpen && !pending}
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
