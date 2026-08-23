import type PickerItem from './PickerItem';

/** What an interactive picker hands back once the user commits to a row. */
export default interface PickerSelection {
  item: PickerItem;
  /** Label of every group descended through on the way to `item`, outermost first. */
  path: string[];
}
