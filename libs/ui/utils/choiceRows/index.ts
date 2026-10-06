import type { PickItem } from '../../components/PickList';

export interface ChoiceRowsOptions<C, T> {
  /** Row ids are `<key>:<id>`, the header's `header-<key>` — what a view remembering its row stores. */
  key: string;
  header: string;
  choices: readonly C[];
  idOf: (choice: C) => string | number;
  label: (choice: C) => string;
  /** The row's value, for the view's apply and detail. */
  value: (choice: C) => T;
  /** The choice in force, by id. */
  current: string | number | undefined;
  /** Marked "recommended" — the default, where there is one worth saying. */
  recommended?: string | number;
  /** The colour "in use" is drawn in. */
  accent: string;
}

/**
 * A Settings section where exactly one option is in force: a header, then one row per choice,
 * the current one marked and hinted "in use", the default hinted "recommended".
 *
 * The theme list and every app's refresh rate are this shape; written once here so the marking
 * and the hints read the same in every app.
 */
export const choiceRows = <C, T>({
  key,
  header,
  choices,
  idOf,
  label,
  value,
  current,
  recommended,
  accent,
}: ChoiceRowsOptions<C, T>): PickItem<T>[] => [
  { id: `header-${key}`, label: header, isHeader: true },
  ...choices.map((choice) => {
    const id = idOf(choice);
    const inUse = id === current;
    const hint = [id === recommended ? 'recommended' : '', inUse ? 'in use' : '']
      .filter(Boolean)
      .join(' · ');
    return {
      id: `${key}:${id}`,
      label: label(choice),
      hint: hint || undefined,
      hintColor: inUse ? accent : undefined,
      isCurrent: inUse,
      value: value(choice),
    };
  }),
];

/** A refresh-rate row: how often an app re-reads what it shows, 0 for never. */
export interface RefreshSetting {
  kind: 'refresh';
  seconds: number;
}

export const refreshLabel = (seconds: number): string =>
  seconds === 0 ? 'Off' : `Every ${seconds}s`;

/** The "Auto refresh" section, for an app with its own choices and default. */
export const refreshRows = (
  choices: readonly number[],
  current: number,
  recommended: number,
  accent: string,
): PickItem<RefreshSetting>[] =>
  choiceRows({
    key: 'refresh',
    header: 'Auto refresh',
    choices,
    idOf: (seconds) => seconds,
    label: refreshLabel,
    value: (seconds) => ({ kind: 'refresh' as const, seconds }),
    current,
    recommended,
    accent,
  });

export default choiceRows;
