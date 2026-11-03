/**
 * The keys every dev-tools TUI shares: one action, one key, in every app and every view — so a
 * key learned in one app does the same thing in the next.
 *
 * Only actions that mean the same everywhere belong here. A key whose meaning is a view's own
 * (`a`, `n`, `p`, `r`, `s`… differ from app to app) stays a literal in that view. Each value is
 * what the user types, which is also what a button or hint prints.
 */
const hotkeys = {
  /**
   * Delete / remove / drop the one item the cursor is on. Never `d`: across the apps it already
   * means description, disable, discard hunk and more.
   */
  delete: 'x',
  /**
   * Delete's bigger variant: the remote side as well (a remote branch, a ref with its remote
   * counterpart), or everything (Settings' clear all). A question that follows a delete answers
   * with the same pair — `delete` for the smaller choice, `deleteMore` for the bigger one.
   */
  deleteMore: 'X',
  /** Open the item in `$EDITOR`. */
  edit: 'e',
  /** Search or filter the list in view. */
  search: '/',
  /** Copy the item's value — a hash, a URL, `KEY=value` — to the clipboard. */
  copy: 'y',
  /** Answer yes to a confirmation; any other key cancels. */
  yes: 'y',
  /** The no printed beside `yes` — capital, the default every other key also gives. */
  no: 'N',
  /** Leave the screen (Esc does too). */
  quit: 'q',
  /** Stop a process. */
  stop: 'k',
  /** Stop a process with every child it started. */
  stopTree: 'g',
  /** Stop the process that started this one. */
  stopParent: 'p',
} as const satisfies Record<string, string>;

export default hotkeys;
