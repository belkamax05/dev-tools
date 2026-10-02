import { type DOMElement, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { type BmiConfig, userList } from '../../../config/settings';
import {
  type Bookmark,
  coerceBookmark,
  coerceTags,
  displayTitle,
  type Entry,
  findBookmark,
  hostOf,
  isFromWorkspace,
  type Library,
  urlKey,
  withBookmark,
  withoutBookmark,
} from '../../../core/bookmarks';
import type { PreviewCache } from '../../../core/preview';
import search from '../../../core/search';
import BookmarkCard, {
  CARD_CHROME_ROWS,
  CARD_HEIGHT,
  CARD_IMAGE_COLS,
  WORKSPACE_BADGE,
} from '../../BookmarkCard';
import PreviewPane from '../../PreviewPane';
import type { Session, Tone } from '../../types';
import usePreview from '../../usePreview';

export interface BookmarksViewProps {
  library: Library;
  config: BmiConfig;
  cache: PreviewCache;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  onConfigChange: (config: BmiConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  /** Step to the next (1) or previous (-1) tab — Tab still does that while the search has the keys. */
  onTabStep: (step: 1 | -1) => void;
}

//? Ink hands over whatever arrived in one read; only printable characters belong in a query
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const printable = (input: string) => input.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * The search line: focused, it is a text field with a cursor; unfocused, a button that focuses it.
 * Either way a click on it puts the keyboard back in the search.
 */
const SearchLine = ({
  query,
  isFocused,
  summary,
  onFocus,
  onEscape,
}: {
  query: string;
  isFocused: boolean;
  summary: string;
  onFocus: () => void;
  onEscape: () => void;
}) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onFocus, isActive: !isFocused });
  return (
    <Box flexDirection="row">
      <Box ref={ref} flexGrow={1} flexShrink={1} marginRight={1}>
        <Text wrap="truncate">
          <Text color={isFocused || isHovered ? colors.accent : colors.muted}>{'› '}</Text>
          <Text color={colors.text}>{query}</Text>
          {isFocused && <Text color={colors.highlight}>▌</Text>}
          {!query && (
            <Text color={colors.muted}>
              {isFocused
                ? ' type to search title, tags, group, URL, description · #tag filters'
                : ' [/] search'}
            </Text>
          )}
          <Text color={colors.muted}>{`  ${summary}`}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        {isFocused ? (
          <ActionButton hotkey="Esc" label={query ? 'Clear' : 'Hotkeys'} onPress={onEscape} />
        ) : (
          <ActionButton hotkey="/" label="Search" onPress={onFocus} />
        )}
      </Box>
    </Box>
  );
};

/** Drop the empty fields, so a cleared title leaves no `"title": ""` behind in the file. */
const compact = (page: Bookmark): Bookmark => {
  const out: Bookmark = { url: page.url };
  if (page.title) out.title = page.title;
  if (page.description) out.description = page.description;
  if (page.tags?.length) out.tags = page.tags;
  return out;
};

/**
 * Every page in both lists, grouped under their group's name — or, while a search is typed, the
 * pages that match it, best first. Raindrop's main screen, in a terminal.
 *
 * Every edit lands in the user's own list. A workspace page can still be retitled, described or
 * tagged — that writes the page into the user's list with the new words, which win the merge —
 * but only a page the user wrote down can be moved or removed.
 */
export const BookmarksView = ({
  library,
  config,
  cache,
  session,
  notify,
  onConfigChange,
  onCaptureInput,
  onTabStep,
}: BookmarksViewProps) => {
  const colors = useColors();
  //? Search-first, the way rofi opens: the keys go to the query from the moment the tab shows.
  //? Esc hands them to the hotkeys; `/` or a click on the search line takes them back
  const [searching, setSearching] = useState(true);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const prompt = usePrompt(useCallback((open: boolean) => setIsPromptOpen(open), []));
  //? Captured while either has the keyboard, so the app's digits, `q` and Tab type into it
  useEffect(() => {
    onCaptureInput(searching || isPromptOpen);
  }, [searching, isPromptOpen, onCaptureInput]);
  useEffect(() => () => onCaptureInput(false), [onCaptureInput]);
  const [query, setQueryState] = useState(session.query);
  const [groupKey, setGroupKeyState] = useState(session.group);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.bookmarks);
  const [forceKey, setForceKey] = useState(0);
  //? Bumped when a preview lands, so a row with no title of its own picks up the page's
  const [, setPreviewsSeen] = useState(0);

  const setQuery = (next: string) => {
    setQueryState(next);
    session.query = next;
    //? A new search starts at its best hit, not wherever the cursor was in the last one
    setCurrentId(undefined);
  };
  const setGroupKey = (next: string | undefined) => {
    setGroupKeyState(next);
    session.group = next;
  };

  const group = library.groups.find((candidate) => candidate.key === groupKey);
  const scoped = group ? group.entries : library.entries;
  const hits = useMemo(
    () => search(scoped, library.groups, query),
    [scoped, library.groups, query],
  );
  const rows = hits.map((hit) => hit.entry);
  const current = rows.find((entry) => entry.id === currentId) ?? rows[0];
  const list = userList(config);
  const own = (entry: Entry) => findBookmark(list, entry.url, entry.group);

  const preview = usePreview(cache, current?.url, {
    auto: config.autoPreview,
    forceKey,
    onFetched: () => setPreviewsSeen((seen) => seen + 1),
  });

  const titleOf = (entry: Entry) =>
    entry.title ?? cache.get(entry.url)?.title ?? displayTitle(entry);

  const itemFor = (entry: Entry, showGroup: boolean): PickItem<Entry> => {
    const hint = showGroup && entry.group ? entry.group : hostOf(entry.url);
    const fromWorkspace = isFromWorkspace(entry);
    return {
      id: entry.id,
      label: titleOf(entry),
      hint: fromWorkspace ? `${hint} ${WORKSPACE_BADGE}` : hint,
      hintColor: fromWorkspace ? colors.highlight : undefined,
      value: entry,
    };
  };

  const items: PickItem<Entry>[] =
    query.trim() || group
      ? rows.map((entry) => itemFor(entry, !group))
      : [
          ...(library.entries.some((entry) => !entry.group)
            ? [
                { id: 'header:', label: 'Unsorted', isHeader: true },
                ...library.entries
                  .filter((entry) => !entry.group)
                  .map((entry) => itemFor(entry, false)),
              ]
            : []),
          ...library.groups.flatMap((each) => [
            {
              id: `header:${each.key}`,
              label: `${each.name} (${each.entries.length})`,
              isHeader: true,
            },
            ...each.entries.map((entry) => itemFor(entry, false)),
          ]),
        ];

  //? `reveal` for an addition: with the user's bookmarks hidden, a new one would vanish as it lands
  const save = (next: ReturnType<typeof userList>, { reveal = false } = {}) =>
    onConfigChange({ ...config, ...next, ...(reveal && { showUserBookmarks: true }) });

  const open = (entry: Entry | undefined) => {
    if (!entry) return;
    openUrl(entry.url);
    notify(`Opened ${entry.url}`, 'ok');
  };

  const copy = (entry: Entry | undefined) => {
    if (!entry) return;
    copyToClipboard(entry.url);
    notify(`Copied ${entry.url}`, 'ok');
  };

  /** Rewrite one field of a page in the user's list, writing the page there first if needed. */
  const editField = (entry: Entry, field: 'title' | 'description' | 'tags', raw: string) => {
    const base = own(entry) ?? { url: entry.url };
    const value = field === 'tags' ? coerceTags(raw) : raw.trim();
    const next = compact({ ...base, [field]: value });
    save(withBookmark(list, next, entry.group, { replace: true }));
    notify(
      own(entry)
        ? `Saved ${field}`
        : `Saved ${field} — the page is now in your own list too, and your words win`,
      'ok',
    );
  };

  const rename = (entry: Entry | undefined) => {
    if (!entry) return;
    prompt.ask('Title (empty: the page’s own):', (value) => editField(entry, 'title', value), {
      initial: own(entry)?.title ?? entry.title ?? '',
    });
  };

  const describe = (entry: Entry | undefined) => {
    if (!entry) return;
    prompt.ask('Description:', (value) => editField(entry, 'description', value), {
      initial: own(entry)?.description ?? entry.description ?? '',
    });
  };

  const retag = (entry: Entry | undefined) => {
    if (!entry) return;
    const mine = own(entry)?.tags ?? [];
    const fixed = entry.tags.filter((tag) => !mine.includes(tag));
    prompt.ask(
      fixed.length ? `Tags (workspace: ${fixed.join(', ')}) + yours:` : 'Tags (comma separated):',
      (value) => editField(entry, 'tags', value),
      { initial: mine.join(', ') },
    );
  };

  const add = () =>
    prompt.ask(`New bookmark${group ? ` in ${group.name}` : ''} — URL:`, (rawUrl) => {
      const page = coerceBookmark(rawUrl);
      if (!page) {
        if (rawUrl.trim()) notify(`"${rawUrl}" is not a URL`, 'error');
        return;
      }
      prompt.ask('Title (optional — the page’s own otherwise):', (title) => {
        prompt.ask('Tags (optional, comma separated):', (tags) => {
          const next = compact({
            ...page,
            title: title.trim(),
            tags: coerceTags(tags),
          });
          save(withBookmark(list, next, group?.name), { reveal: true });
          setCurrentId(`${group?.key ?? ''}\u0000${urlKey(next.url)}`);
          notify(`Added ${next.url}${group ? ` to ${group.name}` : ''}`, 'ok');
        });
      });
    });

  const move = (entry: Entry | undefined) => {
    if (!entry) return;
    const mine = own(entry);
    if (!mine) {
      notify('This page comes from the workspace list — only your own pages can be moved', 'warn');
      return;
    }
    prompt.ask(
      'Move to group (empty: Unsorted):',
      (value) => {
        const target = library.groups.find(
          (candidate) => candidate.key === value.trim().toLowerCase(),
        );
        const name = target?.name ?? (value.trim() || undefined);
        save(withBookmark(withoutBookmark(list, entry.url, entry.group), mine, name));
        notify(`Moved to ${name ?? 'Unsorted'}`, 'ok');
      },
      { initial: entry.group ?? '' },
    );
  };

  const remove = (entry: Entry | undefined) => {
    if (!entry) return;
    if (!own(entry)) {
      notify(
        'This page comes from the workspace list — bmi never edits that file ([E] in Settings opens it)',
        'warn',
      );
      return;
    }
    prompt.confirm(
      `Remove ${titleOf(entry)} from your list${isFromWorkspace(entry) ? ' (the workspace list keeps it)' : ''}?`,
      () => {
        save(withoutBookmark(list, entry.url, entry.group));
        notify(`Removed ${entry.url}`, 'ok');
      },
    );
  };

  const toggleLayout = () =>
    onConfigChange({
      ...config,
      bookmarkLayout: config.bookmarkLayout === 'grid' ? 'list' : 'grid',
    });

  const toggleUserBookmarks = () => {
    const show = !config.showUserBookmarks;
    onConfigChange({ ...config, showUserBookmarks: show });
    notify(show ? 'Showing your bookmarks too' : 'Workspace bookmarks only — [u] shows yours', 'ok');
  };

  const focusSearch = () => setSearching(true);

  const clearScope = () => {
    if (query) setQuery('');
    else if (group) setGroupKey(undefined);
  };

  /** Esc in the search: the query first, then the keyboard goes to the hotkeys. */
  const escapeSearch = () => {
    if (query) setQuery('');
    else setSearching(false);
  };

  const openImage = () => {
    const image = preview.preview?.image;
    if (image) openUrl(image);
  };

  //? The search field. Arrows and Enter are left to the list, which stays live underneath —
  //? so typing, moving and opening never need a mode switch
  useInput(
    (input, key) => {
      if (key.escape) escapeSearch();
      else if (key.tab) onTabStep(key.shift ? -1 : 1);
      else if (key.backspace || key.delete) setQuery(query.slice(0, -1));
      else if (key.ctrl && input === 'u') setQuery('');
      else if (key.ctrl && input === 'w') setQuery(query.replace(/\S*\s*$/, ''));
      else if (
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.return ||
        key.ctrl ||
        key.meta
      )
        return;
      else {
        const typed = printable(input);
        if (typed) setQuery(query + typed);
      }
    },
    { isActive: searching && !prompt.isOpen },
  );

  useInput(
    (input, key) => {
      if (input === '/') focusSearch();
      else if (input === 'g') toggleLayout();
      else if (input === 'u') toggleUserBookmarks();
      else if (input === 'o') open(current);
      else if (input === 'y') copy(current);
      else if (input === 'a') add();
      else if (input === 'n') rename(current);
      else if (input === 'd') describe(current);
      else if (input === 'T') retag(current);
      else if (input === 'm') move(current);
      else if (input === 'x') remove(current);
      else if (input === 'f' && current) setForceKey((at) => at + 1);
      else if (input === 'i') openImage();
      else if (key.escape) clearScope();
    },
    { isActive: !searching && !prompt.isOpen },
  );

  const actionsFor = (entry: Entry): ToolbarAction[] => {
    const mine = Boolean(own(entry));
    return [
      {
        hotkey: 'Enter',
        label: 'Open',
        onPress: () => open(entry),
        tone: 'primary' as const,
      },
      { hotkey: 'y', label: 'Copy URL', onPress: () => copy(entry) },
      { hotkey: 'n', label: 'Title', onPress: () => rename(entry) },
      { hotkey: 'T', label: 'Tags', onPress: () => retag(entry) },
      { hotkey: 'd', label: 'Description', onPress: () => describe(entry) },
      {
        hotkey: 'f',
        label: 'Fetch preview',
        onPress: () => setForceKey((at) => at + 1),
      },
      ...(preview.preview?.image ? [{ hotkey: 'i', label: 'Open image', onPress: openImage }] : []),
      ...(mine
        ? [
            { hotkey: 'm', label: 'Move', onPress: () => move(entry) },
            {
              hotkey: 'x',
              label: 'Remove',
              onPress: () => remove(entry),
              tone: 'danger' as const,
            },
          ]
        : []),
    ];
  };

  const hints: Hint[] = searching
    ? [
        { key: 'Tab', label: 'next tab', onPress: () => onTabStep(1) },
        { key: 'Esc', label: query ? 'clear' : 'hotkeys', onPress: escapeSearch },
        { key: 'a', label: 'add', onPress: add },
      ]
    : [
        { key: '/', label: 'search', onPress: focusSearch },
        { key: 'a', label: 'add', onPress: add },
        ...(query || group
          ? [
              {
                key: 'Esc',
                label: query ? 'clear search' : 'all groups',
                onPress: clearScope,
              },
            ]
          : []),
      ];

  const noun = query ? 'match' : 'bookmark';
  const summary = `${rows.length} ${noun}${rows.length === 1 ? '' : noun === 'match' ? 'es' : 's'}${group ? ` in ${group.name}` : query ? '' : ` in ${library.groups.length} groups`}`;
  const header = prompt.line ?? (
    <SearchLine
      query={query}
      isFocused={searching}
      summary={summary}
      onFocus={focusSearch}
      onEscape={escapeSearch}
    />
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0} flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          {header}
        </Box>
        {!prompt.isOpen && (
          <Box marginLeft={1} flexShrink={0}>
            <ActionButton
              hotkey="u"
              label={config.showUserBookmarks ? 'Hide yours' : 'Show yours'}
              onPress={toggleUserBookmarks}
            />
          </Box>
        )}
        {!prompt.isOpen && (
          <Box marginLeft={1} flexShrink={0}>
            <ActionButton
              hotkey="g"
              label={config.bookmarkLayout === 'grid' ? 'List view' : 'Grid view'}
              onPress={toggleLayout}
            />
          </Box>
        )}
      </Box>
      <ListDetail
        //? Remount when the set of rows changes, restoring the cursor by id
        key={items.map((item) => item.id).join(',')}
        title={group ? group.name : query ? 'Results' : 'Bookmarks'}
        items={items}
        layout={config.bookmarkLayout}
        gridCellWidth={CARD_IMAGE_COLS + 2}
        gridCellHeight={CARD_HEIGHT}
        renderGridCell={(item, width, selected, height) =>
          item.value ? (
            <BookmarkCard
              entry={item.value}
              cache={cache}
              auto={config.autoPreview}
              width={width}
              selected={selected}
              imageRows={Math.max(1, height - CARD_CHROME_ROWS)}
            />
          ) : null
        }
        emptyText={
          query
            ? `Nothing matches "${query}".`
            : 'No bookmarks yet — [a] adds one, or list them in Settings → your list.'
        }
        detailTitle={current ? titleOf(current) : 'Bookmark'}
        reservedChrome={['viewHeader']}
        activateLabel="open"
        //? A click selects, a second click on the selected row opens it — one stray click
        //? never launches a browser
        confirmClick
        initialSelectedId={current?.id}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => open(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.bookmarks = item?.id;
        }}
        renderDetail={(item) => {
          const entry = item?.value;
          if (!entry) return null;
          const source =
            entry.sources.length > 1
              ? `${WORKSPACE_BADGE} workspace list, with your edits`
              : entry.sources[0] === 'workspace'
                ? `${WORKSPACE_BADGE} workspace list`
                : 'your list';
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(entry)} />
              <LinkRow label="url" value={entry.url} onOpen={() => open(entry)} />
              <LinkRow label="group" value={entry.group ?? 'Unsorted'} />
              {entry.tags.length > 0 && (
                <LinkRow label="tags" value={entry.tags.map((tag) => `#${tag}`).join(' ')} />
              )}
              <LinkRow label="from" value={source} color={colors.muted} />
              {entry.description && (
                <Box marginTop={1}>
                  <Text color={colors.text} wrap="wrap">
                    {entry.description}
                  </Text>
                </Box>
              )}
              <PreviewPane url={entry.url} state={preview} auto={config.autoPreview} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default BookmarksView;
