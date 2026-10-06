/**
 * One row in an interactive picker.
 *
 * Consumers map their own records (commands, scripts, branches) onto this shape and match the
 * returned `value` back onto the original. The boundary is plain data on purpose: every repo
 * resolves `react`/`ink` from its own `node_modules`, so a React element built by a consumer
 * would render under a foreign React copy and its hooks would blow up. Data in, value out.
 */
export default interface PickerItem {
  /**
   * Identifies the row to the caller. Unique across the whole tree, not just among siblings,
   * so one flat map resolves a pick from any level.
   */
  value: string;
  /** Text shown in the list. */
  label: string;
  description?: string;
  /** Argument signature shown in the preview, e.g. `<branch> [--force]`. */
  args?: string;
  /** Kept out of the list entirely — a matching query does not bring it back. */
  hidden?: boolean;
  /**
   * Rows reached by descending into this one, which is what makes the row a group.
   * A thunk defers building them until the group is opened, so a command tree can stay lazy.
   */
  children?: PickerItem[] | (() => PickerItem[]);
  /**
   * Enter picks this group instead of descending into it — for a group that is runnable in its
   * own right. Ignored on a row without children.
   */
  runnable?: boolean;
}
