import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import { type BmiConfig, userList } from '../../../config/settings';
import {
  categoriesOf,
  displayTitle,
  isFromWorkspace,
  type Library,
  normalizeTag,
  type Tag,
  withoutTag,
  withTag,
} from '../../../core/bookmarks';
import type { Session, Tone } from '../../types';
import { WORKSPACE_BADGE } from '../../WorkspaceChip';

const plural = (count: number, noun: string, nouns = `${noun}s`) =>
  `${count} ${count === 1 ? noun : nouns}`;

/** Opening more pages than this at once asks first — a misfire would bury the browser. */
const OPEN_ALL_WITHOUT_ASKING = 5;

/** How many of a tag's pages the detail pane names before it says how many more there are. */
const PAGES_LISTED = 12;

export interface TagsViewProps {
  library: Library;
  config: BmiConfig;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  onConfigChange: (config: BmiConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  /** Show the tag's pages on the Bookmarks tab. */
  onShowTag: (key: string) => void;
}

/**
 * Every tag, categories first: the declared ones as a tree, each with its description and pages,
 * then the plain tags pages carry. Enter shows a tag's pages on the Bookmarks tab, `O` opens all of
 * them at once — the morning's jira boards in one key — and `c` makes a plain tag a category.
 */
export const TagsView = ({
  library,
  config,
  session,
  notify,
  onConfigChange,
  onCaptureInput,
  onShowTag,
}: TagsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.tags);
  const current = library.tags.find((tag) => tag.key === currentId) ?? library.tags[0];
  const list = userList(config);
  const isOwn = (tag: Tag) => tag.key in list.tags;
  const categories = categoriesOf(library);
  const plain = library.tags.filter((tag) => !tag.declared);

  //? `reveal` for an addition: with the user's bookmarks hidden, a new category would vanish as
  //? it lands
  const save = (next: ReturnType<typeof userList>, { reveal = false } = {}) =>
    onConfigChange({ ...config, ...next, ...(reveal && { showUserBookmarks: true }) });

  const openAll = (tag: Tag | undefined) => {
    if (!tag?.entries.length) return;
    const go = () => {
      for (const entry of tag.entries) openUrl(entry.url);
      notify(`Opened ${tag.entries.length} pages from ${tag.key}`, 'ok');
    };
    if (tag.entries.length <= OPEN_ALL_WITHOUT_ASKING) go();
    else prompt.confirm(`Open all ${tag.entries.length} pages of ${tag.key}?`, go);
  };

  const add = () =>
    prompt.ask('New category — name (a/b nests it under a):', (rawName) => {
      const key = normalizeTag(rawName);
      if (!key) return;
      if (categories.some((tag) => tag.key === key)) {
        notify(`${key} is a category already`, 'warn');
        return;
      }
      prompt.ask('Description (optional):', (description) => {
        save(
          withTag(list, key, description.trim() ? { description: description.trim() } : {}),
          { reveal: true },
        );
        setCurrentId(key);
        notify(`Added ${key} — tag a page with it, or [Enter] then [a] adds one`, 'ok');
      });
    });

  /** Declare a plain tag, so the pages carrying it get a section of their own. */
  const promote = (tag: Tag | undefined) => {
    if (!tag || tag.declared) return;
    save(withTag(list, tag.key));
    notify(`${tag.key} is a category now`, 'ok');
  };

  /** Write the description into the user's list — a workspace category gets an override. */
  const describe = (tag: Tag | undefined) => {
    if (!tag?.declared) return;
    prompt.ask(
      'Description:',
      (value) => {
        const { description: _old, ...meta } = list.tags[tag.key] ?? {};
        const description = value.trim();
        save({
          ...list,
          tags: { ...list.tags, [tag.key]: { ...meta, ...(description && { description }) } },
        });
        notify('Saved description', 'ok');
      },
      { initial: tag.description ?? '' },
    );
  };

  const remove = (tag: Tag | undefined) => {
    if (!tag?.declared) return;
    if (!isOwn(tag)) {
      notify('This category comes from the workspace list — bmi never edits that file', 'warn');
      return;
    }
    prompt.confirm(
      `Stop using ${tag.key} as a category? Your pages keep everything but this tag.`,
      () => {
        save(withoutTag(list, tag.key));
        notify(
          isFromWorkspace(tag)
            ? `Removed your additions to ${tag.key}; the workspace list keeps it`
            : `Removed ${tag.key}; its pages are still there`,
          'ok',
        );
      },
    );
  };

  useInput(
    (input) => {
      if (input === 'O') openAll(current);
      else if (input === 'a') add();
      else if (input === 'c') promote(current);
      else if (input === 'd') describe(current);
      else if (input === 'x') remove(current);
    },
    { isActive: !prompt.isOpen },
  );

  const itemFor = (tag: Tag): PickItem<Tag> => ({
    id: tag.key,
    //? Indented by depth, with only the last segment: the tree says the rest
    label: tag.declared ? `${'  '.repeat(tag.depth)}${tag.name}` : `#${tag.key}`,
    hint: isFromWorkspace(tag)
      ? `${tag.entries.length} ${WORKSPACE_BADGE}`
      : `${tag.entries.length}`,
    hintColor: isFromWorkspace(tag) ? colors.highlight : undefined,
    value: tag,
  });

  const items: PickItem<Tag>[] = [
    ...(categories.length
      ? [{ id: 'header:categories', label: 'Categories', isHeader: true }]
      : []),
    ...categories.map(itemFor),
    ...(plain.length ? [{ id: 'header:tags', label: 'Other tags', isHeader: true }] : []),
    ...plain.map(itemFor),
  ];

  const actionsFor = (tag: Tag): ToolbarAction[] => [
    {
      hotkey: 'Enter',
      label: 'Show pages',
      onPress: () => onShowTag(tag.key),
      tone: 'primary',
    },
    {
      hotkey: 'O',
      label: 'Open all',
      onPress: () => openAll(tag),
      disabled: !tag.entries.length,
    },
    ...(tag.declared
      ? [{ hotkey: 'd', label: 'Description', onPress: () => describe(tag) }]
      : [{ hotkey: 'c', label: 'Make category', onPress: () => promote(tag) }]),
    ...(tag.declared && isOwn(tag)
      ? [
          {
            hotkey: 'x',
            label: 'Remove',
            onPress: () => remove(tag),
            tone: 'danger' as const,
          },
        ]
      : []),
  ];

  const hints: Hint[] = [{ key: 'a', label: 'new category', onPress: add }];

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {`${plural(categories.length, 'category', 'categories')} · ${plural(plain.length, 'other tag')}`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        title="Tags"
        items={items}
        emptyText="No tags yet — [a] makes a category."
        detailTitle={current?.key ?? 'Tag'}
        reservedChrome={['viewHeader']}
        activateLabel="show pages"
        //? A click selects, a second click on the selected tag shows its pages
        confirmClick
        initialSelectedId={current?.key}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => item.value && onShowTag(item.value.key)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.tags = item?.id;
        }}
        renderDetail={(item) => {
          const tag = item?.value;
          if (!tag) return null;
          const from = !tag.declared
            ? 'a plain tag — [c] makes it a category'
            : tag.sources.length > 1
              ? `${WORKSPACE_BADGE} workspace list, with your description`
              : tag.sources[0] === 'workspace'
                ? `${WORKSPACE_BADGE} workspace list`
                : 'your list';
          const children = categories.filter((each) => each.parent === tag.key);
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(tag)} />
              {tag.description && (
                <Text color={colors.text} wrap="wrap">
                  {tag.description}
                </Text>
              )}
              <LinkRow label="from" value={from} color={colors.muted} />
              {children.length > 0 && (
                <LinkRow label="holds" value={children.map((each) => each.name).join(', ')} />
              )}
              <Box flexDirection="column" marginTop={1}>
                {tag.entries.slice(0, PAGES_LISTED).map((entry) => (
                  <LinkRow
                    key={entry.id}
                    label="·"
                    labelWidth={2}
                    value={displayTitle(entry)}
                    onOpen={() => openUrl(entry.url)}
                  />
                ))}
                {tag.entries.length > PAGES_LISTED && (
                  <Text color={colors.muted}>
                    {`… ${tag.entries.length - PAGES_LISTED} more — [Enter] shows them all`}
                  </Text>
                )}
                {!tag.entries.length && (
                  <Text color={colors.muted}>Empty — [Enter] then [a] adds a page.</Text>
                )}
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default TagsView;
