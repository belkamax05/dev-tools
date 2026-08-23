import type PickerItem from '../../../types/PickerItem';

/**
 * Narrow picker rows to the ones a search query matches, on label or description.
 *
 * Hidden rows are dropped whether or not they match — `hidden` means "not reachable from the
 * list", not "collapsed until searched for".
 */
const filterPickerItems = (items: PickerItem[], query: string): PickerItem[] => {
  const visible = items.filter((item) => !item.hidden);
  if (!query) return visible;

  const lowerQuery = query.toLowerCase();
  return visible.filter(
    (item) =>
      item.label.toLowerCase().includes(lowerQuery) ||
      (item.description?.toLowerCase() ?? '').includes(lowerQuery),
  );
};

export default filterPickerItems;
