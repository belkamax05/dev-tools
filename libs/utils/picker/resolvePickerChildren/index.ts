import type PickerItem from '../../../types/PickerItem';

/**
 * Rows to descend into for a group, or `undefined` for a leaf.
 *
 * A group declaring a thunk is only expanded here, at the moment it is opened, so a consumer can
 * hand over a tree whose deeper levels are expensive to build.
 */
const resolvePickerChildren = (item: PickerItem): PickerItem[] | undefined => {
  const { children } = item;
  if (children === undefined) return undefined;
  return typeof children === 'function' ? children() : children;
};

export default resolvePickerChildren;
