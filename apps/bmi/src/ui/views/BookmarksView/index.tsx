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

import {
  BOOKMARK_LAYOUTS,
  type BmiConfig,
  type BookmarkLayout,
  userList,
} from '../../../config/settings';
import {
  type Bookmark,
  coerceBookmark,
  categoriesOf,
  coerceTags,
  displayTitle,
  type Entry,
  entriesTagged,
  findBookmark,
  findTag,
  hostOf,
  isFromWorkspace,
  type Library,
  placementOf,
  urlKey,
  withBookmark,
  withoutBookmark,
} from '../../../core/bookmarks';
import type { PreviewCache } from '../../../core/preview';
import search from '../../../core/search';
import BookmarkCard, { CARD_CHROME_ROWS, CARD_HEIGHT, CARD_IMAGE_COLS } from '../../BookmarkCard';
import BookmarkTile, { TILE_HEIGHT, TILE_MIN_COLS } from '../../BookmarkTile';
import PreviewPane from '../../PreviewPane';
import { WORKSPACE_BADGE } from '../../WorkspaceChip';
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
/** What the `g` button offers — the layout it switches to. */
const LAYOUT_LABELS: Record<BookmarkLayout, string> = {
  list: 'List view',
  grid: 'Grid view',
  tiles: 'Tiles view',
};

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
                ? ' type to search title, tags, category, URL, description · #tag filters'
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
 * Every page in both lists, under each category it is filed in — or, while a search is typed or a
 * tag is in view, the pages that match, best first. Raindrop's main screen, in a terminal.
 *
 * Every edit lands in the user's own list. A workspace page can still be retitled, described or
 * tagged — that writes the page into the user's list with the new words, which win the merge —
 * but only a page of the user's own can be moved (its categories swapped) or removed.
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
  const [tagKey, setTagKeyState] = useState(session.tag);
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
  const setTagKey = (next: string | undefined) => {
    setTagKeyState(next);
    session.tag = next;
  };

  //? The tag in view, as a key: one the library no longer has still scopes (to nothing), so a
  //? category emptied by an edit does not silently widen to every page
  const scope = tagKey !== undefined ? (findTag(library, tagKey) ?? { key: tagKey }) : undefined;
  const scoped = useMemo(
    () => (scope ? entriesTagged(library, scope.key) : library.entries),
    [library, scope?.key],
  );
  const hits = useMemo(
    () => search(scoped, library.tags, query),
    [scoped, library.tags, query],
  );
  const rows = hits.map((hit) => hit.entry);
  const list = userList(config);
  const own = (entry: Entry) => findBookmark(list, entry.url);
  const categories = categoriesOf(library);

  const titleOf = (entry: Entry) =>
    entry.title ?? cache.get(entry.url)?.title ?? displayTitle(entry);

  const itemFor = (entry: Entry, section?: string): PickItem<Entry> => {
    //? Under a section header the category goes without saying; in a flat list it is the hint
    const placed = section === undefined ? placementOf(entry, library) : [];
    const hint = placed.length ? placed.join(', ') : hostOf(entry.url);
    const fromWorkspace = isFromWorkspace(entry);
    return {
      //? A page filed in two categories is listed twice, so its rows need ids of their own
      id: section === undefined ? entry.id : `${section}\u0000${entry.id}`,
      label: titleOf(entry),
      hint: fromWorkspace ? `${hint} ${WORKSPACE_BADGE}` : hint,
      hintColor: fromWorkspace ? colors.highlight : undefined,
      value: entry,
    };
  };

  //? Rebuilt every render, not memoised: a row with no title of its own picks up its page's as
  //? the preview lands
  const buildItems = (): PickItem<Entry>[] => {
    if (query.trim() || scope) return rows.map((entry) => itemFor(entry));
    const placed = new Map(library.entries.map((entry) => [entry.id, placementOf(entry, library)]));
    const unsorted = library.entries.filter((entry) => !placed.get(entry.id)?.length);
    return [
      ...(unsorted.length
        ? [
            { id: 'header:', label: `Unsorted (${unsorted.length})`, isHeader: true },
            ...unsorted.map((entry) => itemFor(entry, '')),
          ]
        : []),
      //? Each category lists the pages filed right in it; one with nothing directly in it (only
      //? in its subcategories) is left out — its children carry the path
      ...categories.flatMap((tag) => {
        const here = library.entries.filter((entry) => placed.get(entry.id)?.includes(tag.key));
        return here.length
          ? [
              { id: `header:${tag.key}`, label: `${tag.key} (${here.length})`, isHeader: true },
              ...here.map((entry) => itemFor(entry, tag.key)),
            ]
          : [];
      }),
    ];
  };
  const items = buildItems();
  const current =
    items.find((item) => item.id === currentId && item.value)?.value ??
    items.find((item) => item.value)?.value;

  const preview = usePreview(cache, current?.url, {
    auto: config.autoPreview,
    forceKey,
    onFetched: () => setPreviewsSeen((seen) => seen + 1),
  });

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
    save(withBookmark(list, next, { replace: true }));
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
    prompt.ask(`New bookmark${scope ? ` in ${scope.key}` : ''} — URL:`, (rawUrl) => {
      const page = coerceBookmark(rawUrl);
      if (!page) {
        if (rawUrl.trim()) notify(`"${rawUrl}" is not a URL`, 'error');
        return;
      }
      prompt.ask('Title (optional — the page’s own otherwise):', (title) => {
        prompt.ask(
          'Tags (comma separated — a category among them files it there):',
          (tags) => {
            const next = compact({
              ...page,
              title: title.trim(),
              tags: coerceTags(tags),
            });
            save(withBookmark(list, next), { reveal: true });
            setCurrentId(urlKey(next.url));
            notify(`Added ${next.url}`, 'ok');
          },
          //? Added from inside a tag, the page starts in it
          { initial: scope?.key ?? '' },
        );
      });
    });

  /**
   * Swap the page's categories for others, keeping its plain tags. Only for a page that is the
   * user's alone: a workspace page's categories are the workspace's, and `T` adds to them instead.
   */
  const move = (entry: Entry | undefined) => {
    if (!entry) return;
    const mine = own(entry);
    if (!mine || isFromWorkspace(entry)) {
      notify(
        'This page comes from the workspace list — [T] adds categories to it, it cannot be moved',
        'warn',
      );
      return;
    }
    const declared = new Set(categories.map((tag) => tag.key));
    const isCategory = (tag: string) => declared.has(tag) || tag.includes('/');
    const placed = placementOf(entry, library);
    prompt.ask(
      `Move to categories (comma separated, empty: Unsorted) — ${categories.map((tag) => tag.key).join(', ') || 'none yet'}:`,
      (value) => {
        const chosen = coerceTags(value);
        const unknown = chosen.filter((tag) => !declared.has(tag));
        const kept = (mine.tags ?? []).filter((tag) => !isCategory(tag) && !chosen.includes(tag));
        let next = withBookmark(list, compact({ ...mine, tags: [...chosen, ...kept] }), {
          replace: true,
        });
        //? A new name is a new category: declared in the user's list, so it gets a section
        for (const tag of unknown) next = { ...next, tags: { ...next.tags, [tag]: {} } };
        save(next);
        notify(`Moved to ${chosen.join(', ') || 'Unsorted'}`, 'ok');
      },
      { initial: placed.join(', ') },
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
        save(withoutBookmark(list, entry.url));
        notify(`Removed ${entry.url}`, 'ok');
      },
    );
  };

  const tiles = config.bookmarkLayout === 'tiles';
  const nextLayout =
    BOOKMARK_LAYOUTS[
      (BOOKMARK_LAYOUTS.indexOf(config.bookmarkLayout) + 1) % BOOKMARK_LAYOUTS.length
    ] ?? 'list';
  const toggleLayout = () => onConfigChange({ ...config, bookmarkLayout: nextLayout });

  const toggleThumbnails = () => {
    if (config.bookmarkLayout !== 'grid') return;
    onConfigChange({ ...config, showThumbnails: !config.showThumbnails });
  };

  const toggleUserBookmarks = () => {
    const show = !config.showUserBookmarks;
    onConfigChange({ ...config, showUserBookmarks: show });
    notify(show ? 'Showing your bookmarks too' : 'Workspace bookmarks only — [u] shows yours', 'ok');
  };

  const focusSearch = () => setSearching(true);

  const clearScope = () => {
    if (query) setQuery('');
    else if (scope) setTagKey(undefined);
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
      else if (input === 'p') toggleThumbnails();
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
        ...(query || scope
          ? [
              {
                key: 'Esc',
                label: query ? 'clear search' : 'all pages',
                onPress: clearScope,
              },
            ]
          : []),
      ];

  const noun = query ? 'match' : 'bookmark';
  const summary = `${rows.length} ${noun}${rows.length === 1 ? '' : noun === 'match' ? 'es' : 's'}${scope ? ` in ${scope.key}` : query ? '' : ` in ${categories.length} categories`}`;
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
        {!prompt.isOpen && config.bookmarkLayout === 'grid' && (
          <Box marginLeft={1} flexShrink={0}>
            <ActionButton
              hotkey="p"
              label={config.showThumbnails ? 'Hide images' : 'Show images'}
              onPress={toggleThumbnails}
            />
          </Box>
        )}
        {!prompt.isOpen && (
          <Box marginLeft={1} flexShrink={0}>
            <ActionButton hotkey="g" label={LAYOUT_LABELS[nextLayout]} onPress={toggleLayout} />
          </Box>
        )}
      </Box>
      <ListDetail
        //? Remount when the set of rows changes, restoring the cursor by id
        key={items.map((item) => item.id).join(',')}
        title={scope ? scope.key : query ? 'Results' : 'Bookmarks'}
        items={items}
        //? Tiles are a grid too, just with smaller cells: the width is a minimum the row is shared
        //? out from, so either kind stretches to fill it
        layout={config.bookmarkLayout === 'list' ? 'list' : 'grid'}
        gridCellWidth={tiles ? TILE_MIN_COLS : CARD_IMAGE_COLS + 2}
        gridCellHeight={tiles ? TILE_HEIGHT : config.showThumbnails ? CARD_HEIGHT : CARD_CHROME_ROWS}
        renderGridCell={(item, width, selected, height) =>
          !item.value ? null : tiles ? (
            <BookmarkTile
              entry={item.value}
              cache={cache}
              auto={config.autoPreview}
              width={width}
              selected={selected}
            />
          ) : (
            <BookmarkCard
              entry={item.value}
              cache={cache}
              auto={config.autoPreview}
              width={width}
              selected={selected}
              imageRows={Math.max(1, height - CARD_CHROME_ROWS)}
              showImage={config.showThumbnails}
            />
          )
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
        initialSelectedId={currentId ?? items.find((item) => item.value)?.id}
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
              <LinkRow
                label="in"
                value={placementOf(entry, library).join(', ') || 'Unsorted'}
              />
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
