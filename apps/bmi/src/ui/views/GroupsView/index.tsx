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
  type BookmarkGroup,
  coerceTags,
  displayTitle,
  type Group,
  type Library,
  withGroup,
  withoutGroup,
} from '../../../core/bookmarks';
import type { Session, Tone } from '../../types';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Opening more pages than this at once asks first — a misfire would bury the browser. */
const OPEN_ALL_WITHOUT_ASKING = 5;

export interface GroupsViewProps {
  library: Library;
  config: BmiConfig;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  onConfigChange: (config: BmiConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  /** Show the group's pages on the Bookmarks tab. */
  onShowGroup: (key: string) => void;
}

/**
 * Raindrop's collections: each group with its description, tags and pages. Enter shows a group's
 * pages on the Bookmarks tab, `O` opens all of them at once — the morning's jira boards in one key.
 */
export const GroupsView = ({
  library,
  config,
  session,
  notify,
  onConfigChange,
  onCaptureInput,
  onShowGroup,
}: GroupsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.groups);
  const current = library.groups.find((group) => group.key === currentId) ?? library.groups[0];
  const list = userList(config);
  const isOwn = (group: Group) =>
    list.groups.some((written) => written.name.toLowerCase() === group.key);

  const save = (next: ReturnType<typeof userList>) => onConfigChange({ ...config, ...next });

  const openAll = (group: Group | undefined) => {
    if (!group?.entries.length) return;
    const go = () => {
      for (const entry of group.entries) openUrl(entry.url);
      notify(`Opened ${group.entries.length} pages from ${group.name}`, 'ok');
    };
    if (group.entries.length <= OPEN_ALL_WITHOUT_ASKING) go();
    else prompt.confirm(`Open all ${group.entries.length} pages of ${group.name}?`, go);
  };

  const add = () =>
    prompt.ask('New group — name:', (rawName) => {
      const name = rawName.trim();
      if (!name) return;
      if (library.groups.some((group) => group.key === name.toLowerCase())) {
        notify(`${name} already exists`, 'warn');
        return;
      }
      prompt.ask('Description (optional):', (description) => {
        save(
          withGroup(list, {
            name,
            ...(description.trim() && { description: description.trim() }),
          }),
        );
        setCurrentId(name.toLowerCase());
        notify(`Added group ${name} — [Enter] shows it, [a] there adds pages`, 'ok');
      });
    });

  /** Write one of the group's fields into the user's list — a static group gets an override. */
  const editField = (group: Group, field: 'description' | 'tags', raw: string) => {
    const own = list.groups.find((written) => written.name.toLowerCase() === group.key);
    const { bookmarks: _pages, ...base } = own ?? {
      name: group.name,
      bookmarks: [],
    };
    const next: Omit<BookmarkGroup, 'bookmarks'> = { ...base };
    if (field === 'description') {
      const description = raw.trim();
      if (description) next.description = description;
      else delete next.description;
    } else {
      const tags = coerceTags(raw);
      if (tags.length) next.tags = tags;
      else delete next.tags;
    }
    //? withGroup merges, so a cleared field is dropped by replacing the record outright
    save({
      ...list,
      groups: own
        ? list.groups.map((written) =>
            written === own ? { ...next, bookmarks: own.bookmarks } : written,
          )
        : withGroup(list, next).groups,
    });
    notify(`Saved ${field}`, 'ok');
  };

  const describe = (group: Group | undefined) => {
    if (!group) return;
    prompt.ask('Description:', (value) => editField(group, 'description', value), {
      initial: group.description ?? '',
    });
  };

  const retag = (group: Group | undefined) => {
    if (!group) return;
    prompt.ask(
      'Tags for every page in it (comma separated):',
      (value) => editField(group, 'tags', value),
      {
        initial: group.tags.join(', '),
      },
    );
  };

  const remove = (group: Group | undefined) => {
    if (!group) return;
    if (!isOwn(group)) {
      notify('This group comes from the static list — bmi never edits that file', 'warn');
      return;
    }
    const mine = list.groups.find((written) => written.name.toLowerCase() === group.key);
    const count = mine?.bookmarks.length ?? 0;
    prompt.confirm(
      `Remove ${group.name}${count ? ` and the ${count} page${count === 1 ? '' : 's'} you filed in it` : ''} from your list?`,
      () => {
        save(withoutGroup(list, group.name));
        notify(
          group.sources.includes('static')
            ? `Removed your additions to ${group.name}; the static list keeps its own`
            : `Removed ${group.name}`,
          'ok',
        );
      },
    );
  };

  useInput(
    (input) => {
      if (input === 'O') openAll(current);
      else if (input === 'a') add();
      else if (input === 'd') describe(current);
      else if (input === 'T') retag(current);
      else if (input === 'x') remove(current);
    },
    { isActive: !prompt.isOpen },
  );

  const items: PickItem<Group>[] = library.groups.map((group) => ({
    id: group.key,
    label: group.name,
    hint: `${group.entries.length}`,
    value: group,
  }));

  const actionsFor = (group: Group): ToolbarAction[] => [
    {
      hotkey: 'Enter',
      label: 'Show pages',
      onPress: () => onShowGroup(group.key),
      tone: 'primary',
    },
    {
      hotkey: 'O',
      label: 'Open all',
      onPress: () => openAll(group),
      disabled: !group.entries.length,
    },
    { hotkey: 'd', label: 'Description', onPress: () => describe(group) },
    { hotkey: 'T', label: 'Tags', onPress: () => retag(group) },
    ...(isOwn(group)
      ? [
          {
            hotkey: 'x',
            label: 'Remove',
            onPress: () => remove(group),
            tone: 'danger' as const,
          },
        ]
      : []),
  ];

  const hints: Hint[] = [{ key: 'a', label: 'new group', onPress: add }];

  const unsorted = library.entries.filter((entry) => !entry.group).length;
  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {`${plural(library.groups.length, 'group')} · ${plural(unsorted, 'unsorted page')}`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        title="Groups"
        items={items}
        emptyText="No groups yet — [a] makes one."
        detailTitle={current?.name ?? 'Group'}
        reservedChrome={['viewHeader']}
        activateLabel="show pages"
        //? A click selects, a second click on the selected group shows its pages
        confirmClick
        initialSelectedId={current?.key}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => item.value && onShowGroup(item.value.key)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.groups = item?.id;
        }}
        renderDetail={(item) => {
          const group = item?.value;
          if (!group) return null;
          const from =
            group.sources.length > 1
              ? 'static list, with your additions'
              : group.sources[0] === 'static'
                ? 'static list'
                : 'your list';
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(group)} />
              {group.description && (
                <Text color={colors.text} wrap="wrap">
                  {group.description}
                </Text>
              )}
              {group.tags.length > 0 && (
                <LinkRow label="tags" value={group.tags.map((tag) => `#${tag}`).join(' ')} />
              )}
              <LinkRow label="from" value={from} color={colors.muted} />
              <Box flexDirection="column" marginTop={1}>
                {group.entries.map((entry) => (
                  <LinkRow
                    key={entry.id}
                    label="·"
                    labelWidth={2}
                    value={displayTitle(entry)}
                    onOpen={() => openUrl(entry.url)}
                  />
                ))}
                {!group.entries.length && (
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

export default GroupsView;
