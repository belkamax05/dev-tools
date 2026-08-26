/**
 * What a terminal app's colours *mean*, and the sets of colours that mean them.
 *
 * The rest of `theme/` answers "how big"; this file answers "what colour", and
 * for the same reason: a component that writes `color="cyan"` has decided both
 * that this text is the accent *and* that the accent is cyan, and only the first
 * of those is its business.
 *
 * Roles, not colours. Every literal in a consuming app maps onto one of ten, and
 * a theme is one value per role — so a new theme is a table entry rather than a
 * sweep through thirty files.
 */

/** The one role every other is defined against. */
export type ColorRole =
  /** Selection, the open tab, focused frames — the colour the app is "in". */
  | 'accent'
  /** Text drawn on top of an `accent` fill, which is the only place it goes. */
  | 'accentText'
  /** Section titles: the bold line at the top of a panel. */
  | 'heading'
  /**
   * Live-under-the-pointer, and the second emphasis where accent is taken.
   *
   * Distinct from `accent` on purpose: hovering a selected thing has to look
   * like something happened, so the two can never collapse into one colour.
   */
  | 'highlight'
  /** A value that is right, present, in sync. */
  | 'ok'
  /** Attention without failure: unsaved edits, a fallback that was taken. */
  | 'warn'
  /** A failure, and the only role that stays red-ish in every theme. */
  | 'error'
  /** Body text that is meant to be read. */
  | 'text'
  /** Labels, separators, and everything that is context rather than content. */
  | 'muted'
  /**
   * A solid fill to put something on top of — a resize readout, a popover.
   *
   * Also what the whole app is painted in when the background is made opaque,
   * which is why it is a real colour in every theme rather than "black".
   */
  | 'surface';

export type Palette = Record<ColorRole, string>;

/**
 * "Paint nothing here" — the value to use where a colour is required but the
 * terminal's own background is what should show.
 *
 * Ink has no concept of a transparent colour, and `undefined` is not a
 * substitute: its `Box` wraps itself in a context provider when it is given a
 * background and does not when it is not, so a background that toggles between
 * a colour and `undefined` changes the shape of the React tree and unmounts
 * everything below it. A name Ink does not recognise keeps the shape constant
 * and renders as nothing — `colorize` returns the string untouched.
 */
export const TRANSPARENT = 'transparent';

export interface ThemeDefinition {
  id: string;
  /** How the theme names itself in a switcher. */
  label: string;
  /** One line on what it is, shown while the switcher entry is selected. */
  blurb: string;
  colors: Palette;
}

/**
 * The stock themes, in the order a switcher offers them.
 *
 * `classic` is first and is the default, and it is the only one written in ANSI
 * colour names. That is the point of it: named colours are resolved by the
 * terminal, so `classic` is whatever the user's own palette says cyan is, and
 * the app keeps looking like it belongs to the terminal it was launched from.
 *
 * The rest are hex, because a theme called "ember" that renders in someone's
 * customised ANSI slots is not the theme they picked. Hex costs true-colour
 * support, which every terminal that can draw box-drawing characters has had
 * for years, and degrades to the nearest ANSI colour where it does not.
 */
export const THEMES: ThemeDefinition[] = [
  {
    id: 'classic',
    label: 'Classic',
    blurb: "The terminal's own colours — cyan accent, resolved by your palette.",
    colors: {
      accent: 'cyan',
      accentText: 'black',
      heading: 'yellow',
      highlight: 'magenta',
      ok: 'green',
      warn: 'yellow',
      error: 'red',
      text: 'white',
      muted: 'gray',
      surface: 'black',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Cool blues on deep navy. Easiest of the six on a dark terminal.',
    colors: {
      accent: '#7aa2f7',
      accentText: '#1a1b26',
      heading: '#bb9af7',
      highlight: '#7dcfff',
      ok: '#9ece6a',
      warn: '#e0af68',
      error: '#f7768e',
      text: '#c0caf5',
      muted: '#565f89',
      surface: '#1a1b26',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    blurb: 'Warm oranges on charcoal.',
    colors: {
      accent: '#ff9e57',
      accentText: '#1c1512',
      heading: '#ffcc66',
      highlight: '#ff7b72',
      ok: '#a3d977',
      warn: '#ffcc66',
      error: '#f2545b',
      text: '#f0e3d7',
      muted: '#8c7566',
      surface: '#1c1512',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    blurb: 'Greens and moss. The lowest-contrast theme — good for long sessions.',
    colors: {
      accent: '#8ec07c',
      accentText: '#12180f',
      heading: '#d3c6aa',
      highlight: '#a9dc76',
      ok: '#b8bb26',
      warn: '#d8a657',
      error: '#ea6962',
      text: '#dde5d0',
      muted: '#6b7561',
      surface: '#12180f',
    },
  },
  {
    id: 'grape',
    label: 'Grape',
    blurb: 'Violet and pink on aubergine. The loudest of the six.',
    colors: {
      accent: '#c792ea',
      accentText: '#1c1526',
      heading: '#f78c6c',
      highlight: '#ff9cf5',
      ok: '#87d96c',
      warn: '#ffcb6b',
      error: '#ff5370',
      text: '#e4d7f5',
      muted: '#6c5f80',
      surface: '#1c1526',
    },
  },
  {
    id: 'mono',
    label: 'Mono',
    blurb: 'Greys only, apart from errors.',
    colors: {
      accent: '#e8e8e8',
      accentText: '#141414',
      heading: '#ffffff',
      highlight: '#a8a8a8',
      ok: '#d0d0d0',
      warn: '#f0f0f0',
      //? The one colour that survives: a failure the reader has to scan for is
      //? not a failure they will see, and grey-on-grey is exactly that.
      error: '#ff6b6b',
      text: '#cfcfcf',
      muted: '#6e6e6e',
      surface: '#141414',
    },
  },
];

/** What a config that says nothing, or says something wrong, gets. */
export const DEFAULT_THEME_ID = 'classic';

/**
 * Whether a stored string names a theme in `themes`.
 *
 * Config files are hand-edited and travel between versions, so a typo or a
 * theme that was renamed has to fall back rather than leave the palette
 * undefined — this is read during render, where there is nothing to throw to.
 */
export const isThemeId = (value: unknown, themes: ThemeDefinition[] = THEMES): value is string =>
  typeof value === 'string' && themes.some((theme) => theme.id === value);

/** The named theme, or the default when the name is not one we have. */
export const themeById = (
  id: string | undefined,
  themes: ThemeDefinition[] = THEMES,
): ThemeDefinition =>
  themes.find((theme) => theme.id === id) ??
  themes.find((theme) => theme.id === DEFAULT_THEME_ID) ??
  (themes[0] as ThemeDefinition);

/** Just the colours, which is all any component ever wants. */
export const paletteFor = (id: string | undefined, themes: ThemeDefinition[] = THEMES): Palette =>
  themeById(id, themes).colors;

/** The theme after this one, wrapping — what a switcher does on Enter. */
export const nextThemeId = (id: string, step = 1, themes: ThemeDefinition[] = THEMES): string => {
  const at = themes.findIndex((theme) => theme.id === id);
  const from = at === -1 ? 0 : at;
  const to = (from + step + themes.length) % themes.length;
  return (themes[to] as ThemeDefinition).id;
};

export const palettes = {
  DEFAULT_THEME_ID,
  THEMES,
  TRANSPARENT,
  isThemeId,
  nextThemeId,
  paletteFor,
  themeById,
} as const;

export default palettes;
