import type PickerItem from '@/dev-tools/types/PickerItem';
import type { CommandEntry } from '../../types/CommandEntry';

interface PendingEntry {
  /** Name segments not yet placed into a level, from the current level down. */
  segments: string[];
  entry: CommandEntry;
}

const describeGroup = (count: number) => `${count} command${count === 1 ? '' : 's'}`;

const buildLevel = (pending: PendingEntry[], prefix: string): PickerItem[] => {
  const items: PickerItem[] = [];
  const groups = new Map<string, PendingEntry[]>();

  for (const { segments, entry } of pending) {
    const [head = '', ...rest] = segments;

    if (rest.length === 0) {
      items.push({
        //? The full slash-separated name is what the CLI resolves onto a file, so handing it back
        //? as the value is all the caller needs to dispatch the pick
        value: entry.name,
        label: head,
        description: entry.meta?.description,
        args: entry.meta?.args,
        hidden: entry.meta?.hidden,
      });
      continue;
    }

    const bucket = groups.get(head);
    if (bucket) bucket.push({ segments: rest, entry });
    else groups.set(head, [{ segments: rest, entry }]);
  }

  for (const [name, children] of groups) {
    const groupPrefix = `${prefix}${name}/`;
    items.push({
      //? A folder is never dispatched, so its value only has to stay clear of every other row's;
      //? the trailing slash keeps it distinct from a command of the same name
      value: groupPrefix,
      label: name,
      description: describeGroup(children.length),
      //? Deferred so opening one folder does not build the rest of the tree
      children: () => buildLevel(children, groupPrefix),
    });
  }

  return items.sort((first, second) => first.label.localeCompare(second.label));
};

/**
 * Fold the flat command listing into the tree the picker browses: `subrepo/install` becomes an
 * `install` row inside a `subrepo` folder, while a top-level command stays where it is.
 */
const getCommandPickerItems = (entries: CommandEntry[]): PickerItem[] =>
  buildLevel(
    entries.map((entry) => ({ segments: entry.name.split('/'), entry })),
    '',
  );

export default getCommandPickerItems;
