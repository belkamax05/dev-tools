/**
 * Terminal size tiers, in cells.
 *
 * The CSS analogue is a media query and the MUI one is `theme.breakpoints`, but
 * a TUI needs changes on both axes to be first-class. Rows decide more than
 * columns do, because nothing scrolls: content that does not fit is not clipped,
 * it pushes the frame past the bottom of the terminal, and every frame after
 * that lands a line off and draws on top of itself.
 *
 * A tier is the smallest terminal it applies to, so a tier table reads as the
 * smallest-terminal-first cascade CSS uses: the first tier is whatever is left
 * below the second.
 *
 * Tier names should name their axis (`wide` can only be columns, `tall` only
 * rows) so a value map never has to say which axis it is keyed on.
 *
 * Thresholds are meant to be *measured*, not estimated. Guessing here does not
 * degrade gracefully: a threshold one row optimistic does not clip the bottom
 * row, it squashes a bordered box until its text lands on its own border.
 */

export type TierTable = Record<string, number>;

/** The stock tiers. An app overrides these with sizes it has actually measured. */
export const breakpoints = {
  columns: { narrow: 0, wide: 100 },
  rows: { short: 0, compact: 24, regular: 32, tall: 40 },
} satisfies { columns: TierTable; rows: TierTable };

export type Breakpoints = { columns: TierTable; rows: TierTable };

/** Tier names smallest first — the order a value map cascades in. */
export const ascending = (tiers: TierTable): string[] =>
  Object.keys(tiers).sort((a, b) => (tiers[a] as number) - (tiers[b] as number));

/** The tier a measurement falls in — the largest one it still clears. */
export const tierFor = (tiers: TierTable, order: string[], cells: number): string => {
  let match = order[0] as string;
  for (const tier of order) {
    if (cells >= (tiers[tier] as number)) match = tier;
  }
  return match;
};

/**
 * The value a tier map gives at `current`.
 *
 * A tier the map does not mention keeps whatever the tier below it said, so a
 * map only has to state what changes — the cascade CSS gets from later rules
 * overriding earlier ones.
 */
export const pickByTier = <T>(
  order: readonly string[],
  current: string,
  values: Partial<Record<string, T>>,
): T => {
  let match = values[order[0] as string] as T;
  for (const tier of order) {
    if (values[tier] !== undefined) match = values[tier] as T;
    if (tier === current) break;
  }
  return match;
};

export default breakpoints;
